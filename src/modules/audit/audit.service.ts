import { type ClientSession, type QueryFilter, trusted } from 'mongoose';
import { ROLES, type RoleId } from '../../config/constants.js';
import { type RequestContext, withScope } from '../../utils/context.js';
import { buildWorkbook } from '../../utils/excel.js';
import { pageMeta } from '../../utils/response.js';
import { escapeRegex, skipFor } from '../../utils/validators.js';
import type { AuditFilters, ListAuditQuery } from './audit.dto.js';
import {
  type AuditLog,
  AuditLogModel,
  type AuditSource,
  type CellChange,
  type FieldChanges,
} from './audit.model.js';

export type { AuditSource, CellChange, FieldChanges };

export interface AuditEntry {
  action: string;
  module: string;
  entityId?: string;
  centreId?: string | null;
  /** Use fieldChanges(before, after) so only real changes are stored, with old and new values. */
  changes?: FieldChanges;
  cells?: CellChange[];
  source?: AuditSource;
  details?: Record<string, unknown>;
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

/**
 * Sign-in, failed sign-in and sign-out. There is no signed-in request context for these, so the
 * account (if known) is passed explicitly. A failed sign-in with an unknown email has no user.
 */
export const recordAuthEvent = async (
  meta: { requestId: string; ip?: string },
  event: {
    action: string;
    user?: { id: string; name: string; roleId: RoleId; centreId: string | null } | null;
    details?: Record<string, unknown>;
  },
): Promise<void> => {
  await AuditLogModel.create({
    action: event.action,
    module: 'auth',
    userId: event.user?.id ?? null,
    userName: event.user?.name,
    roleId: event.user?.roleId ?? null,
    centreId: event.user?.centreId ?? null,
    entityId: event.user?.id,
    details: event.details,
    requestId: meta.requestId,
    ip: meta.ip,
  });
};

// ── Old → new values ─────────────────────────────────────────────────────────

/** A JSON-safe copy without database ids, so values compare by content (ObjectIds → strings). */
const plain = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value ?? null, (key, v: unknown) => (key === '_id' || key === 'id' ? undefined : v)),
  );

/**
 * The given fields of a record as plain values. Take one before changing a document and one
 * after saving it, then pass both to fieldChanges().
 */
export const snapshot = (record: object, keys: readonly string[]): Record<string, unknown> => {
  const toObject = (record as { toObject?: () => unknown }).toObject;
  const source = (typeof toObject === 'function' ? toObject.call(record) : record) as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, plain(source[key])]));
};

/** Only the fields whose value changed, as { field: { from, to } }; undefined when nothing did. */
export const fieldChanges = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChanges | undefined => {
  const changes: FieldChanges = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { from: before[key] ?? null, to: after[key] ?? null };
    }
  }
  return Object.keys(changes).length ? changes : undefined;
};

// ── Reading ──────────────────────────────────────────────────────────────────

const MAX_EXPORT_ROWS = 10_000;

/** Filters → query. Centre users only ever see their own centre's activity (withScope). */
const filterFor = (ctx: RequestContext, q: AuditFilters): QueryFilter<AuditLog> => {
  const where: QueryFilter<AuditLog> = {};
  for (const key of ['module', 'roleId', 'userId', 'centreId', 'entityId'] as const) {
    if (q[key]) where[key] = q[key];
  }
  if (q.from || q.to) {
    // Dates are Indian Standard Time days.
    where.createdAt = trusted({
      ...(q.from && { $gte: new Date(`${q.from}T00:00:00+05:30`) }),
      ...(q.to && { $lte: new Date(`${q.to}T23:59:59.999+05:30`) }),
    });
  }
  if (q.search) {
    const pattern = new RegExp(escapeRegex(q.search), 'i');
    where.$or = [{ action: pattern }, { userName: pattern }];
  }
  return withScope(ctx.user, where);
};

export const listAudit = async (ctx: RequestContext, q: ListAuditQuery) => {
  const filter = filterFor(ctx, q);
  const [items, total] = await Promise.all([
    AuditLogModel.find(filter)
      .sort(q.sort ?? '-createdAt')
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit)
      .populate('centreId', 'code name'),
    AuditLogModel.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(q.page, q.limit, total) };
};

const show = (v: unknown): string =>
  v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** One line describing what changed, for the Excel export. */
export const describeChanges = (row: Pick<AuditLog, 'changes' | 'cells' | 'details'>): string => {
  const parts: string[] = [];
  for (const [field, { from, to }] of Object.entries(row.changes ?? {})) {
    parts.push(`${field}: ${show(from)} → ${show(to)}`);
  }
  for (const c of row.cells ?? []) {
    parts.push(
      `${c.treatmentCode}${c.replication ? ` R${c.replication}` : ''} ${c.parameterCode}: ${show(c.from)} → ${show(c.to)}`,
    );
  }
  if (row.details?.email) parts.push(`email tried: ${show(row.details.email)}`);
  return parts.join('; ');
};

const istTime = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

/** The filtered trail as an Excel file (newest first, up to 10,000 rows). */
export const exportAudit = async (ctx: RequestContext, q: AuditFilters): Promise<Buffer> => {
  const rows = await AuditLogModel.find(filterFor(ctx, q))
    .sort('-createdAt')
    .limit(MAX_EXPORT_ROWS)
    .populate<{ centreId: { code: string; name: string } | null }>('centreId', 'code name')
    .lean();
  return buildWorkbook(
    'Audit trail',
    [
      { key: 'when', header: 'When (IST)', width: 22 },
      { key: 'person', header: 'Person', width: 26 },
      { key: 'role', header: 'Role', width: 12 },
      { key: 'centre', header: 'Centre', width: 20 },
      { key: 'module', header: 'Module', width: 14 },
      { key: 'action', header: 'Action', width: 50 },
      { key: 'changes', header: 'Changes', width: 80 },
      { key: 'source', header: 'Source', width: 10 },
      { key: 'ip', header: 'IP address', width: 16 },
      { key: 'requestId', header: 'Request id', width: 38 },
    ],
    rows.map((r) => ({
      when: istTime(r.createdAt),
      person: r.userName ?? '—',
      role: r.roleId ? ROLES[r.roleId].label : '—',
      centre: r.centreId ? `${r.centreId.name} (${r.centreId.code})` : '—',
      module: r.module,
      action: r.action,
      changes: describeChanges(r),
      source: r.source ?? '',
      ip: r.ip ?? '',
      requestId: r.requestId,
    })),
  );
};
