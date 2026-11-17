import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { XLSX_CONTENT_TYPE, ok, sendFile } from '../../utils/response.js';
import type { exportAuditSchemas, listAuditSchemas } from './audit.dto.js';
import * as auditService from './audit.service.js';

export const list = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof listAuditSchemas>(req);
  const { items, meta } = await auditService.listAudit(contextOf(req), query);
  ok(res, items, meta);
};

export const exportFile = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof exportAuditSchemas>(req);
  const day = new Date().toISOString().slice(0, 10);
  sendFile(
    res,
    await auditService.exportAudit(contextOf(req), query),
    `audit-trail-${day}.xlsx`,
    XLSX_CONTENT_TYPE,
  );
};
