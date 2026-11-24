import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { idParams, objectId } from '../../utils/validators.js';
import { disabledParameter, subPlotItem, treatment } from '../experiments/experiments.dto.js';
import { masterCode } from '../masters/masters.dto.js';
import { trialBody } from '../metadata/metadata.dto.js';
import { ASSIGNMENT_STATUSES, SYSTEM_CROP_ROLES, TRIAL_STATUSES } from './trials.model.js';

const shortCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Code: letters, digits, _ or -');

const measure = (max: number, description: string, example: number) =>
  z.number().min(0).max(max).nullable().optional().meta({ description, example });

const systemCrop = z
  .object({
    cropCode: masterCode.meta({ example: 'CRP-001' }),
    role: z.enum(SYSTEM_CROP_ROLES),
    variety: z.string().trim().max(100).nullable().optional().meta({ example: 'PB 1509' }),
    plantSpacing: measure(1000, 'Plant to plant spacing, cm', 15),
    rowSpacing: measure(1000, 'Row to row spacing, cm', 20),
    rowRatio: z
      .number()
      .int()
      .min(1)
      .max(20)
      .nullable()
      .optional()
      .meta({ description: "This crop's rows in the row ratio (main 2, intercrop 1 → 2:1)", example: 2 }),
    seedRate: measure(10000, 'Seed rate, kg/ha', 40),
  })
  .strict();

const croppingSystem = z
  .object({
    croppingSystemId: objectId.meta({ description: 'A cropping system from the masters' }),
    crops: z.array(systemCrop).max(6).default([]),
    sowingDate: z.coerce.date().nullable().optional(),
    harvestDate: z.coerce.date().nullable().optional(),
  })
  .strict()
  .refine((s) => !s.sowingDate || !s.harvestDate || s.sowingDate <= s.harvestDate, {
    message: 'Harvest date must be after sowing',
    path: ['harvestDate'],
  });

const practice = z
  .object({
    treatmentCode: shortCode.meta({ example: 'T2' }),
    seedDetails: z.string().trim().max(2000).nullable().optional(),
    nutrientDetails: z.string().trim().max(2000).nullable().optional(),
    protectionDetails: z.string().trim().max(2000).nullable().optional(),
    otherDetails: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

const updateBody = z
  .object({
    seasonCrops: z
      .record(masterCode, z.array(objectId).max(20).nullable())
      .optional()
      .meta({
        example: { KHARIF: [] },
        description:
          "The centre's crops per season where they differ from the experiment's (crop master item ids). Only the seasons sent change; null puts a season back to the experiment's crops.",
      }),
    croppingSystems: z.array(croppingSystem).max(10).optional(),
    practices: z.array(practice).max(60).optional(),
    treatments: z.array(treatment).optional(),
    mainPlotData: z.array(treatment).optional(),
    subPlotData: z.array(subPlotItem).optional(),
    subSubPlotData: z.array(treatment).optional(),
    factor1Data: z.array(treatment).optional(),
    factor2Data: z.array(treatment).optional(),
    factor3Data: z.array(treatment).optional(),
    disabledParameters: z.array(disabledParameter).optional(),
    locked: z.array(z.string().trim()).optional(),
    inChargeUserId: objectId.nullable().optional(),
    layoutNotes: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(TRIAL_STATUSES).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update' })
  .refine(
    (b) =>
      !b.croppingSystems ||
      new Set(b.croppingSystems.map((c) => c.croppingSystemId)).size === b.croppingSystems.length,
    {
      message: 'Each cropping system appears once',
      path: ['croppingSystems'],
    },
  );

const listQuery = z.object({
  experimentId: objectId.optional(),
  centreId: objectId.optional(),
  status: z.enum(TRIAL_STATUSES).optional(),
  assignmentStatus: z.enum(ASSIGNMENT_STATUSES).optional(),
});

export const listTrialsSchemas = { query: listQuery } satisfies RequestSchemas;
export const getTrialSchemas = { params: idParams } satisfies RequestSchemas;
export const updateTrialSchemas = { params: idParams, body: updateBody } satisfies RequestSchemas;
export const getTrialMetadataSchemas = { params: idParams } satisfies RequestSchemas;
export const saveTrialMetadataSchemas = { params: idParams, body: trialBody } satisfies RequestSchemas;

const toggleLockBody = z
  .object({
    lockedKey: z.string().trim().min(1).max(50),
    isLocked: z.boolean(),
  })
  .strict();

export const toggleTrialLockSchemas = {
  params: idParams,
  body: toggleLockBody,
} satisfies RequestSchemas;

export type ToggleTrialLockDto = z.output<typeof toggleLockBody>;
export type UpdateTrialDto = z.output<typeof updateBody>;
export type ListTrialsQuery = z.output<typeof listQuery>;
export type SaveTrialMetadataDto = z.output<typeof trialBody>;
