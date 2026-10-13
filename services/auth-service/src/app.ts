import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config';
import { AppError } from './errors';
import { logger } from './logger';
import { errorHandler } from './middleware';
import { authRouter, usersRouter } from './routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // real client IP comes from the gateway's X-Forwarded-For
  app.disable('x-powered-by');
  app.use(helmet());
  // No CORS here: this service is internal; browsers only talk to the gateway.
  app.use(express.json({ limit: '10kb' }));
  if (config.NODE_ENV !== 'test') app.use(pinoHttp({ logger }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'auth-service' }));
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);

  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  app.use(errorHandler);
  return app;
}
