import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { created, ok } from '../../utils/response.js';
import type { createFySchemas, updateFySchemas } from './financialYears.dto.js';
import * as fyService from './financialYears.service.js';

export const list = async (_req: Request, res: Response) => {
  ok(res, await fyService.listFinancialYears());
};

export const create = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof createFySchemas>(req);
  created(res, await fyService.createFinancialYear(contextOf(req), body));
};

export const update = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof updateFySchemas>(req);
  ok(res, await fyService.updateFinancialYear(contextOf(req), params.id, body));
};
