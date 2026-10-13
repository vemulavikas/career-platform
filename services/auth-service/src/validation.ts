import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
const phone = z.string().trim().regex(/^\+?[0-9\s-]{7,15}$/, 'Invalid phone number');
// max(72): bcrypt only uses the first 72 bytes, so longer passwords would be silently truncated.
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email,
  password,
  phone: phone.optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(72),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(1).max(256) });

export const updateMeSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    phone,
    profile: z
      .object({
        headline: z.string().trim().max(150),
        bio: z.string().trim().max(2000),
        location: z.string().trim().max(100),
        skills: z.array(z.string().trim().min(1).max(50)).max(50),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict() // unknown fields (e.g. "role") are rejected, not silently applied
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
