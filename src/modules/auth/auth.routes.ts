import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticateAllowingPasswordChange } from '../../middlewares/authenticate.js';
import { loginLimiter } from '../../middlewares/rateLimiter.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './auth.controller.js';
import { changePasswordSchemas, loginSchemas } from './auth.dto.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  apiDoc({
    name: 'Sign in',
    description:
      'Checks the email and password and sets the httpOnly session cookie. Returns the session: user, role, capabilities and `mustChangePassword`. Limited to 10 failed attempts per 15 minutes per IP.',
  }),
  loginLimiter,
  validate(loginSchemas),
  controller.login,
);

authRouter.post(
  '/logout',
  apiDoc({ name: 'Sign out', description: 'Clears the session cookie. Returns 204.' }),
  controller.logout,
);

authRouter.get(
  '/me',
  apiDoc({
    name: 'Current session',
    description: 'Returns the signed-in user with their role, capabilities and the roles they can manage.',
  }),
  authenticateAllowingPasswordChange,
  controller.me,
);

authRouter.post(
  '/change-password',
  apiDoc({
    name: 'Change password',
    description:
      'Changes your own password. Required after first sign-in with a temporary password: until then every other endpoint returns 403 `PASSWORD_CHANGE_REQUIRED`. Ends all other sessions.',
  }),
  authenticateAllowingPasswordChange,
  validate(changePasswordSchemas),
  controller.changePassword,
);
