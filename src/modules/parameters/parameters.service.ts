import { type QueryFilter, trusted } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import type { RequestContext } from '../../utils/context.js';
import { type ExcelColumn, buildWorkbook, readRows } from '../../utils/excel.js';
import { type ImportResult, validateRows } from '../../utils/importer.js';
import { escapeRegex } from '../../utils/validators.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import { activeMasterCodes } from '../masters/masters.service.js';
import {
  type CreateParameterDto,
  type ListParametersQuery,
  type UpdateParameterDto,
  parameterImportRow,
} from './parameters.dto.js';
import {
  PARAMETER_CATEGORIES,
  PARAMETER_DATA_TYPES,
  type Parameter,
  ParameterModel,
} from './parameters.model.js';

const MODULE = 'parameters';

const assertUnit = async (unitCode: string | null | undefined) => {
  if (!unitCode) return;
  if (!(await activeMasterCodes('unit')).has(unitCode)) {
    throw AppError.badRequest('UNKNOWN_UNIT', `Unit ${unitCode} is not in the units master`);
  }
};

export const listParameters = (query: ListParametersQuery) => {
  const filter: QueryFilter<Parameter> = {};
  if (query.category) filter.category = query.category;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ code: pattern }, { name: pattern }];
  }
  return ParameterModel.find(filter).sort({ category: 1, name: 1 }).limit(2000);
};

/** For other modules: the parameters with these ids (active or not), keyed by id. */
export const parametersByIds = async (ids: string[]) =>
  new Map((await ParameterModel.find({ _id: trusted({ $in: ids }) })).map((p) => [p.id as string, p]));

export const createParameter = async (ctx: RequestContext, dto: CreateParameterDto) => {
  await assertUnit(dto.unitCode);
  return withTransaction(async (session) => {
    const [parameter] = await ParameterModel.create(
      [{ ...dto, createdBy: ctx.user.id, updatedBy: ctx.user.id }],
      {
        session,
      },
    );
    if (!parameter) throw new Error('Parameter was not created');
    await recordAudit(
      ctx,
      { action: `Added parameter ${parameter.code}`, module: MODULE, entityId: parameter.id },
      session,
    );
    return parameter;
  });
};

export const updateParameter = async (ctx: RequestContext, id: string, dto: UpdateParameterDto) => {
  await assertUnit(dto.unitCode);
  return withTransaction(async (session) => {
    const parameter = await ParameterModel.findById(id).session(session);
    if (!parameter) throw AppError.notFound('PARAMETER_NOT_FOUND', 'Parameter not found');
    const before = snapshot(parameter, Object.keys(dto));
    parameter.set({ ...dto, updatedBy: ctx.user.id });
    if (parameter.min !== null && parameter.max !== null && parameter.min > parameter.max) {
      throw AppError.badRequest('INVALID_RANGE', 'min must not be greater than max');
    }
    await parameter.save({ session });
    await recordAudit(
      ctx,
      {
        action: `Updated parameter ${parameter.code}`,
        module: MODULE,
        entityId: parameter.id,
        changes: fieldChanges(before, snapshot(parameter, Object.keys(dto))),
      },
      session,
    );
    return parameter;
  });
};

// ── Excel ────────────────────────────────────────────────────────────────────

const COLUMNS: ExcelColumn[] = [
  {
    key: 'code',
    header: 'Code',
    required: true,
    note: 'Unique. Letters, digits or _. Existing codes are updated.',
  },
  { key: 'name', header: 'Name', required: true, width: 36 },
  { key: 'unitCode', header: 'Unit code', note: 'Code from the Units master, e.g. KG_HA, PCT, NO_M2.' },
  { key: 'category', header: 'Category', required: true, note: `One of: ${PARAMETER_CATEGORIES.join(', ')}` },
  {
    key: 'dataType',
    header: 'Data type',
    note: `One of: ${PARAMETER_DATA_TYPES.join(', ')} (default number)`,
  },
  { key: 'decimals', header: 'Decimals', note: '0–6 (default 2)' },
  { key: 'min', header: 'Min' },
  { key: 'max', header: 'Max' },
  { key: 'choices', header: 'Choices', note: 'For choice parameters: values separated by |', width: 30 },
  { key: 'method', header: 'Method', width: 50 },
  { key: 'isActive', header: 'Active', note: 'Yes or No (default Yes).' },
];

export const parameterTemplate = async (): Promise<Buffer> => {
  const items = await ParameterModel.find().sort({ category: 1, name: 1 }).lean();
  return buildWorkbook(
    'Parameters',
    COLUMNS,
    items.map((p) => ({ ...p, choices: p.choices.join(' | '), isActive: p.isActive ? 'Yes' : 'No' })),
  );
};

export const importParameters = async (
  ctx: RequestContext,
  buffer: Buffer,
  dryRun: boolean,
): Promise<ImportResult> => {
  const rows = await readRows(buffer, COLUMNS);
  const { valid, errors } = validateRows(rows, parameterImportRow, (r) => r.code);
  const units = await activeMasterCodes('unit');
  for (const { row, data } of valid) {
    if (data.unitCode && !units.has(data.unitCode)) {
      errors.push({ row, field: 'unitCode', message: `Unit ${data.unitCode} is not in the units master` });
    }
    if (data.dataType === 'choice' && !data.choices?.length) {
      errors.push({ row, field: 'choices', message: 'A choice parameter needs at least one choice' });
    }
  }
  const existing = new Set(
    (
      await ParameterModel.find({ code: trusted({ $in: valid.map((v) => v.data.code) }) }, { code: 1 }).lean()
    ).map((p) => p.code),
  );
  const result: ImportResult = {
    dryRun: dryRun || errors.length > 0,
    total: rows.length,
    created: valid.filter((v) => !existing.has(v.data.code)).length,
    updated: valid.filter((v) => existing.has(v.data.code)).length,
    errors: errors.sort((a, b) => a.row - b.row),
  };
  if (result.dryRun) return result;

  await withTransaction(async (session) => {
    await ParameterModel.bulkWrite(
      valid.map(({ data }) => ({
        updateOne: {
          filter: { code: data.code },
          update: {
            $set: { ...data, unitCode: data.unitCode ?? null, updatedBy: ctx.user.id },
            $setOnInsert: { createdBy: ctx.user.id },
          },
          upsert: true,
        },
      })),
      { session },
    );
    await recordAudit(
      ctx,
      { action: `Imported parameters: ${result.created} added, ${result.updated} updated`, module: MODULE },
      session,
    );
  });
  return result;
};
