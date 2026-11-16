import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { uploadExcel } from '../../middlewares/upload.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './sheets.controller.js';
import {
  approveSheetSchemas,
  createSheetSchemas,
  getSheetSchemas,
  importSheetSchemas,
  listSheetsSchemas,
  returnSheetSchemas,
  saveValuesSchemas,
  sheetAnalysisSchemas,
  sheetTemplateSchemas,
  submitSheetSchemas,
  summarySchemas,
} from './sheets.dto.js';

export const sheetsRouter = Router();

// Centre users only see and change their own centre's sheets (service scope).
sheetsRouter.use(authenticate);

sheetsRouter.get('/', apiDoc({ name: 'List sheets' }), validate(listSheetsSchemas), controller.list);
sheetsRouter.get(
  '/summary',
  apiDoc({
    name: 'Experiment summary',
    description:
      'Treatment means per centre and parameter for one experiment and year, from approved sheets.',
  }),
  validate(summarySchemas),
  controller.summary,
);
sheetsRouter.get(
  '/:id',
  apiDoc({ name: 'Get sheet', description: 'The sheet, its experiment protocol and all recorded values.' }),
  validate(getSheetSchemas),
  controller.getById,
);
sheetsRouter.post(
  '/',
  apiDoc({
    name: 'Open sheet',
    description:
      'One sheet per trial × financial year × season (× cropping system or crop). The year must be open.',
  }),
  authorize('research.enter'),
  validate(createSheetSchemas),
  controller.create,
);
sheetsRouter.put(
  '/:id/values',
  apiDoc({
    name: 'Save values',
    description:
      'Upserts cells (treatment × replication × parameter); `value: null` clears a cell. Every cell is checked against the protocol and the parameter library; any error rejects the whole batch. Only Draft or Returned sheets in an open year.',
  }),
  authorize('research.enter'),
  validate(saveValuesSchemas),
  controller.saveValues,
);
sheetsRouter.post(
  '/:id/submit',
  apiDoc({
    name: 'Submit sheet',
    description: 'Fails with INCOMPLETE_SHEET listing missing required values.',
  }),
  authorize('research.submit'),
  validate(submitSheetSchemas),
  controller.submit,
);
sheetsRouter.post(
  '/:id/return',
  apiDoc({ name: 'Return sheet', description: 'Sends a submitted sheet back to the centre with a remark.' }),
  authorize('research.review', 'research.approve'),
  validate(returnSheetSchemas),
  controller.returnSheet,
);
sheetsRouter.post(
  '/:id/approve',
  apiDoc({ name: 'Approve sheet', description: 'Approves and locks a submitted sheet.' }),
  authorize('research.approve'),
  validate(approveSheetSchemas),
  controller.approve,
);
sheetsRouter.get(
  '/:id/template',
  apiDoc({
    name: 'Download sheet template',
    description:
      'Excel with the current values: "Plot data" (treatment × replication) and "Treatment data" tabs.',
  }),
  validate(sheetTemplateSchemas),
  controller.template,
);
sheetsRouter.post(
  '/:id/import',
  apiDoc({
    name: 'Import sheet values',
    description:
      'Upload the filled template. `dryRun=true` (default) checks every cell; `dryRun=false` saves if there are no errors. Empty cells clear values.',
  }),
  authorize('research.enter'),
  uploadExcel,
  validate(importSheetSchemas),
  controller.importFile,
);
sheetsRouter.get(
  '/:id/analysis',
  apiDoc({
    name: 'Analyse sheet',
    description:
      'Per numeric parameter: treatment means, grand mean and, for complete replicated data, RCBD ANOVA with CV, SEm, SEd and CD (5 %).',
  }),
  validate(sheetAnalysisSchemas),
  controller.analysis,
);
