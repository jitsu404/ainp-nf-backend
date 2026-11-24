import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './trials.controller.js';
import {
  getTrialMetadataSchemas,
  getTrialSchemas,
  listTrialsSchemas,
  saveTrialMetadataSchemas,
  toggleTrialLockSchemas,
  updateTrialSchemas,
} from './trials.dto.js';

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
  authorize('research.enter', 'research.assign'),
  validate(updateTrialSchemas),
  controller.update,
);
trialsRouter.patch(
  '/:id/lock',
  apiDoc({
    name: 'Toggle trial lock',
    description:
      "Lock or unlock protocol sections (mainPlot, subPlot, subSubPlot, factor1-3, treatments, parameters) for a trial. Only the PCU (research.assign / research.config) toggles them; while a section is locked, the centre's PATCH /trials/:id is refused for it (409 SECTION_LOCKED).",
  }),
  authorize('research.assign', 'research.config'),
  validate(toggleTrialLockSchemas),
  controller.toggleLock,
);
trialsRouter.get(
  '/:id/metadata',
  apiDoc({
    name: 'Get trial metadata',
    description: 'Returns all 38 ICAR metadata fields, prefilled with computed defaults.',
  }),
  validate(getTrialMetadataSchemas),
  controller.getMetadata,
);
trialsRouter.put(
  '/:id/metadata',
  apiDoc({
    name: 'Save trial metadata',
    description: 'Saves trial-specific customizations for ICAR metadata fields.',
  }),
  authorize('research.enter', 'research.assign'),
  validate(saveTrialMetadataSchemas),
  controller.saveMetadata,
);
