import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { uploadedBuffer } from '../../middlewares/upload.js';
import { contextOf } from '../../utils/context.js';
import { XLSX_CONTENT_TYPE, created, ok, sendFile } from '../../utils/response.js';
import type {
  createMasterSchemas,
  importMastersSchemas,
  listMastersSchemas,
  masterTemplateSchemas,
  updateMasterSchemas,
} from './masters.dto.js';
import * as mastersService from './masters.service.js';

export const list = async (req: Request, res: Response) => {
  const { params, query } = getValidated<typeof listMastersSchemas>(req);
  ok(res, await mastersService.listMasters(params.type, query));
};

export const create = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof createMasterSchemas>(req);
  created(res, await mastersService.createMaster(contextOf(req), params.type, body));
};

export const update = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof updateMasterSchemas>(req);
  ok(res, await mastersService.updateMaster(contextOf(req), params.type, params.id, body));
};

export const template = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof masterTemplateSchemas>(req);
  sendFile(
    res,
    await mastersService.masterTemplate(params.type),
    `masters-${params.type}.xlsx`,
    XLSX_CONTENT_TYPE,
  );
};

export const importFile = async (req: Request, res: Response) => {
  const { params, query } = getValidated<typeof importMastersSchemas>(req);
  ok(res, await mastersService.importMasters(contextOf(req), params.type, uploadedBuffer(req), query.dryRun));
};
