import { z } from 'zod';
import { sanitizeRich } from './html';
import { TEMPLATE_IDS } from './templates';

// ---- primitives -----------------------------------------------------------------------------
const text = (max: number) => z.string().trim().max(max).default('');
const date = z
  .union([z.literal(''), z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, 'Use YYYY or YYYY-MM')])
  .default('');
const email = z.union([z.literal(''), z.string().trim().toLowerCase().email().max(254)]).default('');
// z.string().url() accepts "javascript:..."; only http(s) links may be stored or rendered.
const url = z
  .union([
    z.literal(''),
    z
      .string()
      .trim()
      .max(300)
      .url()
      .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) links are allowed'),
  ])
  .default('');
const richText = z.string().max(8000).default('').transform(sanitizeRich);

export const templateIdSchema = z.enum(TEMPLATE_IDS);
const titleSchema = z.string().trim().min(1).max(100);

// ---- resume content ---------------------------------------------------------------------------
const personalInfoFields = {
  fullName: text(120),
  email,
  phone: text(30),
  location: text(120),
  linkedin: url,
  github: url,
  website: url,
};
const educationFields = { institution: text(150), degree: text(150), field: text(150), startDate: date, endDate: date, grade: text(50) };
const experienceFields = { company: text(150), title: text(150), location: text(120), startDate: date, endDate: date, current: z.boolean().default(false) };
const projectFields = { name: text(150), url, technologies: z.array(z.string().trim().min(1).max(60)).max(30).default([]) };
const certificationSchema = z.object({ name: text(150), issuer: text(150), date, url });
const skillGroupSchema = z.object({
  category: text(60),
  items: z.array(z.string().trim().min(1).max(60)).max(60).default([]),
});

const personalInfoObject = z.object(personalInfoFields);
export const resumeDataSchema = z
  .object({
    personalInfo: personalInfoObject.default({}),
    summary: richText,
    education: z.array(z.object({ ...educationFields, description: richText })).max(20).default([]),
    experience: z.array(z.object({ ...experienceFields, description: richText })).max(30).default([]),
    skills: z.array(skillGroupSchema).max(20).default([]),
    projects: z.array(z.object({ ...projectFields, description: richText })).max(20).default([]),
    certifications: z.array(certificationSchema).max(30).default([]),
    achievements: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  })
  .strict(); // unknown top-level keys are rejected

export type ResumeData = z.infer<typeof resumeDataSchema>;

// ---- requests ---------------------------------------------------------------------------------
export const createResumeSchema = z.object({
  title: titleSchema,
  templateId: templateIdSchema.default('modern'),
  data: resumeDataSchema.default({}),
});

export const updateResumeSchema = z
  .object({
    title: titleSchema.optional(),
    templateId: templateIdSchema.optional(),
    data: resumeDataSchema.optional(),
    // Optimistic concurrency: if given, the update only applies when the stored version still matches.
    baseVersion: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((v) => v.title !== undefined || v.templateId !== undefined || v.data !== undefined, 'Nothing to update');

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  search: z.string().trim().max(100).optional(),
  templateId: templateIdSchema.optional(),
  sort: z.string().regex(/^-?(createdAt|updatedAt|title)$/, 'Invalid sort field').default('-updatedAt'),
});

export const previewQuerySchema = z.object({ template: templateIdSchema.optional() });

// ---- AI generation input: the facts come from the user, the AI only writes prose ---------------
const notes = z.string().trim().max(3000).default('');
export const generateInputSchema = z.object({
  title: titleSchema.default('My Resume'),
  templateId: templateIdSchema.default('modern'),
  targetRole: z.string().trim().max(120).optional(),
  jobDescription: z.string().trim().max(4000).optional(),
  profile: z.object({
    personalInfo: personalInfoObject.extend({ fullName: z.string().trim().min(1).max(120) }),
    education: z.array(z.object({ ...educationFields, description: notes })).max(20).default([]),
    experience: z.array(z.object({ ...experienceFields, description: notes })).max(30).default([]),
    skills: z.array(z.string().trim().min(1).max(60)).max(60).default([]),
    projects: z.array(z.object({ ...projectFields, description: notes })).max(20).default([]),
    certifications: z.array(certificationSchema).max(30).default([]),
    achievements: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  }),
});

export type GenerateInput = z.infer<typeof generateInputSchema>;
export type UpdateResumeInput = z.infer<typeof updateResumeSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
