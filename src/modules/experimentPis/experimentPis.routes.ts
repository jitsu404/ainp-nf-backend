import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import {
  createExperimentPiSchemas,
  experimentPiSchemas,
  replaceSeatHolderSchemas,
  updateUserSchemas,
} from '../users/users.dto.js';
import * as controller from './experimentPis.controller.js';

export const experimentPisRouter = Router();

// The PCU (and Super Admin) manage Experiment PI seats.
experimentPisRouter.use(authenticate, authorize('research.assign'), authorize('users.manage'));

experimentPisRouter.get(
  '/',
  apiDoc({
    name: 'List experiment PIs',
    description:
      'Every Experiment PI seat with its current holder, the experiment it leads and past holders.',
  }),
  controller.list,
);
experimentPisRouter.get('/:id', validate(experimentPiSchemas), controller.getById);
experimentPisRouter.post(
  '/',
  apiDoc({
    name: 'Create experiment PI',
    description:
      'Creates the next seat, pi<n>.npnf@icar.org.in, held by this person with the password you set (no forced change). Link it to an experiment from the experiment.',
  }),
  validate(createExperimentPiSchemas),
  controller.create,
);
experimentPisRouter.patch(
  '/:id',
  apiDoc({
    name: 'Update experiment PI holder',
    description: "Corrects the current holder's details; `email` is their own email, not the seat login.",
  }),
  validate(updateUserSchemas),
  controller.update,
);
experimentPisRouter.post(
  '/:id/replace',
  apiDoc({
    name: 'Replace experiment PI holder',
    description:
      'A new person takes the seat: same login, new password; the previous holder moves to the history and is signed out.',
  }),
  validate(replaceSeatHolderSchemas),
  controller.replace,
);
