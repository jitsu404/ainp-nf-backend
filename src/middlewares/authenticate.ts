import type { RequestHandler } from 'express';
import { AUTH_COOKIE } from '../config/constants.js';
import { tagHandler } from '../docs/routeMeta.js';
import { verifyToken } from '../modules/auth/auth.service.js';
import { findActiveUserById } from '../modules/users/users.service.js';
import { AppError } from '../utils/AppError.js';

/**
 * Verifies the session cookie and loads the user into req.user.
 * The user is re-read from the database on every request, so deactivating an account
 * or changing its role takes effect immediately rather than when the token expires.
 */
export const authenticate: RequestHandler = tagHandler<RequestHandler>(
  async (req, _res, next) => {
    const token: unknown = req.cookies?.[AUTH_COOKIE];
    if (typeof token !== 'string' || token.length === 0) throw AppError.unauthorized('AUTH_REQUIRED');

    const { sub } = verifyToken(token);
    const user = await findActiveUserById(sub);
    if (!user) throw AppError.unauthorized('INVALID_TOKEN', 'Invalid session, please sign in again');

    req.user = {
      id: user.id,
      roleId: user.roleId,
      centreId: user.centreId ? user.centreId.toString() : null,
      name: user.name,
    };
    next();
  },
  { requiresAuth: true },
);
