import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';

const PORT = Number(process.env.PORT ?? 4000);
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
if (!JWT_ACCESS_SECRET || JWT_ACCESS_SECRET.length < 16) {
  throw new Error('JWT_ACCESS_SECRET is missing or too short');
}
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET;
if (!INTERNAL_SERVICE_SECRET || INTERNAL_SERVICE_SECRET.length < 16) {
  throw new Error('INTERNAL_SERVICE_SECRET is missing or too short');
}
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? 'http://localhost:4001';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:4002';
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',');

// Paths that do not need a bearer token. Everything else under /api does.
const PUBLIC_PATHS = [/^\/api\/auth\/(register|login|refresh|logout)$/];

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'api-gateway' }));

// SECURITY: identity headers are set only by this gateway. Strip anything a client sends.
app.use((req, _res, next) => {
  for (const h of ['x-user-id', 'x-user-role', 'x-internal-key']) delete req.headers[h];
  next();
});

// Verify the JWT once at the edge and forward the identity to downstream services.
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  const path = req.originalUrl.split('?')[0];
  if (PUBLIC_PATHS.some((re) => re.test(path))) return next();

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Missing bearer token' } });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    req.headers['x-user-id'] = String(payload.sub);
    req.headers['x-user-role'] = String(payload.role);
    next();
  } catch {
    res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }
});

const onProxyError: NonNullable<Options['on']>['error'] = (_err, _req, res) => {
  const r = res as unknown as Response;
  if (!r.headersSent) {
    r.status(502).json({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Service temporarily unavailable' } });
  }
};

// NOTE: do not add express.json() before the proxies; it would consume the request body.
// Every proxied request carries the shared secret so services can reject callers that bypass the gateway.
const proxyTo = (target: string, paths: string[], extra: Partial<Options> = {}) =>
  createProxyMiddleware({
    target,
    changeOrigin: true,
    xfwd: true,
    pathFilter: paths,
    headers: { 'x-internal-key': INTERNAL_SERVICE_SECRET },
    on: { error: onProxyError },
    ...extra,
  });

app.use(proxyTo(AUTH_SERVICE_URL, ['/api/auth', '/api/users']));
// LLM calls (with retries) can take a while: allow the gateway to wait longer than the AI service's own timeout.
app.use(proxyTo(AI_SERVICE_URL, ['/api/chat'], { proxyTimeout: 120_000, timeout: 120_000 }));

app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));

app.listen(PORT, () => console.log(`api-gateway listening on :${PORT}`));
