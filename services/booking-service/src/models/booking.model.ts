import { model, Schema, Types } from 'mongoose';

export const BOOKING_STATES = [
  'PENDING_PAYMENT',
  'PAID',
  'CONFIRMED',
  'COMPLETED',
  'PAYMENT_FAILED',
  'CANCELLED',
] as const;
export type BookingState = (typeof BOOKING_STATES)[number];
export type FulfillmentStatus = 'PENDING' | 'PROCESSING' | 'DONE';

const bookingSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    consultantId: { type: Schema.Types.ObjectId, required: true, index: true },
    consultantName: { type: String, required: true },
    consultantEmail: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    clientName: { type: String, required: true, maxlength: 120 },
    clientEmail: { type: String, required: true, maxlength: 254 },
    clientPhone: { type: String, required: true, maxlength: 30 },
    agenda: { type: String, required: true, maxlength: 2000 },
    state: { type: String, enum: BOOKING_STATES, default: 'PENDING_PAYMENT', index: true },
    checkoutSessionId: { type: String, default: null },
    checkoutUrl: { type: String, default: null },
    paymentIntentId: { type: String, default: null },
    calendarEventId: { type: String, default: null },
    meetingUrl: { type: String, default: null },
    calendarStartAt: { type: Date, default: null },
    calendarEndAt: { type: Date, default: null },
    calendarStatus: { type: String, enum: ['PENDING', 'PROCESSING', 'DONE'], default: 'PENDING' },
    emailStatus: { type: String, enum: ['PENDING', 'PROCESSING', 'DONE'], default: 'PENDING' },
    calendarAttemptAt: { type: Date, default: null },
    emailAttemptAt: { type: Date, default: null },
    lastFulfillmentError: { type: String, default: null },
    paidAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

bookingSchema.index({ createdAt: -1 });
bookingSchema.index({ consultantId: 1, startAt: 1, state: 1 });
bookingSchema.index({ userId: 1, createdAt: -1 });

export interface BookingRecord {
  _id: Types.ObjectId;
  userId: string;
  consultantId: Types.ObjectId;
  consultantName: string;
  consultantEmail: string;
  startAt: Date;
  endAt: Date;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  agenda: string;
  state: BookingState;
  checkoutSessionId: string | null;
  checkoutUrl: string | null;
  paymentIntentId: string | null;
  calendarEventId: string | null;
  meetingUrl: string | null;
  calendarStartAt: Date | null;
  calendarEndAt: Date | null;
  calendarStatus: FulfillmentStatus;
  emailStatus: FulfillmentStatus;
  createdAt: Date;
  updatedAt: Date;
}

export const Booking = model<BookingRecord>('Booking', bookingSchema);
