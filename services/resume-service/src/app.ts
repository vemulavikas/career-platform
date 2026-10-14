import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import type { AiClient } from './ai.client';
import { config } from './config';
import { AppError } from './errors';
import { Gate } from './gate';
import { logger } from './logger';
import { errorHandler } from './middleware';
import { createResumeRouter } from './routes';

export interface AppDeps {
  ai: AiClient;
  gate?: Gate;
  generateRateLimitPerMin?: number;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '1mb' })); // resume content can be sizeable
  if (config.NODE_ENV !== 'test') app.use(pinoHttp({ logger }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'resume-service' }));
  app.use(
    '/api/resumes',
    createResumeRouter({
      ai: deps.ai,
      gate: deps.gate ?? new Gate(config.MAX_CONCURRENT_GENERATIONS, config.GENERATION_QUEUE_LIMIT),
      generateRateLimitPerMin: deps.generateRateLimitPerMin ?? config.GENERATE_RATE_LIMIT_PER_MIN,
    }),
  );

  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  app.use(errorHandler);
  return app;
}
