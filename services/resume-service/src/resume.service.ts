import { config } from './config';
import { AppError } from './errors';
import { Resume, ResumeVersion } from './models/resume.model';
import type { ListQuery, UpdateResumeInput } from './validation';
import type { TemplateId } from './templates';

const notFound = () => new AppError(404, 'RESUME_NOT_FOUND', 'Resume not found');
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type VersionReason = 'create' | 'update' | 'restore' | 'duplicate' | 'ai-generate';

interface Snapshottable {
  _id: any;
  userId: any;
  version: number;
  title: string;
  templateId: string;
  toObject(): any;
}

// Every ownership check is part of the query itself (_id AND userId): another user's resume is a plain 404.
async function getOwned(userId: string, id: string) {
  const resume = await Resume.findOne({ _id: id, userId });
  if (!resume) throw notFound();
  return resume;
}

/** Stores a snapshot of this version and prunes anything older than the retention window. */
async function snapshot(doc: Snapshottable, reason: VersionReason) {
  await ResumeVersion.create({
    resumeId: doc._id,
    userId: doc.userId,
    version: doc.version,
    title: doc.title,
    templateId: doc.templateId,
    data: doc.toObject().data,
    reason,
  });
  await ResumeVersion.deleteMany({ resumeId: doc._id, version: { $lte: doc.version - config.MAX_VERSIONS_PER_RESUME } });
}

export async function createResume(
  userId: string,
  input: { title: string; templateId: TemplateId; data: unknown },
  reason: VersionReason = 'create',
) {
  const resume = await Resume.create({ userId, title: input.title, templateId: input.templateId, data: input.data });
  await snapshot(resume, reason);
  return resume;
}

export async function listResumes(userId: string, q: ListQuery) {
  const filter: Record<string, unknown> = { userId };
  if (q.search) filter.title = { $regex: escapeRegex(q.search), $options: 'i' };
  if (q.templateId) filter.templateId = q.templateId;

  const field = q.sort.replace('-', '');
  const direction = q.sort.startsWith('-') ? -1 : 1;

  const [items, total] = await Promise.all([
    Resume.find(filter)
      // List cards need the title and the person's name, not the whole document.
      .select('title templateId version createdAt updatedAt data.personalInfo.fullName')
      .sort({ [field]: direction, _id: direction })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit),
    Resume.countDocuments(filter),
  ]);
  return { items, page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) };
}

export const getResume = getOwned;

/**
 * Partial update. With `baseVersion` it is a compare-and-set: the update only applies if nobody else
 * changed the resume since the client loaded it (safe for autosave from several tabs).
 */
export async function updateResume(userId: string, id: string, input: UpdateResumeInput) {
  const set: Record<string, unknown> = {};
  if (input.title !== undefined) set.title = input.title;
  if (input.templateId !== undefined) set.templateId = input.templateId;
  if (input.data !== undefined) set.data = input.data;

  const filter: Record<string, unknown> = { _id: id, userId };
  if (input.baseVersion !== undefined) filter.version = input.baseVersion;

  const updated = await Resume.findOneAndUpdate(filter, { $set: set, $inc: { version: 1 } }, { new: true, runValidators: true });
  if (!updated) {
    const exists = await Resume.exists({ _id: id, userId });
    throw exists
      ? new AppError(409, 'VERSION_CONFLICT', 'This resume was changed elsewhere. Reload it and try again.')
      : notFound();
  }
  await snapshot(updated, 'update');
  return updated;
}

export async function deleteResume(userId: string, id: string) {
  const resume = await Resume.findOneAndDelete({ _id: id, userId });
  if (!resume) throw notFound();
  await ResumeVersion.deleteMany({ resumeId: resume._id });
}

export async function duplicateResume(userId: string, id: string) {
  const src = await getOwned(userId, id);
  const copy = await Resume.create({
    userId,
    title: `${src.title} (copy)`.slice(0, 100),
    templateId: src.templateId,
    data: src.toObject().data,
  });
  await snapshot(copy, 'duplicate');
  return copy;
}

export async function listVersions(userId: string, id: string) {
  const resume = await getOwned(userId, id);
  return ResumeVersion.find({ resumeId: resume._id }).sort({ version: -1 }).select('-data');
}

async function getVersion(userId: string, id: string, version: number) {
  const resume = await getOwned(userId, id);
  const snap = await ResumeVersion.findOne({ resumeId: resume._id, version });
  if (!snap) throw new AppError(404, 'VERSION_NOT_FOUND', 'Version not found (it may have been pruned)');
  return snap;
}
export const readVersion = getVersion;

/** Restoring never rewrites history: it creates a NEW version whose content equals the old one. */
export async function restoreVersion(userId: string, id: string, version: number) {
  const snap = await getVersion(userId, id, version);
  const updated = await Resume.findOneAndUpdate(
    { _id: id, userId },
    { $set: { title: snap.title, templateId: snap.templateId, data: snap.toObject().data }, $inc: { version: 1 } },
    { new: true },
  );
  if (!updated) throw notFound();
  await snapshot(updated, 'restore');
  return updated;
}
