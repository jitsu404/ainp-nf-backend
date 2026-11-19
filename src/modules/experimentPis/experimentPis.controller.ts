import type { Request, Response } from 'express';
import type { HydratedDocument } from 'mongoose';
import { getValidated } from '../../middlewares/validate.js';
import { type RequestContext, contextOf } from '../../utils/context.js';
import { created, ok } from '../../utils/response.js';
import { experimentsByPi } from '../experiments/experiments.service.js';
import type {
  createExperimentPiSchemas,
  experimentPiSchemas,
  replaceSeatHolderSchemas,
  updateUserSchemas,
} from '../users/users.dto.js';
import type { User } from '../users/users.model.js';
import * as usersService from '../users/users.service.js';

// Experiment PI seats (pi1.npnf@…, pi2.npnf@…). The accounts live in the users module and the
// link to an experiment in the experiments module; this module only composes the two, so they
// don't depend on each other.

const present = async (seats: HydratedDocument<User>[]) => {
  const linked = await experimentsByPi(seats.map((s) => s.id as string));
  return seats.map((s) => ({
    ...usersService.seatSummary(s),
    experiment: linked.get(s.id as string) ?? null,
    history: usersService.seatHistory(s).filter((h) => !h.isCurrent),
  }));
};

const one = async (ctx: RequestContext, id: string) =>
  (await present([await usersService.getExperimentPi(ctx, id)]))[0];

export const list = async (req: Request, res: Response) => {
  ok(res, await present(await usersService.listExperimentPis(contextOf(req))));
};

export const getById = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof experimentPiSchemas>(req);
  ok(res, await one(contextOf(req), params.id));
};

export const create = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof createExperimentPiSchemas>(req);
  const ctx = contextOf(req);
  const seat = await usersService.createExperimentPi(ctx, body);
  created(res, await one(ctx, seat.id as string));
};

export const update = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof updateUserSchemas>(req);
  const ctx = contextOf(req);
  await usersService.getExperimentPi(ctx, params.id);
  await usersService.updateUser(ctx, params.id, body);
  ok(res, await one(ctx, params.id));
};

export const replace = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof replaceSeatHolderSchemas>(req);
  const ctx = contextOf(req);
  await usersService.replaceExperimentPi(ctx, params.id, body);
  ok(res, await one(ctx, params.id));
};
