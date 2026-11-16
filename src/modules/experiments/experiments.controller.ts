import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { created, ok } from '../../utils/response.js';
import { ensureTrials } from '../trials/trials.service.js';
import type {
  createExperimentSchemas,
  getExperimentSchemas,
  listExperimentsSchemas,
  updateExperimentSchemas,
} from './experiments.dto.js';
import * as experimentsService from './experiments.service.js';

// Assigning an experiment to centres creates their trials, composed here so the experiments
// service doesn't depend on the trials module.

export const list = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof listExperimentsSchemas>(req);
  ok(res, await experimentsService.listExperiments(contextOf(req), query));
};

export const getById = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getExperimentSchemas>(req);
  ok(res, await experimentsService.getExperimentWithParameters(contextOf(req), params.id));
};

export const create = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof createExperimentSchemas>(req);
  const ctx = contextOf(req);
  const experiment = await experimentsService.createExperiment(ctx, body);
  await ensureTrials(ctx, experiment);
  created(res, await experimentsService.getExperimentWithParameters(ctx, experiment.id as string));
};

export const update = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof updateExperimentSchemas>(req);
  const ctx = contextOf(req);
  const experiment = await experimentsService.updateExperiment(ctx, params.id, body);
  await ensureTrials(ctx, experiment);
  ok(res, await experimentsService.getExperimentWithParameters(ctx, experiment.id as string));
};
