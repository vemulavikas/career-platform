import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config';
import { AppError } from './errors';
import type { LLMProvider } from './llm/provider';
import { logger } from './logger';
import { errorHandler } from './middleware';
import { createChatRouter } from './routes';

export interface AppDeps {
  llm: LLMProvider;
  aiRateLimitPerMin?: number;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '16kb' }));
  if (config.NODE_ENV !== 'test') app.use(pinoHttp({ logger }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'ai-service' }));
  app.use(
    '/api/chat',
    createChatRouter({ llm: deps.llm, aiRateLimitPerMin: deps.aiRateLimitPerMin ?? config.AI_RATE_LIMIT_PER_MIN }),
  );

  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  app.use(errorHandler);
  return app;
}
