import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import type { BookingProviders } from './booking.service';
import { config } from './config';
import { AppError } from './errors';
import { errorHandler, requireInternalKey } from './middleware';
import { logger } from './logger';
import { createBookingRouter, createConsultantRouter, webhookHandler } from './routes';

export interface AppDeps extends BookingProviders {}

export function createApp(providers: AppDeps) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  if (config.NODE_ENV !== 'test') app.use(pinoHttp({ logger }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'booking-service' }));

  app.post(
    '/api/payments/webhook',
    rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }),
    express.raw({ type: 'application/json', limit: '256kb' }),
    webhookHandler(providers),
  );

  app.use(express.json({ limit: '20kb' }));
  app.use('/api', requireInternalKey);
  app.use('/api/consultants', createConsultantRouter());
  app.use('/api/bookings', createBookingRouter(providers));
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  app.use(errorHandler);
  return app;
}
