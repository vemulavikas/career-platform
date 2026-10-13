import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app';
import { RefreshToken } from '../src/models/refreshToken.model';
import { User } from '../src/models/user.model';

const app = createApp();
let mongo: MongoMemoryServer;

const creds = { name: 'Asha Rao', email: 'asha@example.com', password: 'Passw0rdOK', phone: '+91 9876543210' };
const register = (body: object = creds) => request(app).post('/api/auth/register').send(body);
const refresh = (refreshToken: string) => request(app).post('/api/auth/refresh').send({ refreshToken });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await User.init(); // make sure unique indexes exist before the duplicate-email test
  await RefreshToken.init();
});

afterEach(async () => {
  await User.deleteMany({});
  await RefreshToken.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('POST /api/auth/register', () => {
  it('creates a user, hashes the password and returns tokens', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Asha Rao', email: 'asha@example.com', role: 'USER' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.tokens.accessToken).toEqual(expect.any(String));
    expect(res.body.tokens.refreshToken).toEqual(expect.any(String));

    const stored = await User.findOne({ email: creds.email }).select('+passwordHash');
    expect(stored!.passwordHash).not.toBe(creds.password);
    expect(stored!.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('ignores a client-supplied role (no privilege escalation)', async () => {
    const res = await register({ ...creds, role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('USER');
  });

  it('rejects a duplicate email, case-insensitively, with 409', async () => {
    await register();
    const res = await register({ ...creds, email: 'ASHA@Example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects a weak password with 400', async () => {
    const res = await register({ ...creds, password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an invalid email with 400', async () => {
    const res = await register({ ...creds, email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await register();
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: creds.email, password: creds.password });
    expect(res.status).toBe(200);
    expect(res.body.tokens.accessToken).toEqual(expect.any(String));
  });

  it('returns the same 401 for a wrong password and an unknown email', async () => {
    const wrongPw = await request(app).post('/api/auth/login').send({ email: creds.email, password: 'Wrong123pw' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'Passw0rdOK' });
    expect(wrongPw.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPw.body.error.message).toBe(unknown.body.error.message);
  });
});

describe('protected routes', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });

  it('rejects a garbage token', async () => {
    const res = await request(app).get('/api/users/me').set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const { body } = await register();
    const expired = jwt.sign({ role: 'USER' }, process.env.JWT_ACCESS_SECRET!, {
      subject: body.user.id,
      expiresIn: -10,
    });
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('returns the profile for a valid token', async () => {
    const { body } = await register();
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${body.tokens.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(creds.email);
    expect(res.body.user.passwordHash).toBeUndefined();
  });
});

describe('PATCH /api/users/me', () => {
  it('updates name and profile fields', async () => {
    const { body } = await register();
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${body.tokens.accessToken}`)
      .send({ name: 'Asha R.', profile: { headline: 'Backend Dev', skills: ['Node', 'MongoDB'] } });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Asha R.');
    expect(res.body.user.profile).toMatchObject({ headline: 'Backend Dev', skills: ['Node', 'MongoDB'] });
  });

  it('rejects unknown fields such as role', async () => {
    const { body } = await register();
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${body.tokens.accessToken}`)
      .send({ role: 'ADMIN' });
    expect(res.status).toBe(400);
    const stored = await User.findById(body.user.id);
    expect(stored!.role).toBe('USER');
  });
});

describe('refresh-token rotation', () => {
  it('rotates the token and detects reuse of the old one', async () => {
    const { body } = await register();
    const oldToken = body.tokens.refreshToken;

    const first = await refresh(oldToken);
    expect(first.status).toBe(200);
    expect(first.body.tokens.refreshToken).not.toBe(oldToken);

    // Replaying the old token is treated as theft...
    const replay = await refresh(oldToken);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // ...and every session of that user is revoked, including the freshly issued token.
    const afterReuse = await refresh(first.body.tokens.refreshToken);
    expect(afterReuse.status).toBe(401);
  });

  it('lets only one of two concurrent refreshes succeed', async () => {
    const { body } = await register();
    const results = await Promise.all([refresh(body.tokens.refreshToken), refresh(body.tokens.refreshToken)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('rejects an unknown refresh token', async () => {
    const res = await refresh('does-not-exist');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token and is idempotent', async () => {
    const { body } = await register();
    const token = body.tokens.refreshToken;

    expect((await request(app).post('/api/auth/logout').send({ refreshToken: token })).status).toBe(204);
    expect((await request(app).post('/api/auth/logout').send({ refreshToken: token })).status).toBe(204);
    expect((await refresh(token)).status).toBe(401);
  });
});
