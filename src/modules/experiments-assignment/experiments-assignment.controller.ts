import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { created, noContent, ok } from '../../utils/response.js';
import type {
  bulkAssignExperimentSchemas,
  createExperimentAssignmentSchemas,
  getExperimentAssignmentSchemas,
  listExperimentAssignmentsSchemas,
  updateExperimentAssignmentSchemas,
} from './experiments-assignment.dto.js';
import * as service from './experiments-assignment.service.js';

export const list = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof listExperimentAssignmentsSchemas>(req);
  ok(res, await service.listExperimentAssignments(contextOf(req), query));
};

export const getById = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getExperimentAssignmentSchemas>(req);
  ok(res, await service.getExperimentAssignmentById(contextOf(req), params.id));
};

export const create = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof createExperimentAssignmentSchemas>(req);
  const ctx = contextOf(req);
  const createdAssignment = await service.createExperimentAssignment(ctx, body);
  created(res, await service.getExperimentAssignmentById(ctx, createdAssignment.id as string));
};

export const bulkAssign = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof bulkAssignExperimentSchemas>(req);
  const ctx = contextOf(req);
  const results = await service.bulkAssignExperiment(ctx, body);
  ok(res, results);
};

export const update = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof updateExperimentAssignmentSchemas>(req);
  const ctx = contextOf(req);

  // Patch logic: only update fields that are explicitly present in req.body
  const patch: Partial<typeof body> = {};
  const rawBody = (req.body ?? {}) as Record<string, unknown>;

  for (const key of Object.keys(rawBody)) {
    if (key in body) {
      (patch as Record<string, unknown>)[key] = (body as Record<string, unknown>)[key];
    }
  }

  const updated = await service.updateExperimentAssignment(ctx, params.id, patch);
  ok(res, await service.getExperimentAssignmentById(ctx, updated.id as string));
};

export const remove = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getExperimentAssignmentSchemas>(req);
  await service.deleteExperimentAssignment(contextOf(req), params.id);
  noContent(res);
};
