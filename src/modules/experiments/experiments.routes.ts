import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './experiments.controller.js';
import {
  createExperimentSchemas,
  getExperimentSchemas,
  listExperimentsSchemas,
  updateExperimentSchemas,
} from './experiments.dto.js';

export const experimentsRouter = Router();

// Centre users see the experiments assigned to their centre (service scope).
experimentsRouter.use(authenticate);

experimentsRouter.get(
  '/',
  apiDoc({ name: 'List experiments' }),
  validate(listExperimentsSchemas),
  controller.list,
);
experimentsRouter.get(
  '/:id',
  apiDoc({ name: 'Get experiment', description: 'Includes each parameter with its library details.' }),
  validate(getExperimentSchemas),
  controller.getById,
);
experimentsRouter.post(
  '/',
  apiDoc({
    name: 'Create experiment',
    description:
      'The PCU protocol: design, replications, common treatments, the parameters to record (plot- or treatment-level) and seasons. Assigning centres creates their trials; `piUserId` links an Experiment PI seat (optional).',
  }),
  authorize('research.assign'),
  validate(createExperimentSchemas),
  controller.create,
);
experimentsRouter.patch(
  '/:id',
  apiDoc({
    name: 'Update experiment',
    description:
      'Once any centre has recorded data, the design, replications and existing treatments/parameters are frozen (409 EXPERIMENT_HAS_DATA); new ones can still be added. The Experiment PI edits only their own experiment; centres and the PI (`centreIds`, `piUserId`) need `research.assign`.',
  }),
  authorize('research.config'),
  validate(updateExperimentSchemas),
  controller.update,
);
