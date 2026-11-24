import { type ClientSession, type QueryFilter, Types, trusted } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import type { RequestContext } from '../../utils/context.js';
import { type ExcelColumn, buildWorkbook, readRows } from '../../utils/excel.js';
import { type ImportResult, type RowError, validateRows } from '../../utils/importer.js';
import { escapeRegex } from '../../utils/validators.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import { CODE_SERIES, type CodeSeries, nextCode } from '../counters/counters.service.js';
import {
  masterImportRow,
  type CreateMasterDto,
  type ListMastersQuery,
  type UpdateMasterDto,
} from './masters.dto.js';
import { type MasterItem, MasterItemModel } from './masters.model.js';
import { MASTER_TYPES, type MasterType } from './masters.types.js';

const MODULE = 'masters';

/**
 * Lists whose codes the system generates (CRP-001, UNT-001, P1 …). Their codes are never typed and
 * never change, so the records that refer to them (cropping systems, sheets, parameters' units,
 * experiment codes) stay valid. Other lists (seasons, zones …) keep the codes people give them.
 */
const GENERATED_CODES: Partial<Record<MasterType, CodeSeries>> = {
  crop: CODE_SERIES.crop,
  unit: CODE_SERIES.unit,
  programme: CODE_SERIES.programme,
};
export const generatesCodes = (type: MasterType) => Boolean(GENERATED_CODES[type]);

const codeTaken = (type: MasterType, session?: ClientSession) => async (code: string) =>
  Boolean(await MasterItemModel.exists({ type, code }).session(session ?? null));

/** Items of a list with the same name (any case), so a generated-code list has no look-alikes. */
const sameName = (type: MasterType, name: string, exceptId?: string) =>
  MasterItemModel.findOne({
    type,
    name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i'),
    ...(exceptId ? { _id: trusted({ $ne: exceptId }) } : {}),
  }).lean();

const assertNameFree = async (type: MasterType, name: string, exceptId?: string) => {
  if (!generatesCodes(type)) return;
  const other = await sameName(type, name, exceptId);
  if (other) {
    throw AppError.conflict(
      'DUPLICATE_NAME',
      `${MASTER_TYPES[type].label}: "${other.name}" already exists (${other.code})`,
    );
  }
};

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

export const createMaster = async (ctx: RequestContext, type: MasterType, dto: CreateMasterDto) => {
  const series = GENERATED_CODES[type];
  if (series && dto.code) {
    throw AppError.badRequest(
      'CODE_IS_GENERATED',
      `${MASTER_TYPES[type].label} get their code automatically (${series.format(1)} …); leave the code out`,
    );
  }
  if (!series && !dto.code) throw AppError.badRequest('CODE_REQUIRED', 'Give the item a code');
  await assertNameFree(type, dto.name);
  return withTransaction(async (session) => {
    // Generated inside the transaction: if the create fails, the counter isn't advanced.
    const code = series ? await nextCode(series, codeTaken(type, session), session) : dto.code!;
    const [item] = await MasterItemModel.create(
      [
        {
          ...dto,
          code,
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
};

export const updateMaster = async (
  ctx: RequestContext,
  type: MasterType,
  id: string,
  dto: UpdateMasterDto,
) => {
  if (dto.name !== undefined) await assertNameFree(type, dto.name, id);
  return withTransaction(async (session) => {
    const item = await MasterItemModel.findOne({ _id: id, type }).session(session);
    if (!item) throw AppError.notFound('MASTER_NOT_FOUND', `${MASTER_TYPES[type].label}: item not found`);
    if (generatesCodes(type) && dto.code !== undefined && dto.code !== item.code) {
      throw AppError.badRequest(
        'CODE_IS_GENERATED',
        `${MASTER_TYPES[type].label} codes are generated and can't be changed`,
      );
    }
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
};

// ── Excel ────────────────────────────────────────────────────────────────────

const columnsFor = (type: MasterType): ExcelColumn[] => {
  const config = MASTER_TYPES[type];
  const series = GENERATED_CODES[type];
  return [
    series
      ? {
          key: 'code',
          header: 'Code',
          note: `Leave empty for a new item: its code is generated (${series.format(1)} …). A row with an existing code updates that item.`,
        }
      : {
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

/**
 * Validates every row; saves only when there are no errors and dryRun is false. Upserts by code.
 * Crops and units: a row without a code is a new item and gets a generated code; a row with a code
 * must be an existing item.
 */
export const importMasters = async (
  ctx: RequestContext,
  type: MasterType,
  buffer: Buffer,
  dryRun: boolean,
): Promise<ImportResult> => {
  const series = GENERATED_CODES[type];
  const rows = await readRows(buffer, columnsFor(type));
  // Rows are told apart by code, or (new items of a generated list) by name.
  const { valid, errors } = validateRows(
    rows,
    masterImportRow,
    (r) => r.code ?? `new: ${r.name.toLowerCase()}`,
  );
  for (const { row, data } of valid) {
    try {
      checkGroup(type, data.group);
    } catch (err) {
      errors.push({ row, field: 'group', message: (err as Error).message } satisfies RowError);
    }
    if (!series && !data.code) errors.push({ row, field: 'code', message: 'Code is required' });
  }

  const all = await MasterItemModel.find({ type }, { code: 1, name: 1 }).lean();
  const existing = new Set(all.map((m) => m.code));
  const byName = new Map(all.map((m) => [m.name.trim().toLowerCase(), m.code]));
  if (series) {
    for (const { row, data } of valid) {
      if (data.code && !existing.has(data.code)) {
        errors.push({
          row,
          field: 'code',
          message: `No item has code ${data.code}; leave the code empty to add a new one`,
        });
      }
      const twin = byName.get(data.name.trim().toLowerCase());
      if (!data.code && twin) {
        errors.push({
          row,
          field: 'name',
          message: `"${data.name}" already exists as ${twin}; give that code to update it`,
        });
      }
    }
  }
  const isUpdate = (code: string | undefined) => Boolean(code && existing.has(code));
  const result: ImportResult = {
    dryRun,
    total: rows.length,
    created: valid.filter((v) => !isUpdate(v.data.code)).length,
    updated: valid.filter((v) => isUpdate(v.data.code)).length,
    errors: errors.sort((a, b) => a.row - b.row),
  };
  if (dryRun || errors.length) return { ...result, dryRun: dryRun || errors.length > 0 };

  await withTransaction(async (session) => {
    // New items of a generated list get their codes here, in file order.
    const ops = [];
    for (const { data } of valid) {
      const code = data.code ?? (await nextCode(series!, codeTaken(type, session), session));
      ops.push({
        updateOne: {
          filter: { type, code },
          update: {
            $set: { ...data, code, group: data.group ?? null, updatedBy: ctx.user.id },
            $setOnInsert: { type, createdBy: ctx.user.id },
          },
          upsert: true,
        },
      });
    }
    await MasterItemModel.bulkWrite(ops, { session });
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
