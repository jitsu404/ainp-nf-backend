import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { idParams } from '../../utils/validators.js';

/** "2026-27": the second part must be the year after the first. */
export const fyCode = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, 'Use the form 2026-27')
  .refine(
    (c) => (Number(c.slice(0, 4)) + 1) % 100 === Number(c.slice(5)),
    'The second year must follow the first',
  )
  .meta({ example: '2026-27' });

const createBody = z
  .object({
    code: fyCode,
    isOpen: z.boolean().optional(),
    isCurrent: z.boolean().optional(),
  })
  .strict();

const updateBody = z
  .object({ isOpen: z.boolean().optional(), isCurrent: z.literal(true).optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide isOpen or isCurrent' });

export const listFySchemas = {} satisfies RequestSchemas;
export const createFySchemas = { body: createBody } satisfies RequestSchemas;
export const updateFySchemas = { params: idParams, body: updateBody } satisfies RequestSchemas;

export type CreateFyDto = z.output<typeof createBody>;
export type UpdateFyDto = z.output<typeof updateBody>;
