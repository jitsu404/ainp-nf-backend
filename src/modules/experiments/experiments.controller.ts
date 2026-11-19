import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { created, ok } from '../../utils/response.js';
import type {
  createExperimentSchemas,
  getExperimentSchemas,
  listExperimentsSchemas,
  updateExperimentSchemas,
} from './experiments.dto.js';
import * as experimentsService from './experiments.service.js';

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
  created(res, await experimentsService.getExperimentWithParameters(ctx, experiment.id as string));
};

export const update = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof updateExperimentSchemas>(req);
  const ctx = contextOf(req);

  // Patch logic: only update fields that are explicitly present in req.body
  const patch: Partial<typeof body> = {};
  const rawBody = (req.body ?? {}) as Record<string, unknown>;

  for (const key of Object.keys(rawBody)) {
    if (key === 'parameters' || key === 'defaultParameters') {
      const paramsList =
        body.defaultParameters ?? (body as { parameters?: typeof body.defaultParameters }).parameters;
      patch.defaultParameters = paramsList;
      (patch as Record<string, unknown>).parameters = paramsList;
    } else if (key in body) {
      (patch as Record<string, unknown>)[key] = (body as Record<string, unknown>)[key];
    }
  }

  const experiment = await experimentsService.updateExperiment(ctx, params.id, patch);
  ok(res, await experimentsService.getExperimentWithParameters(ctx, experiment.id as string));
};
