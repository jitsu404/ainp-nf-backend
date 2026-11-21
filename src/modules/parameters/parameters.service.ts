import { type ClientSession, type QueryFilter, trusted } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import type { RequestContext } from '../../utils/context.js';
import { type ExcelColumn, buildWorkbook, readRows } from '../../utils/excel.js';
import { type ImportResult, validateRows } from '../../utils/importer.js';
import {
  type Formula,
  type FormulaError,
  findCycle,
  formulaCodes,
  parseFormula,
} from '../../utils/formula.js';
import { escapeRegex } from '../../utils/validators.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import { CODE_SERIES, nextCode } from '../counters/counters.service.js';
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

// Codes are generated (PRM_001 …) and never change: formulas refer to parameters by code.
const codeTaken = (session?: ClientSession) => async (code: string) =>
  Boolean(await ParameterModel.exists({ code }).session(session ?? null));

/** Parameters with the same name (any case), so the library has no look-alikes. */
const assertNameFree = async (name: string, exceptId?: string) => {
  const other = await ParameterModel.findOne({
    name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i'),
    ...(exceptId ? { _id: trusted({ $ne: exceptId }) } : {}),
  }).lean();
  if (other) {
    throw AppError.conflict('DUPLICATE_NAME', `"${other.name}" is already in the library (${other.code})`);
  }
};

const assertUnit = async (unitCode: string | null | undefined) => {
  if (!unitCode) return;
  if (!(await activeMasterCodes('unit')).has(unitCode)) {
    throw AppError.badRequest('UNKNOWN_UNIT', `Unit ${unitCode} is not in the units master`);
  }
};

// ── Calculated parameters ────────────────────────────────────────────────────

const codesIn = (formula: string | null | undefined): Set<string> => {
  if (!formula) return new Set<string>();
  try {
    return formulaCodes(parseFormula(formula));
  } catch {
    return new Set<string>();
  }
};

/**
 * Why a formula can't be used, or null if it's fine. `numeric(code)` says whether a parameter
 * exists (undefined if not) and holds numbers; `usesOf(code)` gives the codes another calculated
 * parameter uses, to find loops.
 */
const formulaProblem = (
  code: string,
  formula: string,
  numeric: (code: string) => boolean | undefined,
  usesOf: (code: string) => Set<string>,
): string | null => {
  let codes: Set<string>;
  try {
    codes = formulaCodes(parseFormula(formula));
  } catch (err) {
    return (err as FormulaError).message;
  }
  if (codes.has(code)) return 'A formula cannot use its own parameter';
  for (const used of codes) {
    const isNumber = numeric(used);
    if (isNumber === undefined) return `${used} is not in the parameter library`;
    if (!isNumber) return `${used} is not a number parameter`;
  }
  const cycle = findCycle(code, (c) => (c === code ? codes : usesOf(c)));
  return cycle ? `Formulas refer to each other in a loop: ${cycle.join(' → ')}` : null;
};

const libraryIndex = async () => {
  const all = await ParameterModel.find({}, { code: 1, dataType: 1, formula: 1 }).lean();
  const byCode = new Map(all.map((p) => [p.code, p]));
  return {
    numeric: (c: string) => (byCode.has(c) ? byCode.get(c)!.dataType === 'number' : undefined),
    usesOf: (c: string) => codesIn(byCode.get(c)?.formula),
  };
};

/** Throws 400 INVALID_FORMULA when a parameter's formula can't be used. */
const assertFormula = async (code: string, formula: string | null | undefined, dataType: string) => {
  if (!formula) return;
  if (dataType !== 'number') {
    throw AppError.badRequest('INVALID_FORMULA', 'Only number parameters can be calculated');
  }
  const { numeric, usesOf } = await libraryIndex();
  const problem = formulaProblem(code, formula, numeric, usesOf);
  if (problem) throw AppError.badRequest('INVALID_FORMULA', problem, { field: 'formula' });
};

/**
 * Every calculated parameter in the library, parsed: code → { id, formula }. Other modules use it
 * to compute values (a formula may use a calculated parameter that isn't in the protocol).
 */
export const calculatedParameters = async (): Promise<Map<string, { id: string; formula: Formula }>> => {
  const items = await ParameterModel.find(
    { formula: trusted({ $nin: [null, ''] }) },
    { code: 1, formula: 1 },
  ).lean();
  const result = new Map<string, { id: string; formula: Formula }>();
  for (const p of items) {
    try {
      result.set(p.code, { id: String(p._id), formula: parseFormula(p.formula!) });
    } catch {
      // Formulas are checked when saved; skip anything unreadable rather than failing every sheet.
    }
  }
  return result;
};

