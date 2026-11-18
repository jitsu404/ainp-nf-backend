import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { XLSX_CONTENT_TYPE, ok, sendFile } from '../../utils/response.js';
import type {
  approveMetadataSchemas,
  getMetadataSchemas,
  returnMetadataSchemas,
  saveCommonMetadataSchemas,
  saveTrialMetadataSchemas,
  submitMetadataSchemas,
} from './metadata.dto.js';
import * as metadataService from './metadata.service.js';

export const getTrial = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getMetadataSchemas>(req);
  ok(res, await metadataService.getTrialMetadata(contextOf(req), params.id));
};

export const saveTrial = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof saveTrialMetadataSchemas>(req);
  ok(res, await metadataService.saveTrialMetadata(contextOf(req), params.id, body));
};

export const submit = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof submitMetadataSchemas>(req);
  ok(res, await metadataService.submitTrialMetadata(contextOf(req), params.id, body.remark));
};

export const returnMetadata = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof returnMetadataSchemas>(req);
  ok(res, await metadataService.returnTrialMetadata(contextOf(req), params.id, body.remark));
};

export const approve = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof approveMetadataSchemas>(req);
  ok(res, await metadataService.approveTrialMetadata(contextOf(req), params.id, body.remark));
};

export const getExperiment = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getMetadataSchemas>(req);
  ok(res, await metadataService.getExperimentMetadata(contextOf(req), params.id));
};

export const saveCommon = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof saveCommonMetadataSchemas>(req);
  ok(res, await metadataService.saveCommonMetadata(contextOf(req), params.id, body));
};

export const exportExperiment = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getMetadataSchemas>(req);
  const { buffer, filename } = await metadataService.exportExperimentMetadata(contextOf(req), params.id);
  sendFile(res, buffer, filename, XLSX_CONTENT_TYPE);
};
