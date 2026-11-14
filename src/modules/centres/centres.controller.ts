import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { created, ok } from '../../utils/response.js';
import type {
  createCentreSchemas,
  getCentreSchemas,
  listCentresSchemas,
  updateCentreSchemas,
} from './centres.dto.js';
import * as centresService from './centres.service.js';

// Controllers stay thin: read validated input, call the service, send the envelope.

export const list = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof listCentresSchemas>(req);
  const { items, meta } = await centresService.listCentres(contextOf(req), query);
  ok(res, items, meta);
};

export const getById = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getCentreSchemas>(req);
  ok(res, await centresService.getCentre(contextOf(req), params.id));
};

export const create = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof createCentreSchemas>(req);
  created(res, await centresService.createCentre(contextOf(req), body));
};

export const update = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof updateCentreSchemas>(req);
  ok(res, await centresService.updateCentre(contextOf(req), params.id, body));
};
