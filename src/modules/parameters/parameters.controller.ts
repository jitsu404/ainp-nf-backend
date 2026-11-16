import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { uploadedBuffer } from '../../middlewares/upload.js';
import { contextOf } from '../../utils/context.js';
import { XLSX_CONTENT_TYPE, created, ok, sendFile } from '../../utils/response.js';
import type {
  createParameterSchemas,
  importParametersSchemas,
  listParametersSchemas,
  updateParameterSchemas,
} from './parameters.dto.js';
import * as parametersService from './parameters.service.js';

export const list = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof listParametersSchemas>(req);
  ok(res, await parametersService.listParameters(query));
};

export const create = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof createParameterSchemas>(req);
  created(res, await parametersService.createParameter(contextOf(req), body));
};

export const update = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof updateParameterSchemas>(req);
  ok(res, await parametersService.updateParameter(contextOf(req), params.id, body));
};

export const template = async (_req: Request, res: Response) => {
  sendFile(res, await parametersService.parameterTemplate(), 'parameters.xlsx', XLSX_CONTENT_TYPE);
};

export const importFile = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof importParametersSchemas>(req);
  ok(res, await parametersService.importParameters(contextOf(req), uploadedBuffer(req), query.dryRun));
};
