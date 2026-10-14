import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4003),
  MONGO_URI: z.string().min(1),
  INTERNAL_SERVICE_SECRET: z.string().min(16),
  AI_SERVICE_URL: z.string().url().default('http://localhost:4002'),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().default(90000),
  MAX_CONCURRENT_GENERATIONS: z.coerce.number().min(1).default(5),
  GENERATION_QUEUE_LIMIT: z.coerce.number().min(0).default(20),
  GENERATE_RATE_LIMIT_PER_MIN: z.coerce.number().default(5),
  MAX_VERSIONS_PER_RESUME: z.coerce.number().min(1).default(30),
});

export const config = schema.parse(process.env);
