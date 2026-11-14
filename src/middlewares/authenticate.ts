import type { RequestHandler } from 'express';
import { AUTH_COOKIE } from '../config/constants.js';
import { tagHandler } from '../docs/routeMeta.js';
import { verifyToken } from '../modules/auth/auth.service.js';
import { findActiveUserById } from '../modules/users/users.service.js';
import { AppError } from '../utils/AppError.js';

/** Allowed clock skew between issuing a token and recording a password change. */
const PASSWORD_CHANGE_GRACE_MS = 1000;

const loadUser =
  (allowPendingPasswordChange: boolean): RequestHandler =>
  async (req, _res, next) => {
    const token: unknown = req.cookies?.[AUTH_COOKIE];
    if (typeof token !== 'string' || token.length === 0) throw AppError.unauthorized('AUTH_REQUIRED');

    const { sub, iat } = verifyToken(token);
    const user = await findActiveUserById(sub);
    if (!user) throw AppError.unauthorized('INVALID_TOKEN', 'Invalid session, please sign in again');

    // A password reset or change ends every session started before it.
    if (user.passwordChangedAt && iat * 1000 < user.passwordChangedAt.getTime() - PASSWORD_CHANGE_GRACE_MS) {
      throw AppError.unauthorized('SESSION_EXPIRED', 'Your password was changed, please sign in again');
    }
    if (user.mustChangePassword && !allowPendingPasswordChange) {
      throw AppError.forbidden(
        'PASSWORD_CHANGE_REQUIRED',
        'Change your temporary password before continuing',
      );
    }

    req.user = {
      id: user.id,
      roleId: user.roleId,
      centreId: user.centreId ? user.centreId.toString() : null,
      name: user.name,
      mustChangePassword: user.mustChangePassword,
    };
    next();
  };

/**
 * Verifies the session cookie and loads the user into req.user.
 * The user is re-read from the database on every request, so deactivating an account or changing
 * its role takes effect immediately. Users still on a temporary password get 403
 * PASSWORD_CHANGE_REQUIRED until they change it.
 */
export const authenticate: RequestHandler = tagHandler(loadUser(false), { requiresAuth: true });

/**
 * Same as authenticate, but lets users with a temporary password through.
 * Only for: who am I, change my password, sign out.
 */
export const authenticateAllowingPasswordChange: RequestHandler = tagHandler(loadUser(true), {
  requiresAuth: true,
});
