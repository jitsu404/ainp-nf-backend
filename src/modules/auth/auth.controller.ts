import type { CookieOptions, Request, Response } from 'express';
import { AUTH_COOKIE } from '../../config/constants.js';
import { env, isProduction } from '../../config/env.js';
import { getValidated } from '../../middlewares/validate.js';
import { AppError } from '../../utils/AppError.js';
import { noContent, ok } from '../../utils/response.js';
import { getUser } from '../users/users.service.js';
import type { loginSchemas } from './auth.dto.js';
import * as authService from './auth.service.js';

// The JWT lives only in an httpOnly cookie: page scripts can't read it, which limits XSS damage.
// SameSite=Strict means the client and API must be served from the same site (registrable domain).
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict',
  path: '/',
};

export const login = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof loginSchemas>(req);
  const { user, token } = await authService.login(body, { requestId: req.id, ip: req.ip });
  res.cookie(AUTH_COOKIE, token, { ...cookieOptions, maxAge: env.JWT_EXPIRES_IN * 1000 });
  ok(res, user);
};

export const logout = (_req: Request, res: Response) => {
  res.clearCookie(AUTH_COOKIE, cookieOptions);
  noContent(res);
};

export const me = async (req: Request, res: Response) => {
  if (!req.user) throw AppError.unauthorized();
  ok(res, await getUser(req.user.id));
};
