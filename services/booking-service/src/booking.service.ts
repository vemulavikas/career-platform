import { Types } from 'mongoose';
import { AppError } from './errors';
import { Booking, type BookingRecord } from './models/booking.model';
import { Consultant } from './models/consultant.model';
import { SlotLock } from './models/slot-lock.model';
import { StripeEvent } from './models/stripe-event.model';
import type { CalendarProvider } from './providers/calendar.provider';
import type { EmailProvider } from './providers/email.provider';
import type { StripeProvider, VerifiedStripeEvent } from './providers/stripe.provider';

export interface BookingProviders {
  stripe: StripeProvider;
  calendar: CalendarProvider;
  email: EmailProvider;
}

const CLAIM_STALE_AFTER_MS = 2 * 60 * 1000;

export async function createBooking(
  userId: string,
  input: {
    consultantId: string;
    startAt: string;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    agenda: string;
  },
  providers: BookingProviders,
) {
  const startAt = new Date(input.startAt);
  if (startAt.getTime() <= Date.now()) {
    throw new AppError(400, 'PAST_BOOKING_TIME', 'Booking time must be in the future');
  }
  const consultant = await Consultant.findById(input.consultantId);
  if (!consultant) throw new AppError(404, 'CONSULTANT_NOT_FOUND', 'Consultant not found');
  const slot = consultant.availability.find((candidate) => candidate.startAt.getTime() === startAt.getTime());
  if (!slot || slot.endAt <= startAt) {
    throw new AppError(409, 'SLOT_NOT_AVAILABLE', 'Consultant is not available at the requested time');
  }

  const bookingId = new Types.ObjectId();
  try {
    await SlotLock.create({
      consultantId: consultant._id,
      startAt,
      bookingId,
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new AppError(409, 'SLOT_ALREADY_BOOKED', 'This consultant time slot is already booked');
    }
    throw error;
  }

  let booking: BookingRecord;
  try {
    booking = await Booking.create({
      _id: bookingId,
      userId,
      consultantId: consultant._id,
      consultantName: consultant.name,
      consultantEmail: consultant.email,
      startAt,
      endAt: slot.endAt,
      clientName: input.clientName,
      clientEmail: input.clientEmail.toLowerCase(),
      clientPhone: input.clientPhone,
      agenda: input.agenda,
      state: 'PENDING_PAYMENT',
    });
  } catch (error) {
    await SlotLock.deleteOne({ bookingId });
    throw error;
  }

  let checkout: Awaited<ReturnType<BookingProviders['stripe']['createCheckout']>>;
  try {
    checkout = await providers.stripe.createCheckout({
      bookingId: booking._id.toString(),
      clientName: booking.clientName,
      clientEmail: booking.clientEmail,
      consultantName: booking.consultantName,
      startAt: booking.startAt,
      endAt: booking.endAt,
    });
  } catch (error) {
    const failed = await Booking.updateOne(
      { _id: booking._id, state: 'PENDING_PAYMENT' },
      { $set: { state: 'PAYMENT_FAILED' } },
    );
    if (failed.modifiedCount === 1) await SlotLock.deleteOne({ bookingId: booking._id });
    throw error;
  }
  const saved = await Booking.updateOne(
    { _id: booking._id, state: 'PENDING_PAYMENT' },
    { $set: { checkoutSessionId: checkout.id, checkoutUrl: checkout.url } },
  );
  if (saved.modifiedCount !== 1) {
    await providers.stripe.expireCheckout(checkout.id);
    throw new AppError(409, 'BOOKING_CANCELLED', 'Booking was cancelled before checkout was ready');
  }
  return { ...publicBooking(booking), checkoutSessionId: checkout.id, checkoutUrl: checkout.url };
}

export function publicBooking(booking: BookingRecord | (Record<string, any> & { _id: Types.ObjectId })) {
  return {
    id: booking._id.toString(),
    consultantId: booking.consultantId.toString(),
    consultantName: booking.consultantName,
    startAt: booking.startAt,
    endAt: booking.endAt,
    clientName: booking.clientName,
    clientEmail: booking.clientEmail,
    clientPhone: booking.clientPhone,
    agenda: booking.agenda,
    state: booking.state,
    checkoutSessionId: booking.checkoutSessionId,
    checkoutUrl: booking.checkoutUrl,
    paymentIntentId: booking.paymentIntentId,
    calendarEventId: booking.calendarEventId,
    meetingUrl: booking.meetingUrl,
    calendarStartAt: booking.calendarStartAt,
    calendarEndAt: booking.calendarEndAt,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}

function objectRecord(value: unknown): Record<string, any> {
  return (value ?? {}) as Record<string, any>;
}

function bookingIdFromEvent(event: VerifiedStripeEvent): string | undefined {
  const object = objectRecord(event.data.object);
  const metadata = objectRecord(object.metadata);
  const raw = metadata.bookingId ?? object.client_reference_id;
  return typeof raw === 'string' && Types.ObjectId.isValid(raw) ? raw : undefined;
}

export async function processStripeEvent(event: VerifiedStripeEvent, providers: BookingProviders): Promise<void> {
  await StripeEvent.updateOne(
    { eventId: event.id },
    { $set: { type: event.type, bookingId: bookingIdFromEvent(event) ?? null, lastAttemptAt: new Date() } },
    { upsert: true },
  ).catch((error: unknown) => {
    if ((error as { code?: number }).code !== 11000) throw error;
  });

  const object = objectRecord(event.data.object);
  const bookingId = bookingIdFromEvent(event);
  if (!bookingId) return;

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (object.payment_status !== 'paid') return;
    if (typeof object.id !== 'string') return;
    const paymentIntentId =
      typeof object.payment_intent === 'string'
        ? object.payment_intent
        : (objectRecord(object.payment_intent).id as string | undefined);
    const booking = await Booking.findOneAndUpdate(
      { _id: bookingId, checkoutSessionId: object.id, state: { $in: ['PENDING_PAYMENT', 'PAID'] } },
      {
        $set: {
          state: 'PAID',
          paidAt: new Date(),
          ...(paymentIntentId ? { paymentIntentId } : {}),
        },
      },
      { new: true },
    );
    if (booking) await fulfillBooking(booking._id.toString(), providers);
    return;
  }

  if (
    event.type === 'checkout.session.expired' ||
    event.type === 'checkout.session.async_payment_failed' ||
    event.type === 'payment_intent.payment_failed'
  ) {
    if (event.type !== 'payment_intent.payment_failed' && typeof object.id !== 'string') return;
    const sessionId = event.type === 'payment_intent.payment_failed' ? undefined : object.id;
    const failed = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        state: 'PENDING_PAYMENT',
        ...(typeof sessionId === 'string' ? { checkoutSessionId: sessionId } : {}),
      },
      { $set: { state: 'PAYMENT_FAILED' } },
      { new: true },
    );
    if (failed) await SlotLock.deleteOne({ bookingId: failed._id });
  }
}

