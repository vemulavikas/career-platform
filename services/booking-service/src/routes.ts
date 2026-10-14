import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Types } from 'mongoose';
import { z } from 'zod';
import { config } from './config';
import {
  cancelBooking,
  completeBooking,
  createBooking,
  processStripeEvent,
  publicBooking,
  retryFulfillment,
} from './booking.service';
import type { BookingProviders } from './booking.service';
import { AppError } from './errors';
import { Booking, BOOKING_STATES } from './models/booking.model';
import { Consultant } from './models/consultant.model';
import { SlotLock } from './models/slot-lock.model';
import { asyncHandler, requireUser, validate } from './middleware';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const bookingInput = z.object({
  consultantId: objectId,
  startAt: z.string().datetime({ offset: true }),
  clientName: z.string().trim().min(1).max(120),
  clientEmail: z.string().trim().email().max(254),
  clientPhone: z.string().trim().min(5).max(30),
  agenda: z.string().trim().min(1).max(2000),
});
const slotSchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
}).refine((slot) => new Date(slot.endAt) > new Date(slot.startAt), 'Slot end must follow its start');
const consultantSchema = z.object({
  id: objectId,
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  timeZone: z.string().trim().min(1).max(100),
  availability: z.array(slotSchema).max(500),
});
const availabilitySchema = z.object({ availability: z.array(slotSchema).max(500) });

function escapeRegex(query: string) {
  return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function queryText(value: unknown, label: string) {
  const parsed = z.string().min(1).safeParse(value);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', `Invalid ${label}`);
  return parsed.data;
}

export function createConsultantRouter() {
  const router = Router();
  router.use(requireUser);
  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const consultants = await Consultant.find()
        .select('_id name timeZone')
        .sort({ name: 1 })
        .limit(100)
        .lean();
      res.json({
        consultants: consultants.map((consultant) => ({
          id: consultant._id.toString(),
          name: consultant.name,
          timeZone: consultant.timeZone,
        })),
      });
    }),
  );
  router.post(
    '/',
    validate(consultantSchema),
    asyncHandler(async (req, res) => {
      const { id, availability, ...profile } = req.body;
      assertConsultantManager(req, id);
      const consultant = await Consultant.findByIdAndUpdate(
        id,
        {
          $set: {
            ...profile,
            availability: availability.map((slot: { startAt: string; endAt: string }) => ({
              startAt: new Date(slot.startAt),
              endAt: new Date(slot.endAt),
            })),
          },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
      );
      res.status(200).json({
        consultant: {
          id: consultant.id,
          name: consultant.name,
          email: consultant.email,
          timeZone: consultant.timeZone,
          availability: consultant.availability,
        },
      });
    }),
  );

  router.put(
    '/:consultantId/availability',
    validate(availabilitySchema),
    asyncHandler(async (req, res) => {
      if (!Types.ObjectId.isValid(req.params.consultantId)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid consultant identifier');
      }
      assertConsultantManager(req, req.params.consultantId);
      const consultant = await Consultant.findByIdAndUpdate(
        req.params.consultantId,
        {
          $set: {
            availability: req.body.availability.map((slot: { startAt: string; endAt: string }) => ({
              startAt: new Date(slot.startAt),
              endAt: new Date(slot.endAt),
            })),
          },
        },
        { new: true, runValidators: true },
      );
      if (!consultant) throw new AppError(404, 'CONSULTANT_NOT_FOUND', 'Consultant not found');
      res.json({ availability: consultant.availability });
    }),
  );

  router.get(
    '/:consultantId/availability',
    asyncHandler(async (req, res) => {
      if (!Types.ObjectId.isValid(req.params.consultantId)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid consultant identifier');
      }
      const from = new Date(queryText(req.query.from, 'from date'));
      const to = new Date(queryText(req.query.to, 'to date'));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid availability date range');
      }
      const consultant = await Consultant.findById(req.params.consultantId).lean();
      if (!consultant) throw new AppError(404, 'CONSULTANT_NOT_FOUND', 'Consultant not found');
      const locks = await SlotLock.find({ consultantId: consultant._id, startAt: { $gte: from, $lt: to } })
        .select('startAt')
        .lean();
      const reserved = new Set(locks.map((lock) => new Date(lock.startAt).getTime()));
      const slots = consultant.availability
        .filter((slot) => slot.startAt >= from && slot.startAt < to && slot.endAt > new Date())
        .map((slot) => ({ ...slot, available: !reserved.has(slot.startAt.getTime()) }));
      res.json({ consultantId: consultant._id, timeZone: consultant.timeZone, availability: slots });
    }),
  );
  return router;
}

