import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { created, ok } from '../../utils/response.js';
import type {
  createCroppingSystemSchemas,
  getCroppingSystemSchemas,
  listCroppingSystemsSchemas,
  updateCroppingSystemSchemas,
} from './croppingSystems.dto.js';
import * as service from './croppingSystems.service.js';

export const list = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof listCroppingSystemsSchemas>(req);
  ok(res, await service.listCroppingSystems(query));
};

export const get = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getCroppingSystemSchemas>(req);
  ok(res, await service.getCroppingSystem(params.id));
};

export const create = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof createCroppingSystemSchemas>(req);
  created(res, await service.createCroppingSystem(contextOf(req), body));
};

export const update = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof updateCroppingSystemSchemas>(req);
  ok(res, await service.updateCroppingSystem(contextOf(req), params.id, body));
};
