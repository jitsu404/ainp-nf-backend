import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { ROLE_IDS } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { BCRYPT_COST, findUserByEmailWithPassword, markLoggedIn } from '../users/users.service.js';
import type { LoginDto } from './auth.dto.js';

// Compared against when the email doesn't exist, so a wrong email and a wrong password
// take the same time and attackers can't use timing to discover valid accounts.
const DUMMY_HASH = bcrypt.hashSync('timing-safe-placeholder', BCRYPT_COST);

const tokenPayload = z.object({
  sub: z.string(),
  roleId: z.enum(ROLE_IDS),
});

export type TokenPayload = z.infer<typeof tokenPayload>;

const invalidCredentials = () =>
  AppError.unauthorized('INVALID_CREDENTIALS', 'Email or password is incorrect');

export const signToken = (payload: TokenPayload): string =>
  jwt.sign(payload, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN });

/** Throws JsonWebTokenError / TokenExpiredError (mapped to 401 by the error handler). */
export const verifyToken = (token: string): TokenPayload => {
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  const parsed = tokenPayload.safeParse(decoded);
  if (!parsed.success) throw AppError.unauthorized('INVALID_TOKEN', 'Invalid session, please sign in again');
  return parsed.data;
};

export const login = async ({ email, password }: LoginDto, meta: { requestId: string; ip?: string }) => {
  const user = await findUserByEmailWithPassword(email);
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordOk) {
    logger.warn('Failed sign-in', { email, ...meta });
    throw invalidCredentials();
  }
  if (!user.isActive) {
    logger.warn('Sign-in attempt on deactivated account', { userId: user.id, ...meta });
    throw invalidCredentials();
  }

  await markLoggedIn(user.id);
  logger.info('User signed in', { userId: user.id, roleId: user.roleId, ...meta });

  return { user, token: signToken({ sub: user.id, roleId: user.roleId }) };
};
