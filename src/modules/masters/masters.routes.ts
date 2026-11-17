import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { uploadExcel } from '../../middlewares/upload.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './masters.controller.js';
import {
  createMasterSchemas,
  importMastersSchemas,
  listMastersSchemas,
  masterTemplateSchemas,
  updateMasterSchemas,
} from './masters.dto.js';

export const mastersRouter = Router();

// Everyone signed in reads masters (they fill dropdowns); only masters.edit changes them.
mastersRouter.use(authenticate);

mastersRouter.get(
  '/:type',
  apiDoc({ name: 'List master items' }),
  validate(listMastersSchemas),
  controller.list,
);
mastersRouter.post(
  '/:type',
  apiDoc({ name: 'Add master item' }),
  authorize('masters.edit'),
  validate(createMasterSchemas),
  controller.create,
);
mastersRouter.patch(
  '/:type/:id',
  apiDoc({
    name: 'Update master item',
    description: 'Deactivate with `isActive: false`; items are never deleted.',
  }),
  authorize('masters.edit'),
  validate(updateMasterSchemas),
  controller.update,
);
mastersRouter.get(
  '/:type/import-template',
  apiDoc({
    name: 'Download master template',
    description: 'Excel template pre-filled with the current items (doubles as an export).',
  }),
  authorize('masters.edit'),
  validate(masterTemplateSchemas),
  controller.template,
);
mastersRouter.post(
  '/:type/import',
  apiDoc({
    name: 'Import master items',
    description:
      'Upload the filled template. `dryRun=true` (default) validates and returns row errors without saving; `dryRun=false` saves all rows in one transaction, only if there are no errors. Existing codes are updated.',
  }),
  authorize('masters.edit'),
  uploadExcel,
  validate(importMastersSchemas),
  controller.importFile,
);
