import { model, Schema } from 'mongoose';

const slotLockSchema = new Schema(
  {
    consultantId: { type: Schema.Types.ObjectId, required: true },
    startAt: { type: Date, required: true },
    bookingId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

slotLockSchema.index({ consultantId: 1, startAt: 1 }, { unique: true });
slotLockSchema.index({ bookingId: 1 }, { unique: true });

export const SlotLock = model('SlotLock', slotLockSchema);
