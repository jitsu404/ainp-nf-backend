import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { ok } from '../../utils/response.js';
import * as metadataService from '../metadata/metadata.service.js';
import type {
  getTrialMetadataSchemas,
  getTrialSchemas,
  listTrialsSchemas,
  saveTrialMetadataSchemas,
  updateTrialSchemas,
} from './trials.dto.js';
import * as trialsService from './trials.service.js';

export const list = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof listTrialsSchemas>(req);
  ok(res, await trialsService.listTrials(contextOf(req), query));
};

export const getById = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getTrialSchemas>(req);
  ok(res, await trialsService.getTrialDetail(contextOf(req), params.id));
};

export const update = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof updateTrialSchemas>(req);
  const ctx = contextOf(req);
  await trialsService.updateTrial(ctx, params.id, body);
  ok(res, await trialsService.getTrialDetail(ctx, params.id));
};

export const getMetadata = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getTrialMetadataSchemas>(req);
  ok(res, await metadataService.getTrialMetadata(contextOf(req), params.id));
};

export const saveMetadata = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof saveTrialMetadataSchemas>(req);
  ok(res, await metadataService.saveTrialMetadata(contextOf(req), params.id, body));
};
