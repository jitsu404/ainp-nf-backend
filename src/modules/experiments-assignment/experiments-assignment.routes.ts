import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './experiments-assignment.controller.js';
import {
  bulkAssignExperimentSchemas,
  createExperimentAssignmentSchemas,
  getExperimentAssignmentSchemas,
  listExperimentAssignmentsSchemas,
  updateExperimentAssignmentSchemas,
} from './experiments-assignment.dto.js';

export const experimentsAssignmentRouter = Router();

experimentsAssignmentRouter.use(authenticate);

experimentsAssignmentRouter.get(
  '/',
  apiDoc({ name: 'List experiment assignments' }),
  validate(listExperimentAssignmentsSchemas),
  controller.list,
);

experimentsAssignmentRouter.post(
  '/bulk',
  apiDoc({
    name: 'Bulk assign experiment to centres',
    description: 'Assigns centres to an experiment, setting seasons/crops per centre and creating trials.',
  }),
  authorize('research.config'),
  validate(bulkAssignExperimentSchemas),
  controller.bulkAssign,
);

experimentsAssignmentRouter.get(
  '/:id',
  apiDoc({ name: 'Get experiment assignment' }),
  validate(getExperimentAssignmentSchemas),
  controller.getById,
);

experimentsAssignmentRouter.post(
  '/',
  apiDoc({ name: 'Create experiment assignment' }),
  authorize('research.enter', 'research.config'),
  validate(createExperimentAssignmentSchemas),
  controller.create,
);

experimentsAssignmentRouter.patch(
  '/:id',
  apiDoc({ name: 'Update experiment assignment' }),
  authorize('research.enter', 'research.config'),
  validate(updateExperimentAssignmentSchemas),
  controller.update,
);

experimentsAssignmentRouter.delete(
  '/:id',
  apiDoc({ name: 'Delete experiment assignment' }),
  authorize('research.config'),
  validate(getExperimentAssignmentSchemas),
  controller.remove,
);
