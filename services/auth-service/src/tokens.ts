import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from './config';
import type { Role } from './models/user.model';

export interface AccessPayload {
  sub: string;
  role: Role;
}

export function signAccessToken(userId: string, role: Role): string {
  return jwt.sign({ role }, config.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  const p = jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  return { sub: String(p.sub), role: p.role as Role };
}

export const generateRefreshToken = (): string => crypto.randomBytes(48).toString('hex');
export const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');
