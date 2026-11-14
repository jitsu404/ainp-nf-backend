import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { assignCentrePiSchemas, centrePisSchemas } from '../users/users.dto.js';
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

centresRouter.get(
  '/:id/pis',
  apiDoc({
    name: 'List centre PIs',
    description: 'The current Centre PI first, then past PIs, newest first.',
  }),
  authorize('centres.manage'),
  validate(centrePisSchemas),
  controller.listPis,
);
centresRouter.post(
  '/:id/pi',
  apiDoc({
    name: 'Assign centre PI',
    description:
      "Creates the agronomist's account as this centre's PI, with a temporary password they must change at first sign-in. If the centre already has a PI, they are deactivated in the same step (send `reason`), so the centre always has exactly one.",
  }),
  authorize('centres.manage'),
  authorize('users.manage'),
  validate(assignCentrePiSchemas),
  controller.assignPi,
);
