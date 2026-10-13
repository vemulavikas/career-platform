import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import * as authService from './auth.service';
import { asyncHandler, authenticate, validate } from './middleware';
import { loginSchema, refreshSchema, registerSchema, updateMeSchema } from './validation';

// Brute-force protection on credential endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.NODE_ENV === 'test',
  handler: (_req, res) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } }),
});

export const authRouter = Router();

authRouter.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { user, tokens } = await authService.register(req.body);
    res.status(201).json({ user, tokens });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { user, tokens } = await authService.login(req.body);
    res.json({ user, tokens });
  }),
);

authRouter.post(
  '/refresh',
  authLimiter,
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    const { tokens } = await authService.refresh(req.body.refreshToken);
    res.json({ tokens });
  }),
);

authRouter.post(
  '/logout',
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    await authService.logout(req.body.refreshToken);
    res.status(204).send();
  }),
);

export const usersRouter = Router();

usersRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: await authService.getProfile(req.auth!.userId) });
  }),
);

usersRouter.patch(
  '/me',
  authenticate,
  validate(updateMeSchema),
  asyncHandler(async (req, res) => {
    res.json({ user: await authService.updateProfile(req.auth!.userId, req.body) });
  }),
);
