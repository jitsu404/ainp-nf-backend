import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { idParams, objectId } from '../../utils/validators.js';
import { masterCode } from '../masters/masters.dto.js';
import { TRIAL_STATUSES } from './trials.model.js';

const shortCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Code: letters, digits, _ or -');

const seasonCrop = z
  .object({
    seasonCode: masterCode.meta({ example: 'KHARIF' }),
    mainCropCode: masterCode.meta({ example: 'RICE' }),
    mainVariety: z.string().trim().max(100).nullable().optional(),
    intercropCode: masterCode.nullable().optional(),
    intercropVariety: z.string().trim().max(100).nullable().optional(),
    rowRatio: z
      .string()
      .trim()
      .regex(/^\d{1,2}:\d{1,2}$/, 'Row ratio like 2:1')
      .nullable()
      .optional(),
    seedRate: z
      .number()
      .min(0)
      .max(10000)
      .nullable()
      .optional()
      .meta({ example: 40, description: 'Seed rate in kg/ha' }),
    sowingDate: z.coerce.date().nullable().optional(),
    harvestDate: z.coerce.date().nullable().optional(),
  })
  .strict()
  .refine((s) => !s.sowingDate || !s.harvestDate || s.sowingDate <= s.harvestDate, {
    message: 'Harvest date must be after sowing',
    path: ['harvestDate'],
  });

const croppingSystem = z
  .object({
    code: shortCode.meta({ example: 'CS1' }),
    name: z.string().trim().min(2).max(200).meta({ example: 'Rice – Wheat' }),
    seasons: z.array(seasonCrop).max(6).default([]),
  })
  .strict()
  .refine((cs) => new Set(cs.seasons.map((s) => s.seasonCode)).size === cs.seasons.length, {
    message: 'Each season appears once per cropping system',
    path: ['seasons'],
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
    croppingSystems: z.array(croppingSystem).max(10).optional(),
    practices: z.array(practice).max(60).optional(),
    inChargeUserId: objectId.nullable().optional(),
    layoutNotes: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(TRIAL_STATUSES).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update' })
  .refine(
    (b) =>
      !b.croppingSystems || new Set(b.croppingSystems.map((c) => c.code)).size === b.croppingSystems.length,
    {
      message: 'Cropping system codes must be unique',
      path: ['croppingSystems'],
    },
  );

const listQuery = z.object({
  experimentId: objectId.optional(),
  centreId: objectId.optional(),
  status: z.enum(TRIAL_STATUSES).optional(),
});

export const listTrialsSchemas = { query: listQuery } satisfies RequestSchemas;
export const getTrialSchemas = { params: idParams } satisfies RequestSchemas;
export const updateTrialSchemas = { params: idParams, body: updateBody } satisfies RequestSchemas;

export type UpdateTrialDto = z.output<typeof updateBody>;
export type ListTrialsQuery = z.output<typeof listQuery>;
