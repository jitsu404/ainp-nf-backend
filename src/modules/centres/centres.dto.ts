import { z } from 'zod';
import { CENTRE_TYPES } from '../../config/constants.js';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { idParams, listQuery } from '../../utils/validators.js';

const centreBody = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2,10}$/, 'Code must be 2–10 letters')
      .meta({ example: 'KNP', description: 'Short unique code; stored in upper case' })
      .transform((value) => value.toUpperCase()),
    name: z.string().trim().min(2).max(120).meta({ example: 'Kanpur' }),
    host: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .meta({ example: 'CSA University of Agriculture & Technology', description: 'Host institution' }),
    hostShort: z
      .string()
      .trim()
      .max(40)
      .optional()
      .meta({ example: 'CSAUAT', description: 'Host short name' }),
    hostType: z
      .string()
      .trim()
      .max(40)
      .optional()
      .meta({ example: 'SAU', description: 'SAU, ICAR, Deemed University, CAU …' }),
    city: z.string().trim().max(80).optional().meta({ example: 'Kanpur' }),
    pincode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Pincode must be 6 digits')
      .optional()
      .meta({ example: '208002' }),
    state: z.string().trim().min(2).max(60).meta({ example: 'Uttar Pradesh' }),
    zone: z
      .string()
      .trim()
      .max(80)
      .optional()
      .meta({ example: 'Upper Gangetic Plains', description: 'Agro-climatic zone' }),
    type: z.enum(CENTRE_TYPES).optional().meta({ description: 'Default: Network Centre' }),
  })
  .strict();

const updateCentreBody = centreBody
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update' });

const listCentresQuery = listQuery(['code', 'name', 'state', 'createdAt']).extend({
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .meta({ description: 'Matches name, code, host, host short name, city or state' }),
  state: z.string().trim().max(60).optional(),
  type: z.enum(CENTRE_TYPES).optional(),
  isActive: z.stringbool().optional().meta({ description: 'true or false' }),
});

// Request schema bundles: used by routes (validate) and controllers (getValidated).
export const listCentresSchemas = { query: listCentresQuery } satisfies RequestSchemas;
export const getCentreSchemas = { params: idParams } satisfies RequestSchemas;
export const createCentreSchemas = { body: centreBody } satisfies RequestSchemas;
export const updateCentreSchemas = { params: idParams, body: updateCentreBody } satisfies RequestSchemas;

export type CreateCentreDto = z.output<typeof centreBody>;
export type UpdateCentreDto = z.output<typeof updateCentreBody>;
export type ListCentresQuery = z.output<typeof listCentresQuery>;