/** Codes of library parameters by id, for formulas (which refer to codes). */
export const parameterCodes = async (): Promise<Map<string, string>> =>
  new Map((await ParameterModel.find({}, { code: 1 }).lean()).map((p) => [String(p._id), p.code]));

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
  await assertNameFree(dto.name);
  // A new parameter has no code yet, so its formula can't refer to itself.
  await assertFormula('', dto.formula, dto.dataType ?? 'number');
  return withTransaction(async (session) => {
    // Generated inside the transaction: if the create fails, the counter isn't advanced.
    const code = await nextCode(CODE_SERIES.parameter, codeTaken(session), session);
    const [parameter] = await ParameterModel.create(
      [{ ...dto, code, createdBy: ctx.user.id, updatedBy: ctx.user.id }],
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
  if (dto.name !== undefined) await assertNameFree(dto.name, id);
  return withTransaction(async (session) => {
    const parameter = await ParameterModel.findById(id).session(session);
    if (!parameter) throw AppError.notFound('PARAMETER_NOT_FOUND', 'Parameter not found');
    const before = snapshot(parameter, Object.keys(dto));
    parameter.set({ ...dto, updatedBy: ctx.user.id });
    if (parameter.min !== null && parameter.max !== null && parameter.min > parameter.max) {
      throw AppError.badRequest('INVALID_RANGE', 'min must not be greater than max');
    }
    // Checked against the result, since the request may change only the data type or the formula.
    await assertFormula(parameter.code, parameter.formula, parameter.dataType);
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
    note: 'Leave empty for a new parameter: its code is generated (PRM_001 …). A row with an existing code updates that parameter.',
  },
  { key: 'name', header: 'Name', required: true, width: 36 },
  { key: 'unitCode', header: 'Unit code', note: 'Code from the Units master, e.g. UNT-001.' },
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
  {
    key: 'formula',
    header: 'Formula',
    width: 40,
    note: 'Only for calculated parameters: codes of other parameters, e.g. PRM_012 / PRM_013. Leave empty for entered ones.',
  },
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
  // Rows are told apart by code, or (new parameters) by name.
  const { valid, errors } = validateRows(
    rows,
    parameterImportRow,
    (r) => r.code ?? `new: ${r.name.toLowerCase()}`,
  );
  const all = await ParameterModel.find({}, { code: 1, name: 1 }).lean();
  const existingCodes = new Set(all.map((p) => p.code));
  const byName = new Map(all.map((p) => [p.name.trim().toLowerCase(), p.code]));
  for (const { row, data } of valid) {
    if (data.code && !existingCodes.has(data.code)) {
      errors.push({
        row,
        field: 'code',
        message: `No parameter has code ${data.code}; leave the code empty to add a new one`,
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
  const units = await activeMasterCodes('unit');
  for (const { row, data } of valid) {
    if (data.unitCode && !units.has(data.unitCode)) {
      errors.push({ row, field: 'unitCode', message: `Unit ${data.unitCode} is not in the units master` });
    }
    if (data.dataType === 'choice' && !data.choices?.length) {
      errors.push({ row, field: 'choices', message: 'A choice parameter needs at least one choice' });
    }
  }
  // A formula may refer to parameters in the library or to other rows of the file that have a code
  // (a new row has no code until it is saved, so nothing can refer to it yet).
  const library = await libraryIndex();
  const inFile = new Map(valid.filter(({ data }) => data.code).map(({ data }) => [data.code!, data]));
  const numeric = (c: string) =>
    inFile.has(c) ? (inFile.get(c)!.dataType ?? 'number') === 'number' : library.numeric(c);
  const usesOf = (c: string) => (inFile.has(c) ? codesIn(inFile.get(c)!.formula) : library.usesOf(c));
  for (const { row, data } of valid) {
    if (!data.formula) continue;
    const problem =
      (data.dataType ?? 'number') !== 'number'
        ? 'Only number parameters can be calculated'
        : formulaProblem(data.code ?? '', data.formula, numeric, usesOf);
    if (problem) errors.push({ row, field: 'formula', message: problem });
  }
  const isUpdate = (code: string | undefined) => Boolean(code && existingCodes.has(code));
  const result: ImportResult = {
    dryRun: dryRun || errors.length > 0,
    total: rows.length,
    created: valid.filter((v) => !isUpdate(v.data.code)).length,
    updated: valid.filter((v) => isUpdate(v.data.code)).length,
    errors: errors.sort((a, b) => a.row - b.row),
  };
  if (result.dryRun) return result;

  await withTransaction(async (session) => {
    // New parameters get their codes here, in file order.
    const ops = [];
    for (const { data } of valid) {
      const code = data.code ?? (await nextCode(CODE_SERIES.parameter, codeTaken(session), session));
      ops.push({
        updateOne: {
          filter: { code },
          update: {
            $set: {
              ...data,
              code,
              unitCode: data.unitCode ?? null,
              formula: data.formula ?? null,
              updatedBy: ctx.user.id,
            },
            $setOnInsert: { createdBy: ctx.user.id },
          },
          upsert: true,
        },
      });
    }
    await ParameterModel.bulkWrite(ops, { session });
    await recordAudit(
      ctx,
      { action: `Imported parameters: ${result.created} added, ${result.updated} updated`, module: MODULE },
      session,
    );
  });
  return result;
};
