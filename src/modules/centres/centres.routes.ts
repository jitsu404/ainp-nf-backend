import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './centres.controller.js';
import {
  createCentreSchemas,
  getCentreSchemas,
  listCentresSchemas,
  updateCentreSchemas,
} from './centres.dto.js';

export const centresRouter = Router();

// Every signed-in user can read centres; centre-level roles see only their own (service layer).
centresRouter.use(authenticate);

centresRouter.get('/', validate(listCentresSchemas), controller.list);
centresRouter.get('/:id', validate(getCentreSchemas), controller.getById);
centresRouter.post('/', authorize('centres.manage'), validate(createCentreSchemas), controller.create);
centresRouter.patch('/:id', authorize('centres.manage'), validate(updateCentreSchemas), controller.update);
