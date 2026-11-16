import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { uploadExcel } from '../../middlewares/upload.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './parameters.controller.js';
import {
  createParameterSchemas,
  importParametersSchemas,
  listParametersSchemas,
  parameterTemplateSchemas,
  updateParameterSchemas,
} from './parameters.dto.js';

export const parametersRouter = Router();

parametersRouter.use(authenticate);

parametersRouter.get(
  '/',
  apiDoc({ name: 'List parameters' }),
  validate(listParametersSchemas),
  controller.list,
);
parametersRouter.post(
  '/',
  apiDoc({ name: 'Add parameter' }),
  authorize('masters.edit'),
  validate(createParameterSchemas),
  controller.create,
);
parametersRouter.patch(
  '/:id',
  apiDoc({
    name: 'Update parameter',
    description: 'Deactivate with `isActive: false`; parameters are never deleted.',
  }),
  authorize('masters.edit'),
  validate(updateParameterSchemas),
  controller.update,
);
parametersRouter.get(
  '/import-template',
  apiDoc({ name: 'Download parameter template', description: 'Pre-filled with the current library.' }),
  authorize('masters.edit'),
  validate(parameterTemplateSchemas),
  controller.template,
);
parametersRouter.post(
  '/import',
  apiDoc({
    name: 'Import parameters',
    description:
      '`dryRun=true` (default) validates only; `dryRun=false` saves all rows if there are no errors.',
  }),
  authorize('masters.edit'),
  uploadExcel,
  validate(importParametersSchemas),
  controller.importFile,
);
