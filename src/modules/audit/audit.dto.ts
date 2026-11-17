import { z } from 'zod';
import { ROLE_IDS } from '../../config/constants.js';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { listQuery, objectId } from '../../utils/validators.js';

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date as YYYY-MM-DD')
  .meta({ example: '2026-11-01' });

const filters = {
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .meta({ description: 'Matches the action text or the person’s name' }),
  module: z.string().trim().max(40).optional().meta({ example: 'sheets' }),
  roleId: z.enum(ROLE_IDS).optional(),
  userId: objectId.optional(),
  centreId: objectId.optional(),
  entityId: objectId.optional().meta({ description: 'One record’s history, e.g. a sheet id' }),
  from: dateOnly.optional().meta({ description: 'From this date (inclusive)' }),
  to: dateOnly.optional().meta({ description: 'Up to this date (inclusive)' }),
};

const listAuditQuery = listQuery(['createdAt']).extend(filters);
const exportAuditQuery = z.object(filters);

export const listAuditSchemas = { query: listAuditQuery } satisfies RequestSchemas;
export const exportAuditSchemas = { query: exportAuditQuery } satisfies RequestSchemas;

export type ListAuditQuery = z.output<typeof listAuditQuery>;
export type AuditFilters = z.output<typeof exportAuditQuery>;