function assertConsultantManager(req: import('express').Request, consultantId: string) {
  const role = req.header('x-user-role');
  if (role === 'ADMIN' || (role === 'CONSULTANT' && req.userId === consultantId)) return;
  throw new AppError(403, 'FORBIDDEN', 'Only the consultant or an administrator can manage availability');
}

export function createBookingRouter(providers: BookingProviders) {
  const router = Router();
  const createLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.BOOKING_RATE_LIMIT_PER_MIN,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many booking requests' } },
  });
  router.use(requireUser);

  router.post(
    '/',
    createLimiter,
    validate(bookingInput),
    asyncHandler(async (req, res) => {
      const booking = await createBooking(req.userId!, req.body, providers);
      res.status(201).json({ booking });
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const page = Number(req.query.page ?? 1);
      const limit = Number(req.query.limit ?? 20);
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Page must be positive and limit must be between 1 and 100');
      }
      const filter: Record<string, unknown> = { userId: req.userId };
      if (req.query.state !== undefined) {
        const state = queryText(req.query.state, 'state');
        if (!(BOOKING_STATES as readonly string[]).includes(state)) {
          throw new AppError(400, 'VALIDATION_ERROR', 'Invalid booking state');
        }
        filter.state = state;
      }
      if (req.query.consultantId !== undefined) {
        const consultantId = queryText(req.query.consultantId, 'consultant identifier');
        if (!Types.ObjectId.isValid(consultantId)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid consultant identifier');
        filter.consultantId = consultantId;
      }
      const from = req.query.from ? new Date(queryText(req.query.from, 'from date')) : undefined;
      const to = req.query.to ? new Date(queryText(req.query.to, 'to date')) : undefined;
      if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid booking date range');
      }
      if (from || to) filter.startAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
      if (req.query.search !== undefined) {
        const search = queryText(req.query.search, 'search query');
        if (search.length > 100) throw new AppError(400, 'VALIDATION_ERROR', 'Search query is too long');
        const pattern = new RegExp(escapeRegex(search), 'i');
        filter.$or = [{ clientName: pattern }, { clientEmail: pattern }, { consultantName: pattern }];
      }
      const sortField = req.query.sort === undefined ? 'createdAt' : queryText(req.query.sort, 'sort field');
      if (!['createdAt', 'startAt', 'state'].includes(sortField)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Unsupported sort field');
      }
      const sortOrder = req.query.order === undefined ? 'desc' : queryText(req.query.order, 'sort order');
      if (!['asc', 'desc'].includes(sortOrder)) throw new AppError(400, 'VALIDATION_ERROR', 'Sort order must be asc or desc');
      const [bookings, total] = await Promise.all([
        Booking.find(filter)
          .sort({ [sortField]: sortOrder === 'asc' ? 1 : -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Booking.countDocuments(filter),
      ]);
      res.json({
        bookings: bookings.map((booking) => publicBooking(booking as any)),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    }),
  );

  router.get(
    '/:bookingId',
    asyncHandler(async (req, res) => {
      if (!Types.ObjectId.isValid(req.params.bookingId)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid booking identifier');
      const booking = await Booking.findOne({ _id: req.params.bookingId, userId: req.userId });
      if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
      res.json({ booking: publicBooking(booking) });
    }),
  );

  router.post(
    '/:bookingId/retry-fulfillment',
    asyncHandler(async (req, res) => {
      if (!Types.ObjectId.isValid(req.params.bookingId)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid booking identifier');
      const booking = await retryFulfillment(req.userId!, req.params.bookingId, providers);
      res.json({ booking });
    }),
  );

  router.post(
    '/:bookingId/cancel',
    asyncHandler(async (req, res) => {
      if (!Types.ObjectId.isValid(req.params.bookingId)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid booking identifier');
      const booking = await cancelBooking(req.userId!, req.params.bookingId, providers);
      res.json({ booking });
    }),
  );

  router.post(
    '/:bookingId/complete',
    asyncHandler(async (req, res) => {
      if (!Types.ObjectId.isValid(req.params.bookingId)) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid booking identifier');
      const booking = await completeBooking(req.userId!, req.params.bookingId);
      res.json({ booking });
    }),
  );
  return router;
}

export function webhookHandler(providers: BookingProviders) {
  return asyncHandler(async (req, res) => {
    const signature = req.header('stripe-signature');
    if (!signature || !Buffer.isBuffer(req.body)) {
      throw new AppError(400, 'INVALID_WEBHOOK', 'Missing Stripe signature or raw request body');
    }
    let event;
    try {
      event = providers.stripe.verifyWebhook(req.body, signature);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, 'INVALID_WEBHOOK_SIGNATURE', 'Stripe webhook signature could not be verified');
    }
    await processStripeEvent(event, providers);
    res.json({ received: true });
  });
}
