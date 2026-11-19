import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { idParams, objectId } from '../../utils/validators.js';
import { EXPERIMENT_ASSIGNMENT_STATUSES } from './experiments-assignment.model.js';

const metaDataSchema = z
  .object({
    code: z.string().trim().nullable().optional(),
    title: z.string().trim().nullable().optional(),
    smdName: z.string().trim().nullable().optional(),
    instituteName: z.string().trim().nullable().optional(),
    unitType: z.string().trim().nullable().optional(),
    unitName: z.string().trim().nullable().optional(),
    projectCode: z.string().trim().nullable().optional(),
    fundingType: z.string().trim().nullable().optional(),
    fundingSource: z.string().trim().nullable().optional(),
    subject: z.string().trim().nullable().optional(),
    keywords: z.string().trim().nullable().optional(),
    dataCategory: z.string().trim().nullable().optional(),
    dataType: z.string().trim().nullable().optional(),
    methodology: z.string().trim().nullable().optional(),
    dataScale: z.string().trim().nullable().optional(),
    language: z.string().trim().nullable().optional(),
  })
  .partial();

const seasonsSchema = z
  .union([
    z.record(z.string(), z.array(objectId)),
    z.array(z.string()).transform((arr) => Object.fromEntries(arr.map((s) => [s, []]))),
  ])
  .optional();

const createBody = z
  .object({
    experiment: objectId,
    centre: objectId,
    status: z.enum(EXPERIMENT_ASSIGNMENT_STATUSES).default('In progress'),
    seasons: seasonsSchema,
    metaData: metaDataSchema.optional(),
  })
  .strict();

const updateBody = z
  .object({
    experiment: objectId.optional(),
    centre: objectId.optional(),
    status: z.enum(EXPERIMENT_ASSIGNMENT_STATUSES).optional(),
    seasons: seasonsSchema,
    metaData: metaDataSchema.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update' });

const listQuery = z.object({
  experiment: objectId.optional(),
  centre: objectId.optional(),
  status: z.enum(EXPERIMENT_ASSIGNMENT_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
});

const bulkAssignmentItem = z
  .object({
    centre: objectId,
    seasons: seasonsSchema,
    status: z.enum(EXPERIMENT_ASSIGNMENT_STATUSES).default('In progress').optional(),
    metaData: metaDataSchema.optional(),
  })
  .strict();

const bulkAssignBody = z
  .object({
    experiment: objectId,
    assignments: z.array(bulkAssignmentItem),
  })
  .strict();

export const listExperimentAssignmentsSchemas = { query: listQuery } satisfies RequestSchemas;
export const getExperimentAssignmentSchemas = { params: idParams } satisfies RequestSchemas;
export const createExperimentAssignmentSchemas = { body: createBody } satisfies RequestSchemas;
export const updateExperimentAssignmentSchemas = {
  params: idParams,
  body: updateBody,
} satisfies RequestSchemas;
export const bulkAssignExperimentSchemas = { body: bulkAssignBody } satisfies RequestSchemas;

export type CreateExperimentAssignmentDto = z.output<typeof createBody>;
export type UpdateExperimentAssignmentDto = z.output<typeof updateBody>;
export type ListExperimentAssignmentsQuery = z.output<typeof listQuery>;
export type BulkAssignExperimentDto = z.output<typeof bulkAssignBody>;
