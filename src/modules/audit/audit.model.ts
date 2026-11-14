import { Schema, type Types, model } from 'mongoose';
import { ROLE_IDS, type RoleId } from '../../config/constants.js';

export interface AuditLog {
  userId: Types.ObjectId;
  /** Snapshot of the name at the time, so the record stays readable after the person leaves. */
  userName?: string;
  roleId: RoleId;
  action: string;
  module: string;
  entityId?: Types.ObjectId;
  centreId?: Types.ObjectId | null;
  requestId: string;
  ip?: string;
  changes?: Record<string, unknown>;
  createdAt: Date;
}

const auditSchema = new Schema<AuditLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String },
    roleId: { type: String, enum: ROLE_IDS, required: true },
    action: { type: String, required: true },
    module: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId },
    centreId: { type: Schema.Types.ObjectId, ref: 'Centre', default: null },
    requestId: { type: String, required: true },
    ip: { type: String },
    changes: { type: Schema.Types.Mixed },
  },
  // Audit rows are append-only: no updatedAt.
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditSchema.index({ module: 1, entityId: 1, createdAt: -1 });
auditSchema.index({ userId: 1, createdAt: -1 });

export const AuditLogModel = model<AuditLog>('AuditLog', auditSchema);
