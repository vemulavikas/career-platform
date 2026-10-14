import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app';
import { Booking } from '../src/models/booking.model';
import { Consultant } from '../src/models/consultant.model';
import { SlotLock } from '../src/models/slot-lock.model';
import { StripeEvent } from '../src/models/stripe-event.model';
import type { BookingProviders } from '../src/booking.service';
import type { VerifiedStripeEvent } from '../src/providers/stripe.provider';
import { StripeAdapter } from '../src/providers/stripe.provider';
import { GoogleCalendarAdapter } from '../src/providers/calendar.provider';
import { NodemailerAdapter } from '../src/providers/email.provider';
import { config } from '../src/config';

const userId = '111111111111111111111111';
const consultantId = '222222222222222222222222';
const headers = { 'x-internal-key': process.env.INTERNAL_SERVICE_SECRET!, 'x-user-id': userId };
let mongo: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let slotTimes: Array<{ startAt: string; endAt: string }>;
let failCalendarOnce = false;
let calendarCalls = 0;
let emailCalls = 0;
let expiredCheckoutSessions: string[] = [];
let verifiedRawBody: Buffer | undefined;

const providers: BookingProviders = {
  stripe: {
    async createCheckout(input) {
      return { id: `cs_${input.bookingId}`, url: `https://checkout.example/${input.bookingId}` };
    },
    async expireCheckout(sessionId) {
      expiredCheckoutSessions.push(sessionId);
    },
    verifyWebhook(rawBody, signature): VerifiedStripeEvent {
      verifiedRawBody = rawBody;
      if (signature !== 'test-signature') throw new Error('bad signature');
      return JSON.parse(rawBody.toString('utf8')) as VerifiedStripeEvent;
    },
  },
  calendar: {
    async createEvent(input) {
      calendarCalls += 1;
      if (failCalendarOnce) {
        failCalendarOnce = false;
        throw new Error('calendar unavailable');
      }
      return {
        eventId: `event-${input.bookingId}`,
        meetingUrl: `https://meet.example/${input.bookingId}`,
        startAt: input.startAt,
        endAt: input.endAt,
      };
    },
  },
  email: {
    async sendConfirmation() {
      emailCalls += 1;
    },
  },
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = createApp(providers);
});

