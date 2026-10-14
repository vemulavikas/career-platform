import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { AiClient } from './ai.client';
import type { Gate } from './gate';
import { generateResume } from './generate.service';
import { asyncHandler, internalAuth, OBJECT_ID, validate } from './middleware';
import { AppError } from './errors';
import { renderResume } from './render';
import * as svc from './resume.service';
import { listTemplates } from './templates';
import {
  createResumeSchema,
  generateInputSchema,
  listQuerySchema,
  previewQuerySchema,
  resumeDataSchema,
  updateResumeSchema,
  type ResumeData,
} from './validation';

export interface RouterDeps {
  ai: AiClient;
  gate: Gate;
  generateRateLimitPerMin: number;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'resume';

export function createResumeRouter(deps: RouterDeps) {
  const router = Router();
  router.use(internalAuth);

  const generateLimiter = rateLimit({
    windowMs: 60_000,
    limit: deps.generateRateLimitPerMin,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth!.userId,
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many generation requests, slow down.' } }),
  });

  router.param('id', (_req, _res, next, id) =>
    OBJECT_ID.test(id) ? next() : next(new AppError(404, 'RESUME_NOT_FOUND', 'Resume not found')),
  );
  router.param('version', (_req, _res, next, v) =>
    /^\d+$/.test(v) ? next() : next(new AppError(404, 'VERSION_NOT_FOUND', 'Version not found')),
  );

  // Fixed paths first, so "templates" / "generate" are never mistaken for an :id.
  router.get('/templates', (_req, res) => {
    res.json({ templates: listTemplates() });
  });

  router.post(
    '/generate',
    generateLimiter,
    validate(generateInputSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json({ resume: await generateResume(req.auth!.userId, req.body, deps) });
    }),
  );

  router.post(
    '/',
    validate(createResumeSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json({ resume: await svc.createResume(req.auth!.userId, req.body) });
    }),
  );

  router.get(
    '/',
    validate(listQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      res.json(await svc.listResumes(req.auth!.userId, req.query as any));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json({ resume: await svc.getResume(req.auth!.userId, req.params.id) });
    }),
  );

  router.patch(
    '/:id',
    validate(updateResumeSchema),
    asyncHandler(async (req, res) => {
      res.json({ resume: await svc.updateResume(req.auth!.userId, req.params.id, req.body) });
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await svc.deleteResume(req.auth!.userId, req.params.id);
      res.status(204).send();
    }),
  );

  router.post(
    '/:id/duplicate',
    asyncHandler(async (req, res) => {
      res.status(201).json({ resume: await svc.duplicateResume(req.auth!.userId, req.params.id) });
    }),
  );

  router.get(
    '/:id/versions',
    asyncHandler(async (req, res) => {
      res.json({ items: await svc.listVersions(req.auth!.userId, req.params.id) });
    }),
  );

  router.get(
    '/:id/versions/:version',
    asyncHandler(async (req, res) => {
      res.json({ version: await svc.readVersion(req.auth!.userId, req.params.id, Number(req.params.version)) });
    }),
  );

  router.post(
    '/:id/versions/:version/restore',
    asyncHandler(async (req, res) => {
      res.json({ resume: await svc.restoreVersion(req.auth!.userId, req.params.id, Number(req.params.version)) });
    }),
  );

  // Preview/export: same stored data, any template. `?template=` previews another template without saving.
  const renderFor = async (req: any) => {
    const resume = await svc.getResume(req.auth.userId, req.params.id);
    const data = resumeDataSchema.parse(resume.toObject().data) as ResumeData;
    const template = (req.query.template ?? resume.templateId) as any;
    return { resume, html: renderResume(data, template) };
  };
  const HTML_HEADERS = {
    'Content-Type': 'text/html; charset=utf-8',
    // The page is static: no scripts, no remote resources, and it must not be framed or sniffed.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    'X-Content-Type-Options': 'nosniff',
  };

  router.get(
    '/:id/preview',
    validate(previewQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const { html } = await renderFor(req);
      res.set(HTML_HEADERS).send(html);
    }),
  );

  router.get(
    '/:id/export',
    validate(previewQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const { resume, html } = await renderFor(req);
      res.set({ ...HTML_HEADERS, 'Content-Disposition': `attachment; filename="${slug(resume.title)}.html"` }).send(html);
    }),
  );

  return router;
}
