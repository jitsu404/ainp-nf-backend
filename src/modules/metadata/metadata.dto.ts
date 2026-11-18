import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { idParams } from '../../utils/validators.js';
import {
  AVAILABILITY_LOCATIONS,
  DATA_CATEGORIES,
  DATA_FORMATS,
  DATA_SCALES,
  DATA_TYPES,
  FUNDING_TYPES,
  UNIT_TYPES,
} from './metadata.fields.js';

// No .default() here: these bodies are partial updates (see CLAUDE.md).

/** Empty strings clear a field. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));
const optionalChoice = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.enum(values), z.literal('')])
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));

const trialBody = z
  .object({
    datasetTitle: optionalText(300),
    description: optionalText(2000),
    coPis: z
      .array(
        z
          .object({
            name: z.string().trim().min(2).max(150).meta({ example: 'Dr. A. Kumar' }),
            designation: optionalText(150),
            email: z
              .email()
              .max(200)
              .nullable()
              .optional()
              .or(z.literal('').transform(() => null)),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    completionDate: z.iso
      .date()
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
    plotSize: optionalText(200),
    dataFormat: z.array(z.enum(DATA_FORMATS)).max(DATA_FORMATS.length).optional(),
    instruments: optionalText(2000),
    availabilityLocation: optionalChoice(AVAILABILITY_LOCATIONS),
    embargoYears: z.number().int().min(0).max(20).nullable().optional(),
    source: optionalText(500),
    relation: optionalText(1000),
    citation: optionalText(2000),
  })
  .strict();

const commonBody = z
  .object({
    smdName: optionalText(500),
    instituteName: optionalText(500),
    unitType: optionalChoice(UNIT_TYPES),
    unitName: optionalText(500),
    projectCode: optionalText(500),
    fundingType: optionalChoice(FUNDING_TYPES),
    fundingSource: optionalText(500),
    subject: optionalText(500),
    keywords: optionalText(500),
    dataCategory: optionalChoice(DATA_CATEGORIES),
    dataType: optionalChoice(DATA_TYPES),
    methodology: optionalText(4000),
    dataScale: optionalChoice(DATA_SCALES),
    language: optionalText(500),
  })
  .strict();

const remarkBody = z.object({ remark: z.string().trim().max(2000).optional() }).strict();
const returnBody = z
  .object({ remark: z.string().trim().min(3).max(2000).meta({ example: 'Add the plot size' }) })
  .strict();

export const getMetadataSchemas = { params: idParams } satisfies RequestSchemas;
export const saveTrialMetadataSchemas = { params: idParams, body: trialBody } satisfies RequestSchemas;
export const submitMetadataSchemas = { params: idParams, body: remarkBody } satisfies RequestSchemas;
export const returnMetadataSchemas = { params: idParams, body: returnBody } satisfies RequestSchemas;
export const approveMetadataSchemas = { params: idParams, body: remarkBody } satisfies RequestSchemas;
export const saveCommonMetadataSchemas = { params: idParams, body: commonBody } satisfies RequestSchemas;

export type SaveTrialMetadataDto = z.output<typeof trialBody>;
export type SaveCommonMetadataDto = z.output<typeof commonBody>;
