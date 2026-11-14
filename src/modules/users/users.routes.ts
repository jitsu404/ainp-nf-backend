import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './users.controller.js';
import { createUserSchemas, getUserSchemas, listUsersSchemas } from './users.dto.js';

export const usersRouter = Router();

// User administration needs users.manage (Super Administrator, Project Coordinator, Administrator).
// Which roles each of them may hand out is checked in the service (ASSIGNABLE_ROLES).
usersRouter.use(authenticate, authorize('users.manage'));

usersRouter.get('/', validate(listUsersSchemas), controller.list);
usersRouter.get('/:id', validate(getUserSchemas), controller.getById);
usersRouter.post('/', validate(createUserSchemas), controller.create);
