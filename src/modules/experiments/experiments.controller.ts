import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { created, ok } from '../../utils/response.js';
import { syncTrials } from '../trials/trials.service.js';
import { seatSummary, usersByIds } from '../users/users.service.js';
import type {
  createExperimentSchemas,
  getExperimentSchemas,
  listExperimentsSchemas,
  updateExperimentSchemas,
} from './experiments.dto.js';
import * as experimentsService from './experiments.service.js';

// Assigning an experiment to centres creates, reactivates or withdraws their trials. The trials
// sync is passed into the experiments service, which runs it inside the experiment's transaction;
// it is composed here so the experiments service doesn't depend on the trials module.
//
// Controllers read input only through getValidated(): `validate` has already parsed the body with
// the DTO, so `body` holds exactly the fields the request sent (unknown keys are rejected, and the
// update DTO adds no defaults). That is what makes a PATCH a partial update; there's no need to
// look at the raw req.body.

/** Adds `pi`: the linked Experiment PI seat and its current holder (or null). */
const withPi = async <T extends { piUserId?: unknown }>(experiments: T[]) => {
  const ids = experiments
    .map((e) => e.piUserId)
    .filter(Boolean)
    .map(String);
  const pis = ids.length ? await usersByIds(ids) : new Map();
  return experiments.map((e) => {
    const pi = e.piUserId ? pis.get(String(e.piUserId)) : undefined;
    return { ...e, pi: pi ? seatSummary(pi) : null };
  });
};

const syncCentresFor =
  (ctx: ReturnType<typeof contextOf>): experimentsService.SyncCentres =>
  (experiment, centreIds, session, withdrawReason) =>
    syncTrials(ctx, experiment, centreIds, session, withdrawReason);

const detail = async (ctx: ReturnType<typeof contextOf>, id: string) =>
  (await withPi([await experimentsService.getExperimentWithParameters(ctx, id)]))[0];

export const list = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof listExperimentsSchemas>(req);
  const items = await experimentsService.listExperiments(contextOf(req), query);
  ok(res, await withPi(items.map((e) => e.toJSON())));
};

export const getById = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getExperimentSchemas>(req);
  ok(res, await detail(contextOf(req), params.id));
};

export const create = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof createExperimentSchemas>(req);
  const ctx = contextOf(req);
  const experiment = await experimentsService.createExperiment(ctx, body, syncCentresFor(ctx));
  created(res, await detail(ctx, experiment.id as string));
};

export const update = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof updateExperimentSchemas>(req);
  const ctx = contextOf(req);
  const experiment = await experimentsService.updateExperiment(ctx, params.id, body, syncCentresFor(ctx));
  ok(res, await detail(ctx, experiment.id as string));
};
