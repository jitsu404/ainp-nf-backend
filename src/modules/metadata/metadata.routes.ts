import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './metadata.controller.js';
import {
  approveMetadataSchemas,
  getMetadataSchemas,
  returnMetadataSchemas,
  saveCommonMetadataSchemas,
  saveTrialMetadataSchemas,
  submitMetadataSchemas,
} from './metadata.dto.js';

export const metadataRouter = Router();

// Reading: anyone who can see the experiment, so assigned centres see each other's metadata.
// Writing: only the trial's own centre (service scope); common fields and review by the PCU.
metadataRouter.use(authenticate);

metadataRouter.get(
  '/experiments/:id',
  apiDoc({
    name: 'Experiment metadata',
    description: "The common fields (PCU) and each assigned centre's metadata status and completeness.",
  }),
  validate(getMetadataSchemas),
  controller.getExperiment,
);
metadataRouter.put(
  '/experiments/:id/common',
  apiDoc({
    name: 'Save common metadata',
    description:
      'Fields that are the same for every centre (institute, funding, keywords …). Empty clears to the default.',
  }),
  authorize('research.config'),
  validate(saveCommonMetadataSchemas),
  controller.saveCommon,
);
metadataRouter.get(
  '/experiments/:id/export',
  apiDoc({
    name: 'Export metadata',
    description: 'Excel in the ICAR metadata format: one row per centre, fields 1–38 in order.',
  }),
  validate(getMetadataSchemas),
  controller.exportExperiment,
);
metadataRouter.get(
  '/trials/:id',
  apiDoc({
    name: 'Trial metadata',
    description:
      "All ICAR fields for one centre: common (experiment), automatic (protocol, trial, PI, sheets) and the centre's own, with status, completeness and what the caller may do.",
  }),
  validate(getMetadataSchemas),
  controller.getTrial,
);
metadataRouter.put(
  '/trials/:id',
  apiDoc({
    name: 'Save trial metadata',
    description: "The centre's own fields. Only Draft or Returned metadata can change.",
  }),
  authorize('research.enter'),
  validate(saveTrialMetadataSchemas),
  controller.saveTrial,
);
metadataRouter.post(
  '/trials/:id/submit',
  apiDoc({
    name: 'Submit trial metadata',
    description: 'Fails with INCOMPLETE_METADATA listing the required fields still empty.',
  }),
  authorize('research.submit'),
  validate(submitMetadataSchemas),
  controller.submit,
);
metadataRouter.post(
  '/trials/:id/return',
  apiDoc({
    name: 'Return trial metadata',
    description: 'Back to the centre with a remark (also reopens approved metadata).',
  }),
  authorize('research.review', 'research.approve'),
  validate(returnMetadataSchemas),
  controller.returnMetadata,
);
metadataRouter.post(
  '/trials/:id/approve',
  apiDoc({ name: 'Approve trial metadata' }),
  authorize('research.approve'),
  validate(approveMetadataSchemas),
  controller.approve,
);
