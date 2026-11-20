import { type QueryFilter, Types, trusted } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import type { RequestContext } from '../../utils/context.js';
import { type ExcelColumn, buildWorkbook, readRows } from '../../utils/excel.js';
import { type ImportResult, type RowError, validateRows } from '../../utils/importer.js';
import { escapeRegex } from '../../utils/validators.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import {
  masterImportRow,
  type CreateMasterDto,
  type ListMastersQuery,
  type UpdateMasterDto,
} from './masters.dto.js';
import { type MasterItem, MasterItemModel } from './masters.model.js';
import { MASTER_TYPES, type MasterType } from './masters.types.js';

const MODULE = 'masters';

export const masterTypes = () => Object.entries(MASTER_TYPES).map(([id, config]) => ({ id, ...config }));

const checkGroup = (type: MasterType, group: string | undefined | null): string | null => {
  const config = MASTER_TYPES[type];
  if (!group) return null;
  // Only lists with a fixed set of groups (crops, inputs, budget heads, staff posts) use one.
  if (!('groups' in config)) {
    throw AppError.badRequest('GROUP_NOT_USED', `${config.label} have no group; leave it empty`);
  }
  if (!(config.groups as readonly string[]).includes(group)) {
    throw AppError.badRequest(
      'INVALID_GROUP',
      `${config.groupLabel} must be one of: ${config.groups.join(', ')}`,
    );
  }
  return group;
};

export const listMasters = async (type: MasterType, query: ListMastersQuery) => {
  const filter: QueryFilter<MasterItem> = { type };
  if (query.group) filter.group = query.group;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.linkedTo) filter.linkedTo = new Types.ObjectId(query.linkedTo);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ code: pattern }, { name: pattern }];
  }
  return MasterItemModel.find(filter)
    .populate('linkedTo', 'name code type')
    .sort({ sortOrder: 1, name: 1 })
    .limit(1000);
};

/** Names of active items of a type, for fields stored by name (a centre's agro-climatic zone). */
export const activeMasterNames = async (type: MasterType): Promise<Set<string>> =>
  new Set((await MasterItemModel.find({ type, isActive: true }, { name: 1 }).lean()).map((m) => m.name));

/** For other modules: whether every given master item id exists. */
export const masterItemsExist = async (ids: string[]): Promise<boolean> =>
  (await MasterItemModel.countDocuments({ _id: trusted({ $in: ids }) })) === new Set(ids).size;

/** Items by id (inactive ones too), for other modules to check and show references such as crops. */
export const masterItemsByIds = async (ids: string[]) =>
  new Map(
    (
      await MasterItemModel.find(
        { _id: trusted({ $in: [...new Set(ids)] }) },
        { type: 1, code: 1, name: 1, isActive: 1 },
      ).lean()
    ).map((m) => [
      String(m._id),
      { id: String(m._id), type: m.type, code: m.code, name: m.name, isActive: m.isActive },
    ]),
  );

/** Code → name of every item of a type (inactive ones too, so old records still read well). */
export const masterNames = async (type: MasterType): Promise<Map<string, string>> =>
  new Map((await MasterItemModel.find({ type }, { code: 1, name: 1 }).lean()).map((m) => [m.code, m.name]));

/** Codes of active items of a type, for other modules to validate references (e.g. seasons). */
export const activeMasterCodes = async (type: MasterType): Promise<Set<string>> =>
  new Set((await MasterItemModel.find({ type, isActive: true }, { code: 1 }).lean()).map((m) => m.code));

export const createMaster = (ctx: RequestContext, type: MasterType, dto: CreateMasterDto) =>
  withTransaction(async (session) => {
    const [item] = await MasterItemModel.create(
      [
        {
          ...dto,
          type,
          group: checkGroup(type, dto.group),
          linkedTo: dto.linkedTo ? new Types.ObjectId(dto.linkedTo) : null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        },
      ],
      { session },
    );
    if (!item) throw new Error('Master item was not created');
    await item.populate('linkedTo', 'name code type');
    await recordAudit(
      ctx,
      { action: `Added ${MASTER_TYPES[type].label}: ${item.code}`, module: MODULE, entityId: item.id },
      session,
    );
    return item;
  });

