import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { cell } from '../../utils/importer.js';
import { importQuery, objectId } from '../../utils/validators.js';
import { MASTER_TYPE_IDS } from './masters.types.js';

export const masterCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,29}$/, 'Code: letters, digits, _ or -, up to 30 characters')
  .meta({ example: 'KHARIF' });

const typeParam = z.object({ type: z.enum(MASTER_TYPE_IDS).meta({ example: 'season' }) });

const itemBody = z
  .object({
    code: masterCode,
    name: z.string().trim().min(1).max(200).meta({ example: 'Kharif' }),
    group: z
      .string()
      .trim()
      .max(60)
      .optional()
      .meta({ description: 'Allowed values depend on the type (see /masters/types)' }),
    linkedTo: z
      .preprocess((val) => (val === '' ? null : val), objectId.nullable().optional())
      // `preprocess` hides the id rule from the Postman generator, so give a valid example.
      .meta({
        example: null,
        description: 'Optional ID of linked master item (e.g. fundCategory for budgetHead)',
      }),
    description: z.string().trim().max(500).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .strict();

const updateItemBody = itemBody
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update' });

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  group: z.string().trim().max(60).optional(),
  isActive: z.stringbool().optional(),
  linkedTo: z
    .preprocess((val) => (val === '' ? undefined : val), objectId.optional())
    .meta({ description: 'Filter by linked master item ID' }),
});

/** One spreadsheet row of a masters import. */
export const masterImportRow = z.object({
  code: z.preprocess((v) => (v === undefined ? v : String(v)), masterCode),
  name: cell.text().pipe(z.string().min(1).max(200)),
  group: cell.text().pipe(z.string().max(60)).optional(),
  description: cell.text().pipe(z.string().max(500)).optional(),
  sortOrder: cell.number().pipe(z.number().int().min(0).max(9999)).optional(),
  isActive: cell.bool().optional(),
});

export const listMastersSchemas = { params: typeParam, query: listQuery } satisfies RequestSchemas;
export const createMasterSchemas = { params: typeParam, body: itemBody } satisfies RequestSchemas;
export const updateMasterSchemas = {
  params: typeParam.extend({ id: objectId }),
  body: updateItemBody,
} satisfies RequestSchemas;
export const masterTemplateSchemas = { params: typeParam } satisfies RequestSchemas;
export const importMastersSchemas = { params: typeParam, query: importQuery } satisfies RequestSchemas;

export type CreateMasterDto = z.output<typeof itemBody>;
export type UpdateMasterDto = z.output<typeof updateItemBody>;
export type ListMastersQuery = z.output<typeof listQuery>;
export type MasterImportRow = z.output<typeof masterImportRow>;