export async function fulfillBooking(bookingId: string, providers: BookingProviders): Promise<void> {
  const booking = await Booking.findById(bookingId);
  if (!booking || !['PAID', 'CONFIRMED'].includes(booking.state)) return;

  const staleBefore = new Date(Date.now() - CLAIM_STALE_AFTER_MS);
  if (!booking.calendarEventId) {
    const claim = await Booking.findOneAndUpdate(
      {
        _id: booking._id,
        state: { $in: ['PAID', 'CONFIRMED'] },
        calendarEventId: null,
        $or: [
          { calendarStatus: 'PENDING' },
          { calendarStatus: 'PROCESSING', calendarAttemptAt: { $lt: staleBefore } },
        ],
      },
      { $set: { calendarStatus: 'PROCESSING', calendarAttemptAt: new Date() } },
      { new: true },
    );
    if (claim) {
      try {
        const consultant = await Consultant.findById(claim.consultantId);
        if (!consultant) throw new AppError(503, 'CONSULTANT_UNAVAILABLE', 'Consultant record is unavailable');
        const result = await providers.calendar.createEvent({
          bookingId: claim._id.toString(),
          summary: `Consultation: ${claim.clientName} and ${claim.consultantName}`,
          description: `Agenda: ${claim.agenda}`,
          attendeeEmail: claim.clientEmail,
          startAt: claim.startAt,
          endAt: claim.endAt,
          timeZone: consultant.timeZone,
        });
        await Booking.updateOne(
          { _id: claim._id, calendarStatus: 'PROCESSING' },
          {
            $set: {
              calendarStatus: 'DONE',
              calendarEventId: result.eventId,
              meetingUrl: result.meetingUrl,
              calendarStartAt: result.startAt,
              calendarEndAt: result.endAt,
              lastFulfillmentError: null,
            },
          },
        );
      } catch (error) {
        await Booking.updateOne(
          { _id: claim._id, calendarStatus: 'PROCESSING' },
          { $set: { calendarStatus: 'PENDING', lastFulfillmentError: 'Calendar event creation failed' } },
        );
        throw error;
      }
    } else {
      const current = await Booking.findById(bookingId);
      if (!current?.calendarEventId) {
        throw new AppError(503, 'FULFILLMENT_PENDING', 'Calendar booking fulfillment is pending; retry the payment webhook');
      }
    }
  }

  const afterCalendar = await Booking.findById(bookingId);
  if (!afterCalendar || !afterCalendar.calendarEventId) {
    throw new AppError(503, 'FULFILLMENT_PENDING', 'Calendar booking fulfillment is pending; retry the payment webhook');
  }
  if (afterCalendar.emailStatus !== 'DONE') {
    const claim = await Booking.findOneAndUpdate(
      {
        _id: afterCalendar._id,
        state: { $in: ['PAID', 'CONFIRMED'] },
        emailStatus: { $in: ['PENDING', 'PROCESSING'] },
        $or: [
          { emailStatus: 'PENDING' },
          { emailStatus: 'PROCESSING', emailAttemptAt: { $lt: staleBefore } },
        ],
      },
      { $set: { emailStatus: 'PROCESSING', emailAttemptAt: new Date() } },
      { new: true },
    );
    if (claim) {
      try {
        await providers.email.sendConfirmation({
          bookingId: claim._id.toString(),
          to: claim.clientEmail,
          clientName: claim.clientName,
          consultantName: claim.consultantName,
          startAt: claim.calendarStartAt ?? claim.startAt,
          endAt: claim.calendarEndAt ?? claim.endAt,
          meetingUrl: claim.meetingUrl ?? '',
        });
        await Booking.updateOne(
          { _id: claim._id, emailStatus: 'PROCESSING' },
          { $set: { emailStatus: 'DONE', lastFulfillmentError: null } },
        );
      } catch (error) {
        await Booking.updateOne(
          { _id: claim._id, emailStatus: 'PROCESSING' },
          { $set: { emailStatus: 'PENDING', lastFulfillmentError: 'Confirmation email delivery failed' } },
        );
        throw error;
      }
    }
  }

  const finalized = await Booking.findById(bookingId);
  if (finalized?.state === 'PAID' && finalized.calendarStatus === 'DONE' && finalized.emailStatus === 'DONE') {
    await Booking.updateOne(
      { _id: finalized._id, state: 'PAID', calendarStatus: 'DONE', emailStatus: 'DONE' },
      { $set: { state: 'CONFIRMED', confirmedAt: new Date(), lastFulfillmentError: null } },
    );
  }
  const current = await Booking.findById(bookingId);
  if (current?.state !== 'CONFIRMED') {
    throw new AppError(503, 'FULFILLMENT_PENDING', 'Booking confirmation fulfillment is pending; retry the payment webhook');
  }
}

