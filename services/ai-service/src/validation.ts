import { z } from 'zod';

const title = z.string().trim().min(1).max(100);

export const createSessionSchema = z.object({ title: title.optional() });
export const renameSessionSchema = z.object({ title });
export const sendMessageSchema = z.object({ content: z.string().trim().min(1).max(4000) });

export const listSessionsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(100).optional(),
});

export const getSessionQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
