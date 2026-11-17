import { Schema, type Types, model } from 'mongoose';
import { ROLE_IDS, type RoleId } from '../../config/constants.js';

/** Old → new value of one field of an edited record. */
export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

/** One observation cell that changed in a sheet save or import. */
export interface CellChange {
  treatmentCode: string;
  replication: number | null;
  parameterCode: string;
  from: number | string | null;
  to: number | string | null;
}

export const AUDIT_SOURCES = ['form', 'excel'] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export interface AuditLog {
  /** The person who acted. Empty only for a failed sign-in with an unknown email. */
  userId?: Types.ObjectId | null;
  /** Snapshot of the name at the time, so the record stays readable after the person leaves. */
  userName?: string;
  roleId?: RoleId | null;
  action: string;
  module: string;
  entityId?: Types.ObjectId;
  /** The centre the activity concerns, so a centre's activity can be listed (and scoped). */
  centreId?: Types.ObjectId | null;
  requestId: string;
  ip?: string;
  /** For edits: only the fields that actually changed, with old and new values. */
  changes?: FieldChanges;
  /** For observation sheets: every cell that changed. */
  cells?: CellChange[];
  /** How the data came in: typed in a form, or imported from Excel. */
  source?: AuditSource;
  /** Anything else worth keeping, e.g. the email tried in a failed sign-in. */
  details?: Record<string, unknown>;
  createdAt: Date;
}

const auditSchema = new Schema<AuditLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    userName: { type: String },
    roleId: { type: String, enum: [...ROLE_IDS, null], default: null },
    action: { type: String, required: true },
    module: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId },
    centreId: { type: Schema.Types.ObjectId, ref: 'Centre', default: null },
    requestId: { type: String, required: true },
    ip: { type: String },
    changes: { type: Schema.Types.Mixed },
    cells: { type: Schema.Types.Mixed },
    source: { type: String, enum: AUDIT_SOURCES },
    details: { type: Schema.Types.Mixed },
  },
  // Audit rows are append-only: no updatedAt, and nothing in the code updates or deletes them.
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditSchema.index({ createdAt: -1 });
auditSchema.index({ module: 1, entityId: 1, createdAt: -1 });
auditSchema.index({ userId: 1, createdAt: -1 });
auditSchema.index({ centreId: 1, createdAt: -1 });

export const AuditLogModel = model<AuditLog>('AuditLog', auditSchema);