beforeEach(async () => {
  await Promise.all([Booking.deleteMany({}), Consultant.deleteMany({}), SlotLock.deleteMany({}), StripeEvent.deleteMany({})]);
  slotTimes = [makeSlot(2), makeSlot(3), makeSlot(4)];
  failCalendarOnce = false;
  calendarCalls = 0;
  emailCalls = 0;
  expiredCheckoutSessions = [];
  verifiedRawBody = undefined;
  await Consultant.create({
    _id: consultantId,
    name: 'Alex Consultant',
    email: 'alex@example.test',
    timeZone: 'UTC',
    availability: slotTimes.map((slot) => ({ startAt: new Date(slot.startAt), endAt: new Date(slot.endAt) })),
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

function makeSlot(days: number) {
  const start = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  start.setUTCHours(15, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

function bookingPayload(startAt = slotTimes[0].startAt) {
  return {
    consultantId,
    startAt,
    clientName: 'Taylor Example',
    clientEmail: 'taylor@example.test',
    clientPhone: '+1 555 123 4567',
    agenda: 'Discuss career goals and interview preparation.',
  };
}

async function createBooking(startAt?: string) {
  return request(app).post('/api/bookings').set(headers).send(bookingPayload(startAt));
}

async function sendPaidWebhook(bookingId: string, eventId = 'evt_paid') {
  const rawBody = Buffer.from(
    JSON.stringify({
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${bookingId}`,
          metadata: { bookingId },
          payment_status: 'paid',
          payment_intent: 'pi_paid',
        },
      },
    }),
  );
  return request(app)
    .post('/api/payments/webhook')
    .set('content-type', 'application/json')
    .set('stripe-signature', 'test-signature')
    .send(rawBody.toString('utf8'));
}

describe('booking API', () => {
  it('requires the gateway secret and user identity and rejects past requests', async () => {
    const noSecret = await request(app).post('/api/bookings').send(bookingPayload());
    expect(noSecret.status).toBe(401);
    const noUser = await request(app)
      .post('/api/bookings')
      .set('x-internal-key', headers['x-internal-key'])
      .send(bookingPayload());
    expect(noUser.status).toBe(401);

    const past = await createBooking(new Date(Date.now() - 60_000).toISOString());
    expect(past.status).toBe(400);
    expect(past.body.error.code).toBe('PAST_BOOKING_TIME');
  });

  it('lists consultants without exposing their email addresses', async () => {
    const response = await request(app).get('/api/consultants').set(headers);
    expect(response.status).toBe(200);
    expect(response.body.consultants).toEqual([
      { id: consultantId, name: 'Alex Consultant', timeZone: 'UTC' },
    ]);
  });

  it('reserves a consultant slot atomically and does not double book under concurrent requests', async () => {
    const [first, second] = await Promise.all([createBooking(), createBooking()]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await Booking.countDocuments()).toBe(1);
    expect(await SlotLock.countDocuments()).toBe(1);
    expect(calendarCalls).toBe(0);
    expect(emailCalls).toBe(0);
  });

  it('validates consultant existence and exact requested availability', async () => {
    const missingConsultant = await request(app)
      .post('/api/bookings')
      .set(headers)
      .send({ ...bookingPayload(), consultantId: '333333333333333333333333' });
    expect(missingConsultant.status).toBe(404);
    expect(missingConsultant.body.error.code).toBe('CONSULTANT_NOT_FOUND');

    const unavailable = await createBooking(makeSlot(5).startAt);
    expect(unavailable.status).toBe(409);
    expect(unavailable.body.error.code).toBe('SLOT_NOT_AVAILABLE');
  });

  it('verifies raw webhook bytes, persists payment, and fulfills exactly once across webhook retries', async () => {
    const created = await createBooking();
    expect(created.status).toBe(201);
    const bookingId = created.body.booking.id as string;
    expect(created.body.booking.state).toBe('PENDING_PAYMENT');
    expect(created.body.booking.checkoutUrl).toMatch(/^https:\/\/checkout\.example\//);
    expect(calendarCalls).toBe(0);
    expect(emailCalls).toBe(0);

    const body = Buffer.from(
      JSON.stringify({
        id: 'evt_paid_raw',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_${bookingId}`,
            metadata: { bookingId },
            payment_status: 'paid',
            payment_intent: 'pi_raw',
          },
        },
      }),
    );
    const webhook = await request(app)
      .post('/api/payments/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 'test-signature')
      .send(body.toString('utf8'));
    expect(webhook.status).toBe(200);
    expect(verifiedRawBody?.toString('utf8')).toBe(body.toString('utf8'));
    expect(calendarCalls).toBe(1);
    expect(emailCalls).toBe(1);

    const repeated = await sendPaidWebhook(bookingId, 'evt_paid_raw');
    expect(repeated.status).toBe(200);
    expect(calendarCalls).toBe(1);
    expect(emailCalls).toBe(1);
    const saved = await Booking.findById(bookingId).lean();
    expect(saved?.state).toBe('CONFIRMED');
    expect(saved?.paymentIntentId).toBe('pi_raw');
    expect(saved?.calendarEventId).toBe(`event-${bookingId}`);
    expect(saved?.meetingUrl).toBe(`https://meet.example/${bookingId}`);
  });

  it('retries failed payment fulfillment on a verified Stripe webhook retry', async () => {
    const created = await createBooking();
    const bookingId = created.body.booking.id as string;
    failCalendarOnce = true;

    const failedAttempt = await sendPaidWebhook(bookingId, 'evt_retryable');
    expect({ status: failedAttempt.status, body: failedAttempt.body, calendarCalls }).toMatchObject({ status: 500 });
    expect(await Booking.findById(bookingId).then((value) => value?.state)).toBe('PAID');
    expect(emailCalls).toBe(0);

    const retry = await sendPaidWebhook(bookingId, 'evt_retryable');
    expect(retry.status).toBe(200);
    expect(calendarCalls).toBe(2);
    expect(emailCalls).toBe(1);
    expect(await Booking.findById(bookingId).then((value) => value?.state)).toBe('CONFIRMED');
  });

  it('paginates, searches, filters, and sorts only the requesting user’s bookings', async () => {
    const one = await createBooking(slotTimes[0].startAt);
    const two = await createBooking(slotTimes[1].startAt);
    const anotherUser = await request(app)
      .post('/api/bookings')
      .set({ ...headers, 'x-user-id': '333333333333333333333333' })
      .send(bookingPayload(slotTimes[2].startAt));
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(anotherUser.status).toBe(201);

    const listed = await request(app).get('/api/bookings?page=1&limit=1&search=Taylor&sort=startAt&order=asc').set(headers);
    expect(listed.status).toBe(200);
    expect(listed.body.bookings).toHaveLength(1);
    expect(listed.body.pagination).toMatchObject({ page: 1, limit: 1, total: 2, pages: 2 });

    const filtered = await request(app).get('/api/bookings?state=PENDING_PAYMENT&limit=10').set(headers);
    expect(filtered.body.bookings).toHaveLength(2);
  });

  it('expires unpaid Stripe checkout before cancelling and releasing a slot', async () => {
    const created = await createBooking();
    const bookingId = created.body.booking.id as string;
    const cancelled = await request(app).post(`/api/bookings/${bookingId}/cancel`).set(headers);

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.booking.state).toBe('CANCELLED');
    expect(expiredCheckoutSessions).toEqual([`cs_${bookingId}`]);
    expect(await SlotLock.countDocuments({ bookingId })).toBe(0);

    const latePayment = await sendPaidWebhook(bookingId, 'evt_late_payment');
    expect(latePayment.status).toBe(200);
    expect(await Booking.findById(bookingId).then((value) => value?.state)).toBe('CANCELLED');
    expect(calendarCalls).toBe(0);
    expect(emailCalls).toBe(0);
  });

  it('does not cancel a paid booking without a refund workflow', async () => {
    const created = await createBooking();
    const bookingId = created.body.booking.id as string;
    expect((await sendPaidWebhook(bookingId, 'evt_paid_no_cancel')).status).toBe(200);

    const response = await request(app).post(`/api/bookings/${bookingId}/cancel`).set(headers);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('BOOKING_CANNOT_BE_CANCELLED');
    expect(await Booking.findById(bookingId).then((value) => value?.state)).toBe('CONFIRMED');
    expect(expiredCheckoutSessions).toEqual([]);
    expect(await SlotLock.countDocuments({ bookingId })).toBe(1);
  });

  it('rejects invalid webhook signatures without changing payment state', async () => {
    const created = await createBooking();
    const rawBody = Buffer.from(
      JSON.stringify({
        id: 'evt_bad',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_${created.body.booking.id}`,
            metadata: { bookingId: created.body.booking.id },
            payment_status: 'paid',
          },
        },
      }),
    );
    const response = await request(app)
      .post('/api/payments/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 'incorrect')
      .send(rawBody.toString('utf8'));
    expect(response.status).toBe(400);
    expect((await Booking.findById(created.body.booking.id))?.state).toBe('PENDING_PAYMENT');
    expect(calendarCalls).toBe(0);
    expect(emailCalls).toBe(0);
  });

  it('supports payment failure, cancellation, and completed state transitions', async () => {
    const failed = await createBooking();
    const failedId = failed.body.booking.id as string;
    const expiredRaw = Buffer.from(
      JSON.stringify({
        id: 'evt_expired',
        type: 'checkout.session.expired',
        data: { object: { id: `cs_${failedId}`, metadata: { bookingId: failedId } } },
      }),
    );
    const expiredResponse = await request(app)
      .post('/api/payments/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 'test-signature')
      .send(expiredRaw.toString('utf8'));
    expect(expiredResponse.status).toBe(200);
    expect(await Booking.findById(failedId).then((value) => value?.state)).toBe('PAYMENT_FAILED');
    const cancelled = await request(app).post(`/api/bookings/${failedId}/cancel`).set(headers);
    expect(cancelled.body.booking.state).toBe('CANCELLED');

    const confirmed = await createBooking(slotTimes[1].startAt);
    const confirmedId = confirmed.body.booking.id as string;
    expect((await sendPaidWebhook(confirmedId, 'evt_to_complete')).status).toBe(200);
    await Booking.updateOne(
      { _id: confirmedId },
      { $set: { startAt: new Date(Date.now() - 2 * 60_000), endAt: new Date(Date.now() - 60_000) } },
    );
    const completed = await request(app).post(`/api/bookings/${confirmedId}/complete`).set(headers);
    expect(completed.status).toBe(200);
    expect(completed.body.booking.state).toBe('COMPLETED');
  });

  it('returns explicit missing-credential errors from production adapters', async () => {
    const original = {
      stripe: config.STRIPE_SECRET_KEY,
      calendarEmail: config.GOOGLE_CLIENT_EMAIL,
      calendarKey: config.GOOGLE_PRIVATE_KEY,
      calendarId: config.GOOGLE_CALENDAR_ID,
      smtpHost: config.SMTP_HOST,
      smtpUser: config.SMTP_USER,
      smtpPass: config.SMTP_PASS,
      emailFrom: config.EMAIL_FROM,
    };
    config.STRIPE_SECRET_KEY = undefined;
    config.GOOGLE_CLIENT_EMAIL = undefined;
    config.GOOGLE_PRIVATE_KEY = undefined;
    config.GOOGLE_CALENDAR_ID = undefined;
    config.SMTP_HOST = undefined;
    config.SMTP_USER = undefined;
    config.SMTP_PASS = undefined;
    config.EMAIL_FROM = undefined;
    try {
      await expect(new StripeAdapter().createCheckout({
        bookingId: new mongoose.Types.ObjectId().toString(),
        clientName: 'Test',
        clientEmail: 'test@example.test',
        consultantName: 'Consultant',
        startAt: new Date(),
        endAt: new Date(Date.now() + 60_000),
      })).rejects.toMatchObject({ code: 'INTEGRATION_NOT_CONFIGURED' });
      await expect(new GoogleCalendarAdapter().createEvent({
        bookingId: new mongoose.Types.ObjectId().toString(),
        summary: 'Test',
        description: 'Agenda',
        attendeeEmail: 'test@example.test',
        startAt: new Date(),
        endAt: new Date(Date.now() + 60_000),
        timeZone: 'UTC',
      })).rejects.toMatchObject({ code: 'INTEGRATION_NOT_CONFIGURED' });
      await expect(new NodemailerAdapter().sendConfirmation({
        bookingId: new mongoose.Types.ObjectId().toString(),
        to: 'test@example.test',
        clientName: 'Test',
        consultantName: 'Consultant',
        startAt: new Date(),
        endAt: new Date(Date.now() + 60_000),
        meetingUrl: '',
      })).rejects.toMatchObject({ code: 'INTEGRATION_NOT_CONFIGURED' });
    } finally {
      config.STRIPE_SECRET_KEY = original.stripe;
      config.GOOGLE_CLIENT_EMAIL = original.calendarEmail;
      config.GOOGLE_PRIVATE_KEY = original.calendarKey;
      config.GOOGLE_CALENDAR_ID = original.calendarId;
      config.SMTP_HOST = original.smtpHost;
      config.SMTP_USER = original.smtpUser;
      config.SMTP_PASS = original.smtpPass;
      config.EMAIL_FROM = original.emailFrom;
    }
  });
});
