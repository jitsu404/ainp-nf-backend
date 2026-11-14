import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { created, ok } from '../../utils/response.js';
import type { assignCentrePiSchemas, centrePisSchemas } from '../users/users.dto.js';
import * as usersService from '../users/users.service.js';
import type {
  createCentreSchemas,
  getCentreSchemas,
  listCentresSchemas,
  updateCentreSchemas,
} from './centres.dto.js';
import * as centresService from './centres.service.js';

// Controllers stay thin: read validated input, call the service(s), send the envelope.
// Centre responses include `currentPi` (or null), composed here from the users service so the
// two modules don't import each other's models.

type PiSummary = { id: string; name: string; designation?: string; email: string; phone?: string };

const summarise = (pi: PiSummary | undefined | null) =>
  pi ? { id: pi.id, name: pi.name, designation: pi.designation, email: pi.email, phone: pi.phone } : null;

export const list = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof listCentresSchemas>(req);
  const { items, meta } = await centresService.listCentres(contextOf(req), query);
  const pis = await usersService.activePisForCentres(items.map((c) => c.id as string));
  ok(
    res,
    items.map((centre) => ({ ...centre.toJSON(), currentPi: summarise(pis.get(centre.id as string)) })),
    meta,
  );
};

export const getById = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getCentreSchemas>(req);
  const centre = await centresService.getCentre(contextOf(req), params.id);
  const pis = await usersService.activePisForCentres([centre.id as string]);
  ok(res, { ...centre.toJSON(), currentPi: summarise(pis.get(centre.id as string)) });
};

export const create = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof createCentreSchemas>(req);
  created(res, await centresService.createCentre(contextOf(req), body));
};

export const update = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof updateCentreSchemas>(req);
  ok(res, await centresService.updateCentre(contextOf(req), params.id, body));
};

/** Current and past Centre PIs, active one first. */
export const listPis = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof centrePisSchemas>(req);
  await centresService.getCentre(contextOf(req), params.id); // 404 if the centre doesn't exist
  ok(res, await usersService.listCentrePis(params.id));
};

export const assignPi = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof assignCentrePiSchemas>(req);
  created(res, await usersService.assignCentrePi(contextOf(req), params.id, body));
};
