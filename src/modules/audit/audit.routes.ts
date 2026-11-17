import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './audit.controller.js';
import { exportAuditSchemas, listAuditSchemas } from './audit.dto.js';

export const auditRouter = Router();

// Read-only: the trail is written only by services (recordAudit / recordAuthEvent).
// Centre users see only their own centre's activity (service scope).
auditRouter.use(authenticate, authorize('audit.view'));

auditRouter.get(
  '/',
  apiDoc({
    name: 'List audit trail',
    description:
      'Newest first. Filter by person, role, centre, module, record (`entityId`, e.g. one sheet’s history), date range or text. Edits carry `changes` (old → new per field); sheet saves carry `cells` (old → new per cell) and `source` (form or excel).',
  }),
  validate(listAuditSchemas),
  controller.list,
);

auditRouter.get(
  '/export',
  apiDoc({ name: 'Export audit trail', description: 'The filtered trail as Excel (up to 10,000 rows).' }),
  validate(exportAuditSchemas),
  controller.exportFile,
);
