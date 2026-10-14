import { model, Schema, Types } from 'mongoose';

const availabilitySchema = new Schema(
  {
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
  },
  { _id: false },
);

const consultantSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    timeZone: { type: String, required: true, trim: true, maxlength: 100 },
    availability: { type: [availabilitySchema], default: [] },
  },
  { timestamps: true },
);

consultantSchema.index({ 'availability.startAt': 1 });

export interface AvailabilitySlot {
  startAt: Date;
  endAt: Date;
}

export interface ConsultantRecord {
  _id: Types.ObjectId;
  name: string;
  email: string;
  timeZone: string;
  availability: AvailabilitySlot[];
}

export const Consultant = model<ConsultantRecord>('Consultant', consultantSchema);
