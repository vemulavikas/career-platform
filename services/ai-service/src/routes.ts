import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as chat from './chat.service';
import { AppError } from './errors';
import type { LLMProvider } from './llm/provider';
import { asyncHandler, internalAuth, OBJECT_ID, validate } from './middleware';
import {
  createSessionSchema,
  getSessionQuery,
  listSessionsQuery,
  renameSessionSchema,
  sendMessageSchema,
} from './validation';

export function createChatRouter(deps: { llm: LLMProvider; aiRateLimitPerMin: number }) {
  const { llm } = deps;
  const router = Router();
  router.use(internalAuth);

  // AI-specific rate limit: LLM calls cost money, so they get their own, per-user (not per-IP) budget.
  const aiLimiter = rateLimit({
    windowMs: 60_000,
    limit: deps.aiRateLimitPerMin,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth!.userId,
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many AI requests, slow down.' } }),
  });

  router.param('id', (_req, _res, next, id) => {
    if (!OBJECT_ID.test(id)) return next(new AppError(404, 'SESSION_NOT_FOUND', 'Chat session not found'));
    next();
  });

  router.post(
    '/sessions',
    validate(createSessionSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json({ session: await chat.createSession(req.auth!.userId, req.body.title) });
    }),
  );

  router.get(
    '/sessions',
    validate(listSessionsQuery, 'query'),
    asyncHandler(async (req, res) => {
      res.json(await chat.listSessions(req.auth!.userId, req.query as any));
    }),
  );

  router.get(
    '/sessions/:id',
    validate(getSessionQuery, 'query'),
    asyncHandler(async (req, res) => {
      const limit = (req.query as any).limit as number;
      res.json(await chat.getSessionWithMessages(req.auth!.userId, req.params.id, limit));
    }),
  );

  router.patch(
    '/sessions/:id',
    validate(renameSessionSchema),
    asyncHandler(async (req, res) => {
      res.json({ session: await chat.renameSession(req.auth!.userId, req.params.id, req.body.title) });
    }),
  );

  router.delete(
    '/sessions/:id',
    asyncHandler(async (req, res) => {
      await chat.deleteSession(req.auth!.userId, req.params.id);
      res.status(204).send();
    }),
  );

  // Request/response flow: load context -> call LLM -> persist -> return.
  router.post(
    '/sessions/:id/messages',
    aiLimiter,
    validate(sendMessageSchema),
    asyncHandler(async (req, res) => {
      const { session, context } = await chat.prepareContext(req.auth!.userId, req.params.id, req.body.content);

      // If the browser goes away, stop paying for a response nobody will read.
      const ac = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) ac.abort();
      });

      const result = await llm.complete(context, ac.signal);
      res.status(201).json(await chat.saveExchange(session, req.body.content, result));
    }),
  );

  // Same flow, delivered as Server-Sent Events: `delta` events while generating, then one `done`.
  router.post(
    '/sessions/:id/messages/stream',
    aiLimiter,
    validate(sendMessageSchema),
    asyncHandler(async (req, res) => {
      const { session, context } = await chat.prepareContext(req.auth!.userId, req.params.id, req.body.content);

      const ac = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) ac.abort();
      });

      const send = (event: string, data: unknown) => {
        if (res.writableEnded || res.destroyed) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      // Headers are sent lazily, on the first event. A failure before any token arrives is therefore
      // still a normal JSON error with a real HTTP status (e.g. 504), not a 200 with an error inside.
      const openStream = () => {
        if (res.headersSent) return;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
      };

      let full = '';
      try {
        for await (const ev of llm.stream(context, ac.signal)) {
          if (ev.type === 'delta') {
            openStream();
            full += ev.text;
            send('delta', { text: ev.text });
          } else {
            const saved = await chat.saveExchange(session, req.body.content, {
              content: full,
              usage: ev.usage,
              model: ev.model,
            });
            openStream();
            send('done', { userMessage: saved.userMessage, assistantMessage: saved.assistantMessage });
          }
        }
        res.end();
      } catch (err) {
        if (!res.headersSent) throw err;
        const e = err instanceof AppError ? err : new AppError(500, 'INTERNAL_ERROR', 'Something went wrong');
        send('error', { code: e.code, message: e.message });
        res.end();
      }
    }),
  );

  return router;
}
