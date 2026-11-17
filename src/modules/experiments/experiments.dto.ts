import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { idParams, objectId } from '../../utils/validators.js';
import { fyCode } from '../financialYears/financialYears.dto.js';
import { masterCode } from '../masters/masters.dto.js';
import {
  DESIGNS_NEEDING_REPLICATIONS,
  EXPERIMENT_DESIGNS,
  EXPERIMENT_STATUSES,
  PARAMETER_LEVELS,
  type ExperimentDesign,
} from './experiments.model.js';

const treatment = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Treatment code: letters, digits, _ or -')
      .meta({ example: 'T2' }),
    name: z.string().trim().min(1).max(200).meta({ example: 'Complete NF' }),
    description: z.string().trim().max(1000).optional(),
  })
  .strict();

const experimentParameter = z
  .object({
    parameterId: objectId,
    section: z.string().trim().min(1).max(80).default('Observations').meta({ example: 'Growth & yield' }),
    level: z.enum(PARAMETER_LEVELS).default('plot'),
    required: z.boolean().default(false),
  })
  .strict();

const uniqueBy = <T>(items: T[] | undefined, key: (t: T) => string) =>
  !items || new Set(items.map(key)).size === items.length;

const shape = {
  code: masterCode.meta({ example: 'NF-LTE' }),
  title: z
    .string()
    .trim()
    .min(5)
    .max(300)
    .meta({ example: 'Long-term evaluation of natural farming practices' }),
  programmeCode: masterCode.meta({ example: 'P2' }),
  objectives: z.array(z.string().trim().min(3).max(500)).max(10).optional(),
  design: z.enum(EXPERIMENT_DESIGNS),
  replications: z.number().int().min(1).max(20).nullable().optional().meta({ example: 3 }),
  treatments: z.array(treatment).max(60).optional(),
  parameters: z.array(experimentParameter).max(300).optional(),
  seasons: z
    .array(masterCode)
    .max(10)
    .optional()
    .meta({ example: ['KHARIF', 'RABI'] }),
  startYear: fyCode,
  centreIds: z.array(objectId).max(100).optional(),
  referenceTreatmentCode: z.string().trim().toUpperCase().max(20).nullable().optional().meta({
    example: null,
    description: 'Treatment the others are compared with ("% vs reference"); one of the treatment codes',
  }),
};

const checks = <
  T extends z.ZodType<{
    treatments?: { code: string }[];
    parameters?: { parameterId: string }[];
    design?: string;
    replications?: number | null;
  }>,
>(
  s: T,
  { partial = false } = {},
) =>
  s
    .refine((b) => uniqueBy(b.treatments, (t) => t.code), {
      message: 'Treatment codes must be unique',
      path: ['treatments'],
    })
    .refine((b) => uniqueBy(b.parameters, (p) => p.parameterId), {
      message: 'Each parameter can be added only once',
      path: ['parameters'],
    })
    .refine(
      (b) =>
        b.design === undefined ||
        !DESIGNS_NEEDING_REPLICATIONS.includes(b.design as ExperimentDesign) ||
        // An update that doesn't send replications is checked against the saved value (service).
        (partial && b.replications === undefined) ||
        (b.replications !== undefined && b.replications !== null && b.replications >= 2),
      {
        message: `${DESIGNS_NEEDING_REPLICATIONS.join(' and ')} need at least 2 replications`,
        path: ['replications'],
      },
    );

const createBody = checks(z.object(shape).strict());

const updateBody = checks(
  z
    .object(shape)
    .partial()
    .extend({ status: z.enum(EXPERIMENT_STATUSES).optional() })
    .strict()
    .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update' }),
  { partial: true },
);

const listQuery = z.object({
  programmeCode: masterCode.optional(),
  status: z.enum(EXPERIMENT_STATUSES).optional(),
  centreId: objectId.optional(),
  search: z.string().trim().max(100).optional(),
});

export const listExperimentsSchemas = { query: listQuery } satisfies RequestSchemas;
export const getExperimentSchemas = { params: idParams } satisfies RequestSchemas;
export const createExperimentSchemas = { body: createBody } satisfies RequestSchemas;
export const updateExperimentSchemas = { params: idParams, body: updateBody } satisfies RequestSchemas;

export type CreateExperimentDto = z.output<typeof createBody>;
export type UpdateExperimentDto = z.output<typeof updateBody>;
export type ListExperimentsQuery = z.output<typeof listQuery>;