export const updateMaster = (ctx: RequestContext, type: MasterType, id: string, dto: UpdateMasterDto) =>
  withTransaction(async (session) => {
    const item = await MasterItemModel.findOne({ _id: id, type }).session(session);
    if (!item) throw AppError.notFound('MASTER_NOT_FOUND', `${MASTER_TYPES[type].label}: item not found`);
    const before = snapshot(item, Object.keys(dto));
    item.set({
      ...dto,
      ...(dto.group !== undefined && { group: checkGroup(type, dto.group) }),
      ...(dto.linkedTo !== undefined && {
        linkedTo: dto.linkedTo ? new Types.ObjectId(dto.linkedTo) : null,
      }),
      updatedBy: ctx.user.id,
    });
    await item.save({ session });
    await item.populate('linkedTo', 'name code type');
    await recordAudit(
      ctx,
      {
        action: `Updated ${MASTER_TYPES[type].label}: ${item.code}`,
        module: MODULE,
        entityId: item.id,
        changes: fieldChanges(before, snapshot(item, Object.keys(dto))),
      },
      session,
    );
    return item;
  });

// ── Excel ────────────────────────────────────────────────────────────────────

const columnsFor = (type: MasterType): ExcelColumn[] => {
  const config = MASTER_TYPES[type];
  return [
    {
      key: 'code',
      header: 'Code',
      required: true,
      note: 'Unique. Letters, digits, _ or -. Existing codes are updated.',
    },
    { key: 'name', header: 'Name', required: true, width: 40 },
    // The group column only appears for lists that have groups (e.g. "Crop group" for crops).
    ...('groups' in config
      ? [{ key: 'group', header: config.groupLabel, note: `One of: ${config.groups.join(', ')}` }]
      : []),
    { key: 'description', header: 'Description', width: 40 },
    { key: 'sortOrder', header: 'Sort order', note: 'Whole number; lower comes first.' },
    { key: 'isActive', header: 'Active', note: 'Yes or No (default Yes).' },
  ];
};

/** The import template, pre-filled with the current items so it doubles as an export. */
export const masterTemplate = async (type: MasterType): Promise<Buffer> => {
  const items = await MasterItemModel.find({ type }).sort({ sortOrder: 1, name: 1 }).lean();
  return buildWorkbook(
    MASTER_TYPES[type].label,
    columnsFor(type),
    items.map((i) => ({ ...i, isActive: i.isActive ? 'Yes' : 'No' })),
  );
};

/** Validates every row; saves only when there are no errors and dryRun is false. Upserts by code. */
export const importMasters = async (
  ctx: RequestContext,
  type: MasterType,
  buffer: Buffer,
  dryRun: boolean,
): Promise<ImportResult> => {
  const rows = await readRows(buffer, columnsFor(type));
  const { valid, errors } = validateRows(rows, masterImportRow, (r) => r.code);
  for (const { row, data } of valid) {
    try {
      checkGroup(type, data.group);
    } catch (err) {
      errors.push({ row, field: 'group', message: (err as Error).message } satisfies RowError);
    }
  }

  const existing = new Set(
    (
      await MasterItemModel.find(
        { type, code: trusted({ $in: valid.map((v) => v.data.code) }) },
        { code: 1 },
      ).lean()
    ).map((m) => m.code),
  );
  const result: ImportResult = {
    dryRun,
    total: rows.length,
    created: valid.filter((v) => !existing.has(v.data.code)).length,
    updated: valid.filter((v) => existing.has(v.data.code)).length,
    errors: errors.sort((a, b) => a.row - b.row),
  };
  if (dryRun || errors.length) return { ...result, dryRun: dryRun || errors.length > 0 };

  await withTransaction(async (session) => {
    await MasterItemModel.bulkWrite(
      valid.map(({ data }) => ({
        updateOne: {
          filter: { type, code: data.code },
          update: {
            $set: { ...data, group: data.group ?? null, updatedBy: ctx.user.id },
            $setOnInsert: { type, createdBy: ctx.user.id },
          },
          upsert: true,
        },
      })),
      { session },
    );
    await recordAudit(
      ctx,
      {
        action: `Imported ${MASTER_TYPES[type].label}: ${result.created} added, ${result.updated} updated`,
        module: MODULE,
      },
      session,
    );
  });
  return result;
};
