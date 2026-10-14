import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4002),
  MONGO_URI: z.string().min(1),
  INTERNAL_SERVICE_SECRET: z.string().min(16),
  // LLM provider (any OpenAI-compatible chat/completions API)
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  LLM_TIMEOUT_MS: z.coerce.number().default(30000),
  LLM_MAX_RETRIES: z.coerce.number().min(0).max(5).default(2),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().default(1000),
  GENERATE_MAX_OUTPUT_TOKENS: z.coerce.number().default(3000),
  CONTEXT_MAX_CHARS: z.coerce.number().default(12000),
  AI_RATE_LIMIT_PER_MIN: z.coerce.number().default(20),
});

export const config = schema.parse(process.env);
