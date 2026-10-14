import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { config } from './config';
import { AppError } from './errors';
import { logger } from './logger';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export function requireInternalKey(req: Request, _res: Response, next: NextFunction) {
  const expected = config.INTERNAL_SERVICE_SECRET;
  if (!expected) return next(new AppError(503, 'SERVICE_MISCONFIGURED', 'Internal service authentication is unavailable'));
  const provided = req.header('x-internal-key') ?? '';
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    return next(new AppError(401, 'UNAUTHORIZED_SERVICE', 'Invalid service credentials'));
  }
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  const userId = req.header('x-user-id');
  if (!userId || !/^[a-f\d]{24}$/i.test(userId)) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'A valid user identity is required'));
  }
  req.userId = userId;
  next();
}

export const validate =
  (schema: ZodTypeAny) => (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new AppError(400, 'VALIDATION_ERROR', 'Invalid request body', result.error.flatten()));
    }
    req.body = result.data;
    next();
  };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
  }
  if ((err as { type?: string })?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
  }
  logger.error({ errorName: err instanceof Error ? err.name : 'UnknownError' }, 'request failed');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}
