import { model, Schema } from 'mongoose';

const stripeEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true },
    type: { type: String, required: true },
    bookingId: { type: String, default: null },
    lastAttemptAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export const StripeEvent = model('StripeEvent', stripeEventSchema);
