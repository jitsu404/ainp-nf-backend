import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { idParams } from '../../utils/validators.js';
import { masterCode } from '../masters/masters.dto.js';
import { MAX_INTERCROPS } from './croppingSystems.model.js';

const fields = {
  name: z.string().trim().max(200).optional().meta({
    description: 'Left out or empty: made from the crops, e.g. "Rice + Soybean"',
  }),
  description: z.string().trim().max(1000).nullable().optional(),
  seasonCode: masterCode.meta({ example: 'KHARIF' }),
  mainCropCode: masterCode.meta({ example: 'CRP-001' }),
  intercropCodes: z
    .array(masterCode)
    .max(MAX_INTERCROPS)
    .meta({ example: ['CRP-015'], description: `0 to ${MAX_INTERCROPS} intercrops (crop codes)` }),
  isActive: z.boolean().optional(),
};

const noRepeats = (b: { mainCropCode?: string; intercropCodes?: string[] }) => {
  const crops = [b.mainCropCode, ...(b.intercropCodes ?? [])].filter(Boolean);
  return new Set(crops).size === crops.length;
};
const repeatsMessage = {
  message: 'A crop appears once (the main crop or one intercrop)',
  path: ['intercropCodes'],
};

const createBody = z
  .object({ ...fields, intercropCodes: fields.intercropCodes.optional() })
  .strict()
  .refine(noRepeats, repeatsMessage);

const updateBody = z
  .object(fields)
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update' })
  .refine(noRepeats, repeatsMessage);

const listQuery = z.object({
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const listCroppingSystemsSchemas = { query: listQuery } satisfies RequestSchemas;
export const getCroppingSystemSchemas = { params: idParams } satisfies RequestSchemas;
export const createCroppingSystemSchemas = { body: createBody } satisfies RequestSchemas;
export const updateCroppingSystemSchemas = { params: idParams, body: updateBody } satisfies RequestSchemas;

export type CreateCroppingSystemDto = z.output<typeof createBody>;
export type UpdateCroppingSystemDto = z.output<typeof updateBody>;
export type ListCroppingSystemsQuery = z.output<typeof listQuery>;
