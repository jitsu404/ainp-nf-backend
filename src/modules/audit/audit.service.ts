import type { ClientSession } from 'mongoose';
import type { RequestContext } from '../../utils/context.js';
import { AuditLogModel } from './audit.model.js';

export interface AuditEntry {
  action: string;
  module: string;
  entityId?: string;
  centreId?: string | null;
  changes?: Record<string, unknown>;
}

/**
 * The one place that writes the audit trail. Call it from services, inside the same
 * transaction as the change it records (pass `session`), so the two can't drift apart.
 */
export const recordAudit = async (
  ctx: RequestContext,
  entry: AuditEntry,
  session?: ClientSession,
): Promise<void> => {
  await AuditLogModel.create(
    [
      {
        ...entry,
        userId: ctx.user.id,
        userName: ctx.user.name,
        roleId: ctx.user.roleId,
        requestId: ctx.requestId,
        ip: ctx.ip,
      },
    ],
    { session },
  );
};
