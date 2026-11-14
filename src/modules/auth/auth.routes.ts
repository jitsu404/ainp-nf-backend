import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { loginLimiter } from '../../middlewares/rateLimiter.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './auth.controller.js';
import { loginSchemas } from './auth.dto.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  apiDoc({
    name: 'Sign in',
    description:
      'Checks the email and password and sets the httpOnly session cookie. Limited to 10 failed attempts per 15 minutes per IP.',
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
  apiDoc({ name: 'Current user', description: 'Returns the signed-in user.' }),
  authenticate,
  controller.me,
);
