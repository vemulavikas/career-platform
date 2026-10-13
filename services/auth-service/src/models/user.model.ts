import { Schema, model } from 'mongoose';

export const ROLES = ['USER', 'CONSULTANT', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // unique index = the real guard against duplicate registrations (race-safe)
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'USER' },
    profile: {
      headline: { type: String, maxlength: 150 },
      bio: { type: String, maxlength: 2000 },
      location: { type: String, maxlength: 100 },
      skills: { type: [String], default: [] },
    },
  },
  { timestamps: true },
);

userSchema.set('toJSON', {
  transform: (_doc, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
  },
});

export const User = model('User', userSchema);
