import { z } from 'zod';

export const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

/** A 24-character hex MongoDB ObjectId string. */
export const objectId = z.string().regex(OBJECT_ID_PATTERN, 'Invalid id');

export const idParams = z.object({ id: objectId });

/**
 * Standard list query: ?page=1&limit=20&sort=-createdAt
 * `sortFields` is an allowlist, so clients cannot sort on arbitrary or unindexed fields.
 */
export const listQuery = (sortFields: readonly string[]) => {
  const sortHelp = `Sort by one of: ${sortFields.join(', ')} (prefix with - for descending)`;
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z
      .string()
      .refine((value) => sortFields.includes(value.replace(/^-/, '')), { message: sortHelp })
      .optional()
      .meta({ description: sortHelp }),
  });
};

export const skipFor = (page: number, limit: number): number => (page - 1) * limit;
