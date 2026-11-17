import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { idParams, objectId } from '../../utils/validators.js';

export const listQuery = z.object({
  centre: objectId.optional(),
  fy: objectId.optional(),
  budgetHead: objectId.optional(),
  fundCategory: objectId.optional(),
  isTotal: z.stringbool().optional(),
});

export const createBody = z
  .object({
    centre: objectId,
    fy: objectId,
    amount: z.coerce.number().min(0).default(0),
    isTotal: z.boolean().default(false),
    budgetHead: z
      .preprocess((val) => (val === '' ? null : val), objectId.nullable().optional())
      .default(null),
    fundCategory: z
      .preprocess((val) => (val === '' ? null : val), objectId.nullable().optional())
      .default(null),
  })
  .strict()
  .refine((data) => data.isTotal || (data.budgetHead && data.fundCategory), {
    message: 'Both budgetHead and fundCategory are required for head allocations',
    path: ['fundCategory'],
  });

export const allocationItemSchema = z
  .object({
    centre: objectId.optional(),
    fy: objectId.optional(),
    budgetHead: z
      .preprocess((val) => (val === '' ? null : val), objectId.nullable().optional())
      .default(null),
    fundCategory: z
      .preprocess((val) => (val === '' ? null : val), objectId.nullable().optional())
      .default(null),
    amount: z.coerce.number().min(0).default(0),
    isTotal: z.boolean().default(false),
  })
  .strict()
  .refine((data) => data.isTotal || (data.budgetHead && data.fundCategory), {
    message: 'Both budgetHead and fundCategory are required for head allocations',
    path: ['fundCategory'],
  });

export const bulkSaveBody = z.union([
  z.array(allocationItemSchema),
  z
    .object({
      centre: objectId.optional(),
      fy: objectId.optional(),
      allocations: z.array(allocationItemSchema),
    })
    .strict(),
  z
    .object({
      centre: objectId.optional(),
      fy: objectId.optional(),
      items: z.array(allocationItemSchema),
    })
    .strict(),
]);

export const updateBody = z
  .object({
    centre: objectId.optional(),
    fy: objectId.optional(),
    amount: z.coerce.number().min(0).optional(),
    isTotal: z.boolean().optional(),
    budgetHead: z.preprocess((val) => (val === '' ? null : val), objectId.nullable().optional()),
    fundCategory: z.preprocess((val) => (val === '' ? null : val), objectId.nullable().optional()),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update' });

export const listBudgetAllocationsSchemas = { query: listQuery } satisfies RequestSchemas;
export const getBudgetAllocationSchemas = { params: idParams } satisfies RequestSchemas;
export const createBudgetAllocationSchemas = { body: createBody } satisfies RequestSchemas;
export const bulkSaveBudgetAllocationsSchemas = { body: bulkSaveBody } satisfies RequestSchemas;
export const updateBudgetAllocationSchemas = { params: idParams, body: updateBody } satisfies RequestSchemas;
export const deleteBudgetAllocationSchemas = { params: idParams } satisfies RequestSchemas;

export type ListBudgetAllocationsQuery = z.output<typeof listQuery>;
export type CreateBudgetAllocationDto = z.output<typeof createBody>;
export type BulkSaveBudgetAllocationDto = z.output<typeof bulkSaveBody>;
export type UpdateBudgetAllocationDto = z.output<typeof updateBody>;
