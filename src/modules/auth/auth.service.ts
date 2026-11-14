import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { HydratedDocument } from 'mongoose';
import { ASSIGNABLE_ROLES, ROLE_IDS, ROLES } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';
import { BCRYPT_COST, findUserByEmailWithPassword, markLoggedIn } from '../users/users.service.js';
import type { User } from '../users/users.model.js';
import type { LoginDto } from './auth.dto.js';

// Compared against when the email doesn't exist, so a wrong email and a wrong password
// take the same time and attackers can't use timing to discover valid accounts.
const DUMMY_HASH = bcrypt.hashSync('timing-safe-placeholder', BCRYPT_COST);

const tokenPayload = z.object({
  sub: z.string(),
  roleId: z.enum(ROLE_IDS),
  /** Issued-at (seconds), added by jsonwebtoken; used to end sessions older than a password change. */
  iat: z.number(),
});

export type TokenPayload = Omit<z.infer<typeof tokenPayload>, 'iat'>;
export type VerifiedToken = z.infer<typeof tokenPayload>;

/**
 * What the client needs to know about the signed-in user. The role's label, scope and
 * capabilities come from the server, so the client doesn't keep its own copy of the rules.
 */
export const sessionOf = (user: HydratedDocument<User>) => ({
  user: user.toJSON(),
  role: { id: user.roleId, label: ROLES[user.roleId].label, scope: ROLES[user.roleId].scope },
  capabilities: ROLES[user.roleId].capabilities,
  assignableRoles: ASSIGNABLE_ROLES[user.roleId].map((id) => ({ id, label: ROLES[id].label })),
  mustChangePassword: user.mustChangePassword,
});

const invalidCredentials = () =>
  AppError.unauthorized('INVALID_CREDENTIALS', 'Email or password is incorrect');

export const signToken = (payload: TokenPayload): string =>
  jwt.sign(payload, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN });

/** Throws JsonWebTokenError / TokenExpiredError (mapped to 401 by the error handler). */
export const verifyToken = (token: string): VerifiedToken => {
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
