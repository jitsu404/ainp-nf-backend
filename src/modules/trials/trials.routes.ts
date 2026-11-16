import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './trials.controller.js';
import { getTrialSchemas, listTrialsSchemas, updateTrialSchemas } from './trials.dto.js';

export const trialsRouter = Router();

// Centre users only see and edit their own centre's trials (service scope).
trialsRouter.use(authenticate);

trialsRouter.get('/', apiDoc({ name: 'List trials' }), validate(listTrialsSchemas), controller.list);
trialsRouter.get(
  '/:id',
  apiDoc({ name: 'Get trial', description: 'The centre setup together with the experiment protocol.' }),
  validate(getTrialSchemas),
  controller.getById,
);
trialsRouter.patch(
  '/:id',
  apiDoc({
    name: 'Update trial setup',
    description:
      'The centre sets its cropping systems (crops and varieties per season), the practice details of each treatment, the in-charge, layout notes and status. Seasons, crops and treatments are checked against the masters and the protocol.',
  }),
  authorize('research.enter', 'research.config'),
  validate(updateTrialSchemas),
  controller.update,
);
