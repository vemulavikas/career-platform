import bcrypt from 'bcryptjs';
import { config } from './config';
import { AppError } from './errors';
import { User } from './models/user.model';
import { RefreshToken } from './models/refreshToken.model';
import { generateRefreshToken, hashToken, signAccessToken } from './tokens';
import type { LoginInput, RegisterInput, UpdateMeInput } from './validation';

// Compared against when the email is unknown so login timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', config.BCRYPT_ROUNDS);

async function issueTokens(user: { id?: string; _id: unknown; role: any }) {
  const userId = user.id ?? String(user._id);
  const accessToken = signAccessToken(userId, user.role);
  const refreshToken = generateRefreshToken();
  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
  return { accessToken, refreshToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS };
}

export async function register(input: RegisterInput) {
  const passwordHash = await bcrypt.hash(input.password, config.BCRYPT_ROUNDS);
  try {
    // Explicit field list: the client can never set role or passwordHash (mass-assignment protection).
    const user = await User.create({
      name: input.name,
      email: input.email,
      phone: input.phone,
      passwordHash,
    });
    return { user, tokens: await issueTokens(user) };
  } catch (err: any) {
    if (err?.code === 11000) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw err;
  }
}

export async function login(input: LoginInput) {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  return { user, tokens: await issueTokens(user) };
}

/**
 * Refresh-token rotation with reuse detection.
 * - Each refresh token is single-use.
 * - Presenting an already-used token means it may have been stolen: revoke every session of that user.
 * - The revoke is an atomic conditional update, so two concurrent refreshes cannot both succeed.
 */
export async function refresh(rawToken: string) {
  const stored = await RefreshToken.findOne({ tokenHash: hashToken(rawToken) });
  if (!stored) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');

  if (stored.revokedAt) {
    await RefreshToken.updateMany({ userId: stored.userId, revokedAt: null }, { revokedAt: new Date() });
    throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token already used; please log in again');
  }
  if (stored.expiresAt.getTime() < Date.now()) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token expired');
  }

  const claimed = await RefreshToken.findOneAndUpdate(
    { _id: stored._id, revokedAt: null },
    { revokedAt: new Date() },
  );
  if (!claimed) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');

  const user = await User.findById(stored.userId);
  if (!user) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  return { tokens: await issueTokens(user) };
}

// Idempotent: logging out with an unknown/already-revoked token is not an error.
export async function logout(rawToken: string) {
  await RefreshToken.updateOne({ tokenHash: hashToken(rawToken), revokedAt: null }, { revokedAt: new Date() });
}

export async function getProfile(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  return user;
}

export async function updateProfile(userId: string, input: UpdateMeInput) {
  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.phone !== undefined) set.phone = input.phone;
  if (input.profile) {
    for (const [key, value] of Object.entries(input.profile)) set[`profile.${key}`] = value;
  }
  const user = await User.findByIdAndUpdate(userId, { $set: set }, { new: true, runValidators: true });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  return user;
}
