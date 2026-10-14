import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import type { LLMProvider } from './llm/provider';
import { asyncHandler, internalAuth, validate } from './middleware';
import { generateSchema } from './validation';

/** One-shot text generation for other services (e.g. the resume service). No chat history is stored. */
export function createGenerateRouter(deps: { llm: LLMProvider; aiRateLimitPerMin: number }) {
  const router = Router();
  router.use(internalAuth);

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: deps.aiRateLimitPerMin,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth!.userId,
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many AI requests, slow down.' } }),
  });

  router.post(
    '/generate',
    limiter,
    validate(generateSchema),
    asyncHandler(async (req, res) => {
      const ac = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) ac.abort();
      });
      const result = await deps.llm.complete(
        [
          { role: 'system', content: req.body.system },
          { role: 'user', content: req.body.prompt },
        ],
        ac.signal,
        { maxTokens: config.GENERATE_MAX_OUTPUT_TOKENS },
      );
      res.json({ content: result.content, usage: result.usage, model: result.model });
    }),
  );

  return router;
}
