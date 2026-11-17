import type { CookieOptions, Request, Response } from 'express';
import { AUTH_COOKIE } from '../../config/constants.js';
import { env, isProduction } from '../../config/env.js';
import { getValidated } from '../../middlewares/validate.js';
import { AppError } from '../../utils/AppError.js';
import { contextOf } from '../../utils/context.js';
import { noContent, ok } from '../../utils/response.js';
import { changeOwnPassword, getOwnProfile } from '../users/users.service.js';
import type { changePasswordSchemas, loginSchemas } from './auth.dto.js';
import * as authService from './auth.service.js';

// The JWT lives only in an httpOnly cookie: page scripts can't read it, which limits XSS damage.
// SameSite=Strict means the client and API must be served from the same site (registrable domain).
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict',
  path: '/',
};

const setSessionCookie = (res: Response, token: string) =>
  res.cookie(AUTH_COOKIE, token, { ...cookieOptions, maxAge: env.JWT_EXPIRES_IN * 1000 });

export const login = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof loginSchemas>(req);
  const { user, token } = await authService.login(body, { requestId: req.id, ip: req.ip });
  setSessionCookie(res, token);
  ok(res, authService.sessionOf(user));
};

export const logout = async (req: Request, res: Response) => {
  await authService.logout(req.cookies?.[AUTH_COOKIE], { requestId: req.id, ip: req.ip });
  res.clearCookie(AUTH_COOKIE, cookieOptions);
  noContent(res);
};

export const me = async (req: Request, res: Response) => {
  if (!req.user) throw AppError.unauthorized();
  ok(res, authService.sessionOf(await getOwnProfile(req.user.id)));
};

export const changePassword = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof changePasswordSchemas>(req);
  const ctx = contextOf(req);
  await changeOwnPassword(ctx, body.currentPassword, body.newPassword);
  // The change ended all earlier sessions, including this one, so issue a fresh cookie.
  setSessionCookie(res, authService.signToken({ sub: ctx.user.id, roleId: ctx.user.roleId }));
  ok(res, authService.sessionOf(await getOwnProfile(ctx.user.id)));
};
