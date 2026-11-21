import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { idParams, objectId } from '../../utils/validators.js';
import { masterCode } from '../masters/masters.dto.js';
import {
  DESIGNS_NEEDING_REPLICATIONS,
  EXPERIMENT_DESIGNS,
  EXPERIMENT_STATUSES,
  MAX_PLOT_COUNT,
  PARAMETER_LEVELS,
  type ExperimentDesign,
} from './experiments.model.js';

export { MAX_PLOT_COUNT };

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
    mainPlotCode: z.string().trim().toUpperCase().max(20).nullable().optional(),
    subPlotCode: z.string().trim().toUpperCase().max(20).nullable().optional(),
    subSubPlotCode: z.string().trim().toUpperCase().max(20).nullable().optional(),
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
  title: z
    .string()
    .trim()
    .min(5)
    .max(300)
    .meta({ example: 'Long-term evaluation of natural farming practices' }),
  programmeCode: masterCode.meta({ example: 'P2' }),
  objectives: z.array(z.string().trim().min(3).max(500)).max(10).optional(),
  design: z.preprocess(
    (v) => (typeof v === 'string' && /^split[- ]split plot$/i.test(v.trim()) ? 'Split-split plot' : v),
    z.enum(EXPERIMENT_DESIGNS),
  ),
  replications: z.number().int().min(1).max(20).nullable().optional().meta({ example: 3 }),
  mainPlotCount: z.number().int().min(0).max(MAX_PLOT_COUNT).optional().meta({
    example: 0,
    description:
      'Split / strip plot: main plots (≥ 1); other designs: 0. Each main × sub plot holds every treatment × replication',
  }),
  subPlotCount: z.number().int().min(0).max(MAX_PLOT_COUNT).optional().meta({
    example: 0,
    description: 'Split / strip plot: sub plots per main plot (≥ 1); other designs: 0',
  }),
  subSubPlotCount: z.number().int().min(0).max(MAX_PLOT_COUNT).optional().meta({
    example: 0,
    description: 'Split-split plot: sub-sub plots per sub plot (≥ 1); other designs: 0',
  }),
  treatments: z.array(treatment).max(60).optional(),
  mainPlotData: z.array(treatment).max(60).optional(),
  subPlotData: z.array(treatment).max(60).optional(),
  subSubPlotData: z.array(treatment).max(60).optional(),
  defaultParameters: z.array(experimentParameter).max(300).optional(),
  seasons: z
    .union([
      z.record(masterCode, z.array(objectId)),
      // A plain list of season codes means: these seasons, with no items yet.
      z.array(masterCode).transform((codes) => Object.fromEntries(codes.map((c) => [c, []]))),
    ])
    .optional()
    .meta({ example: { KHARIF: [], RABI: [] } }),
  startYear: z.number().int().min(1900).max(2100).meta({ example: 2026 }),
  endYear: z.number().int().min(1900).max(2100).meta({ example: 2029 }),
  centreIds: z
    .array(objectId)
    .max(100)
    .optional()
    .transform((ids) => (ids ? [...new Set(ids)] : ids)),
  piUserId: objectId.nullable().optional().meta({
    description: 'Experiment PI seat to link (PCU only, `research.assign`); null unlinks',
  }),
  referenceTreatmentCode: z.string().trim().toUpperCase().max(20).nullable().optional().meta({
    example: null,
    description: 'Treatment the others are compared with ("% vs reference"); one of the treatment codes',
  }),
};

const checks = <
  T extends z.ZodType<{
    treatments?: { code: string }[];
    mainPlotData?: { code: string }[];
    subPlotData?: { code: string }[];
    subSubPlotData?: { code: string }[];
    defaultParameters?: { parameterId: string }[];
    design?: string;
    replications?: number | null;
    startYear?: number;
    endYear?: number;
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
    .refine((b) => uniqueBy(b.mainPlotData, (t) => t.code), {
      message: 'Main plot treatment codes must be unique',
      path: ['mainPlotData'],
    })
    .refine((b) => uniqueBy(b.subPlotData, (t) => t.code), {
      message: 'Sub plot treatment codes must be unique',
      path: ['subPlotData'],
    })
    .refine((b) => uniqueBy(b.subSubPlotData, (t) => t.code), {
      message: 'Sub-sub plot treatment codes must be unique',
      path: ['subSubPlotData'],
    })
    .refine((b) => uniqueBy(b.defaultParameters, (p) => p.parameterId), {
      message: 'Each parameter can be added only once',
      path: ['defaultParameters'],
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
    )
    .refine((b) => b.startYear === undefined || b.endYear === undefined || b.endYear >= b.startYear, {
      message: 'endYear must be greater than or equal to startYear',
      path: ['endYear'],
    });

const createBody = checks(
  z
    .object({
      ...shape,
      code: masterCode.optional().meta({
        example: 'NF-LTE',
        description: 'Leave out to generate the next code (AINP-NF-EXPT-001 …)',
      }),
      mainPlotCount: shape.mainPlotCount.default(0),
      subPlotCount: shape.subPlotCount.default(0),
      subSubPlotCount: shape.subSubPlotCount.default(0),
    })
    .strict(),
);

const updateBody = checks(
  z
    .object(shape)
    .partial()
    .extend({
      status: z.enum(EXPERIMENT_STATUSES).optional(),
      withdrawReason: z.string().trim().min(3).max(500).optional().meta({
        description:
          'Why centres left out of `centreIds` are withdrawn (kept on their trial; their data stays read-only)',
      }),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update' }),
  { partial: true },
);

const listQuery = z.object({
  programmeCode: masterCode.optional(),
  status: z.enum(EXPERIMENT_STATUSES).optional(),
  centreId: objectId.optional(),
  piUserId: objectId.optional(),
  startYear: z.coerce.number().int().optional(),
  endYear: z.coerce.number().int().optional(),
  search: z.string().trim().max(100).optional(),
});

export const listExperimentsSchemas = { query: listQuery } satisfies RequestSchemas;
export const getExperimentSchemas = { params: idParams } satisfies RequestSchemas;
export const createExperimentSchemas = { body: createBody } satisfies RequestSchemas;
export const updateExperimentSchemas = { params: idParams, body: updateBody } satisfies RequestSchemas;

export type CreateExperimentDto = z.output<typeof createBody>;
export type UpdateExperimentDto = z.output<typeof updateBody>;
export type ListExperimentsQuery = z.output<typeof listQuery>;
