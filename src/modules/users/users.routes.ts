import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './users.controller.js';
import {
  activateUserSchemas,
  createUserSchemas,
  deactivateUserSchemas,
  getUserSchemas,
  listUsersSchemas,
  resetPasswordSchemas,
  updateUserSchemas,
} from './users.dto.js';

export const usersRouter = Router();

// Needs users.manage (Super Admin, PCU). Which accounts each can see and change is decided by
// ASSIGNABLE_ROLES in the service: PCU manages Centre PIs; only Super Admin manages PCU accounts.
usersRouter.use(authenticate, authorize('users.manage'));

usersRouter.get('/', validate(listUsersSchemas), controller.list);
// Before '/:id', so "roles" isn't read as a user id.
usersRouter.get(
  '/roles',
  apiDoc({
    name: 'Roles overview',
    description:
      'Every role with its scope, the roles it manages, its capabilities (grouped by module) and its number of active accounts.',
  }),
  controller.roles,
);
usersRouter.get('/:id', validate(getUserSchemas), controller.getById);
usersRouter.post(
  '/',
  apiDoc({
    description:
      'Creates an account with a temporary password the person must change at first sign-in. For a Centre PI, prefer **Centres → Assign Centre PI**, which also handles replacing the current PI.',
  }),
  validate(createUserSchemas),
  controller.create,
);
usersRouter.patch('/:id', validate(updateUserSchemas), controller.update);
usersRouter.post(
  '/:id/deactivate',
  apiDoc({
    name: 'Deactivate user',
    description:
      'Blocks sign-in immediately. The account and everything it recorded are kept. You cannot deactivate yourself.',
  }),
  validate(deactivateUserSchemas),
  controller.deactivate,
);
usersRouter.post(
  '/:id/activate',
  apiDoc({
    name: 'Reactivate user',
    description: 'Fails for a Centre PI if their centre already has another active PI.',
  }),
  validate(activateUserSchemas),
  controller.activate,
);
usersRouter.post(
  '/:id/reset-password',
  apiDoc({
    name: 'Reset password',
    description:
      'Sets a new temporary password; the person must change it at their next sign-in. Returns 204.',
  }),
  validate(resetPasswordSchemas),
  controller.resetPassword,
);
