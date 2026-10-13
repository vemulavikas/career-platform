import crypto from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { config } from './config';
import { AppError } from './errors';
import { logger } from './logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string };
    }
  }
}

export const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const digest = (s: string) => crypto.createHash('sha256').update(s).digest();
// Hash first so both buffers have equal length, then compare in constant time.
const safeEqual = (a: string, b: string) => crypto.timingSafeEqual(digest(a), digest(b));

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/**
 * Service-to-service auth. The gateway verifies the user's JWT, then calls this service with a shared
 * secret (x-internal-key) plus the verified identity (x-user-id). Anyone who can reach this port
 * directly but lacks the secret is rejected.
 */
export function internalAuth(req: Request, _res: Response, next: NextFunction) {
  const key = req.headers['x-internal-key'];
  const userId = req.headers['x-user-id'];
  if (typeof key !== 'string' || !safeEqual(key, config.INTERNAL_SERVICE_SECRET)) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Invalid service credentials'));
  }
  if (typeof userId !== 'string' || !OBJECT_ID.test(userId)) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Missing user identity'));
  }
  req.auth = { userId };
  next();
}

export const validate =
  (schema: ZodTypeAny, source: 'body' | 'query' = 'body'): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(source === 'body' ? req.body : req.query);
    if (!result.success) {
      return next(new AppError(400, 'VALIDATION_ERROR', `Invalid request ${source}`, result.error.flatten()));
    }
    if (source === 'body') req.body = result.data;
    else req.query = result.data as any;
    next();
  };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
  }
  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}
