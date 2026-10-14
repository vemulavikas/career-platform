import { Schema, model } from 'mongoose';
import { TEMPLATE_IDS } from '../templates';

const s = (max: number) => ({ type: String, trim: true, maxlength: max, default: '' });
const strings = (max: number) => ({ type: [{ type: String, trim: true, maxlength: max }], default: [] });

const personalInfo = new Schema(
  { fullName: s(120), email: s(254), phone: s(30), location: s(120), linkedin: s(300), github: s(300), website: s(300) },
  { _id: false },
);
const education = new Schema(
  { institution: s(150), degree: s(150), field: s(150), startDate: s(7), endDate: s(7), grade: s(50), description: s(8000) },
  { _id: false },
);
const experience = new Schema(
  { company: s(150), title: s(150), location: s(120), startDate: s(7), endDate: s(7), current: { type: Boolean, default: false }, description: s(8000) },
  { _id: false },
);
const skillGroup = new Schema({ category: s(60), items: strings(60) }, { _id: false });
const project = new Schema({ name: s(150), url: s(300), technologies: strings(60), description: s(8000) }, { _id: false });
const certification = new Schema({ name: s(150), issuer: s(150), date: s(7), url: s(300) }, { _id: false });

// The structured content. Presentation lives in templates, never here.
export const resumeDataSchemaMongoose = new Schema(
  {
    personalInfo: { type: personalInfo, default: () => ({}) },
    summary: s(8000),
    education: { type: [education], default: [] },
    experience: { type: [experience], default: [] },
    skills: { type: [skillGroup], default: [] },
    projects: { type: [project], default: [] },
    certifications: { type: [certification], default: [] },
    achievements: strings(300),
  },
  { _id: false },
);

const transform = (_doc: unknown, ret: any) => {
  ret.id = ret._id.toString();
  delete ret._id;
  delete ret.__v;
  return ret;
};

const resumeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    templateId: { type: String, enum: TEMPLATE_IDS, default: 'modern' },
    version: { type: Number, default: 1 },
    // Embedded: the content is always read and written as one unit and is bounded in size.
    data: { type: resumeDataSchemaMongoose, default: () => ({}) },
  },
  { timestamps: true },
);
// "My resumes, most recently edited first" + dashboard count.
resumeSchema.index({ userId: 1, updatedAt: -1 });
resumeSchema.set('toJSON', { transform });

export const Resume = model('Resume', resumeSchema);

// Version history lives in its own collection so listing resumes never drags old snapshots along.
const resumeVersionSchema = new Schema(
  {
    resumeId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    version: { type: Number, required: true },
    title: { type: String, required: true },
    templateId: { type: String, required: true },
    reason: { type: String, enum: ['create', 'update', 'restore', 'duplicate', 'ai-generate'], required: true },
    data: { type: resumeDataSchemaMongoose, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
// Unique: a (resume, version) pair exists once. Also serves "versions of this resume, newest first".
resumeVersionSchema.index({ resumeId: 1, version: -1 }, { unique: true });
resumeVersionSchema.set('toJSON', { transform });

export const ResumeVersion = model('ResumeVersion', resumeVersionSchema);
