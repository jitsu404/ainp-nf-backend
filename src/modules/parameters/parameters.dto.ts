import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { cell } from '../../utils/importer.js';
import { idParams, importQuery } from '../../utils/validators.js';
import { masterCode } from '../masters/masters.dto.js';
import { PARAMETER_CATEGORIES, PARAMETER_DATA_TYPES } from './parameters.model.js';

const parameterCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_]{0,39}$/, 'Code: letters, digits or _, up to 40 characters')
  .meta({ example: 'PRM_001' });

// No `code`: it is generated (PRM_001 …) when a parameter is created and never changes, so the
// formulas that use it stay valid.
const shape = {
  name: z.string().trim().min(2).max(200).meta({ example: 'Grain yield' }),
  unitCode: masterCode
    .nullable()
    .optional()
    .meta({ example: 'UNT-001', description: 'Code of a unit master item' }),
  category: z.enum(PARAMETER_CATEGORIES).meta({ example: 'Yield' }),
  dataType: z.enum(PARAMETER_DATA_TYPES).optional().meta({ description: 'Default: number' }),
  decimals: z.number().int().min(0).max(6).optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  choices: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  method: z.string().trim().max(1000).nullable().optional(),
  formula: z.string().trim().max(500).nullable().optional().meta({
    example: null,
    description:
      'Makes it a calculated parameter: parameter codes, numbers, + - * /, brackets and IFEMPTY(x, 0), e.g. "PRM_012 / PRM_013". null clears it.',
  }),
};

const rangeOk = (b: { min?: number | null; max?: number | null }) =>
  b.min === undefined || b.max === undefined || b.min === null || b.max === null || b.min <= b.max;
const choicesOk = (b: { dataType?: string; choices?: string[] }) =>
  b.dataType !== 'choice' || (b.choices?.length ?? 0) > 0;

const createBody = z
  .object(shape)
  .strict()
  .refine(rangeOk, { message: 'min must not be greater than max', path: ['min'] })
  .refine(choicesOk, { message: 'A choice parameter needs at least one choice', path: ['choices'] });

const updateBody = z
  .object(shape)
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update' })
  .refine(rangeOk, { message: 'min must not be greater than max', path: ['min'] });

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  category: z.enum(PARAMETER_CATEGORIES).optional(),
  isActive: z.stringbool().optional(),
});

/** One spreadsheet row of a parameter import. Choices are separated by "|". */
export const parameterImportRow = z
  .object({
    // Empty for a new parameter (its code is generated); an existing code updates that parameter.
    code: z.preprocess((v) => (v === undefined ? v : String(v)), parameterCode).optional(),
    name: cell.text().pipe(z.string().min(2).max(200)),
    unitCode: z.preprocess((v) => (v === undefined ? v : String(v)), masterCode).optional(),
    category: cell.text().pipe(z.enum(PARAMETER_CATEGORIES)),
    dataType: cell.text().pipe(z.enum(PARAMETER_DATA_TYPES)).optional(),
    decimals: cell.number().pipe(z.number().int().min(0).max(6)).optional(),
    min: cell.number().optional(),
    max: cell.number().optional(),
    choices: cell
      .text()
      .transform((s) =>
        s
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean),
      )
      .optional(),
    method: cell.text().pipe(z.string().max(1000)).optional(),
    formula: cell.text().pipe(z.string().max(500)).optional(),
    isActive: cell.bool().optional(),
  })
  .refine(rangeOk, { message: 'min must not be greater than max', path: ['min'] });

export const listParametersSchemas = { query: listQuery } satisfies RequestSchemas;
export const createParameterSchemas = { body: createBody } satisfies RequestSchemas;
export const updateParameterSchemas = { params: idParams, body: updateBody } satisfies RequestSchemas;
export const parameterTemplateSchemas = {} satisfies RequestSchemas;
export const importParametersSchemas = { query: importQuery } satisfies RequestSchemas;

export type CreateParameterDto = z.output<typeof createBody>;
export type UpdateParameterDto = z.output<typeof updateBody>;
export type ListParametersQuery = z.output<typeof listQuery>;
export type ParameterImportRow = z.output<typeof parameterImportRow>;