export async function retryFulfillment(userId: string, bookingId: string, providers: BookingProviders) {
  const booking = await Booking.findOne({ _id: bookingId, userId });
  if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  if (!['PAID', 'CONFIRMED'].includes(booking.state)) {
    throw new AppError(409, 'BOOKING_NOT_READY', 'Only paid bookings can be fulfilled');
  }
  await fulfillBooking(bookingId, providers);
  const result = await Booking.findOne({ _id: bookingId, userId });
  return result ? publicBooking(result as unknown as BookingRecord) : undefined;
}

export async function cancelBooking(userId: string, bookingId: string, providers: BookingProviders) {
  const current = await Booking.findOne({ _id: bookingId, userId });
  if (!current) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  if (!['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(current.state)) {
    throw new AppError(409, 'BOOKING_CANNOT_BE_CANCELLED', 'Only unpaid bookings can be cancelled');
  }
  const checkoutSessionId = current.checkoutSessionId;
  if (current.state === 'PENDING_PAYMENT') {
    if (!checkoutSessionId) {
      throw new AppError(409, 'CHECKOUT_NOT_READY', 'Checkout is still being created; try cancelling again shortly');
    }
    // Expire payment first; only then may the booking be cancelled and its slot released.
    await providers.stripe.expireCheckout(checkoutSessionId);
  }
  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, userId, state: current.state },
    { $set: { state: 'CANCELLED', cancelledAt: new Date() } },
    { new: true },
  );
  if (!booking) {
    throw new AppError(409, 'BOOKING_CANNOT_BE_CANCELLED', 'Booking state changed; refresh and try again');
  }
  await SlotLock.deleteOne({ bookingId: booking._id });
  return publicBooking(booking as unknown as BookingRecord);
}

export async function completeBooking(userId: string, bookingId: string) {
  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, userId, state: 'CONFIRMED', endAt: { $lte: new Date() } },
    { $set: { state: 'COMPLETED', completedAt: new Date() } },
    { new: true },
  );
  if (!booking) {
    const exists = await Booking.exists({ _id: bookingId, userId });
    if (!exists) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    throw new AppError(409, 'BOOKING_NOT_COMPLETEABLE', 'Only completed confirmed bookings can be marked complete');
  }
  return publicBooking(booking as unknown as BookingRecord);
}
