import { type QueryFilter, trusted } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { type RequestContext, withScope } from '../../utils/context.js';
import { type ExcelColumn, buildMultiSheetWorkbook, readRows } from '../../utils/excel.js';
import type { RowError } from '../../utils/importer.js';
import { recordAudit } from '../audit/audit.service.js';
import { findExperiment, markDataLocked, withParameterDetails } from '../experiments/experiments.service.js';
import { assertYearOpen } from '../financialYears/financialYears.service.js';
import { activeMasterCodes } from '../masters/masters.service.js';
import { getTrial } from '../trials/trials.service.js';
import { type ParameterAnalysis, analyseParameter } from './sheets.analysis.js';
import type { CellInput, CreateSheetDto, ListSheetsQuery, SummaryQuery } from './sheets.dto.js';
import {
  EDITABLE_STATUSES,
  ObservationModel,
  type Sheet,
  SheetModel,
  type SheetStatus,
} from './sheets.model.js';

const MODULE = 'sheets';

type ExperimentDetail = Awaited<ReturnType<typeof withParameterDetails>>;
type ParamDetail = ExperimentDetail['parameters'][number];

const scoped = (ctx: RequestContext, filter: QueryFilter<Sheet>) => withScope(ctx.user, filter);

// ── Loading ──────────────────────────────────────────────────────────────────

const getScopedSheet = async (ctx: RequestContext, id: string) => {
  const sheet = await SheetModel.findOne(scoped(ctx, { _id: id }));
  if (!sheet) throw AppError.notFound('SHEET_NOT_FOUND', 'Observation sheet not found');
  return sheet;
};

/** The sheet with its experiment protocol (access already checked through the sheet's centre). */
const loadSheet = async (ctx: RequestContext, id: string) => {
  const sheet = await getScopedSheet(ctx, id);
  const experiment = await withParameterDetails(await findExperiment(String(sheet.experimentId)));
  return { sheet, experiment };
};

export const listSheets = (ctx: RequestContext, query: ListSheetsQuery) => {
  const where: QueryFilter<Sheet> = {};
  for (const key of ['trialId', 'experimentId', 'centreId', 'fyCode', 'seasonCode', 'status'] as const) {
    if (query[key]) where[key] = query[key];
  }
  return SheetModel.find(scoped(ctx, where))
    .populate('experimentId', 'code title programmeCode')
    .populate('centreId', 'code name')
    .sort({ fyCode: -1, updatedAt: -1 })
    .limit(1000);
};

const valuesOf = async (sheetId: string) =>
  (await ObservationModel.find({ sheetId }).lean()).map((o) => ({
    treatmentCode: o.treatmentCode,
    replication: o.replication,
    parameterId: String(o.parameterId),
    value: o.valueNumber ?? o.valueText,
  }));

export const getSheetDetail = async (ctx: RequestContext, id: string) => {
  const { sheet, experiment } = await loadSheet(ctx, id);
  return { ...sheet.toJSON(), experiment, values: await valuesOf(id) };
};

// ── Creating ─────────────────────────────────────────────────────────────────

export const createSheet = async (ctx: RequestContext, dto: CreateSheetDto) => {
  const trial = await getTrial(ctx, dto.trialId); // scoped: a centre can only open its own trials
  const experiment = await findExperiment(String(trial.experimentId));
  if (experiment.status !== 'Active') {
    throw AppError.conflict('EXPERIMENT_NOT_ACTIVE', 'Data can only be recorded for active experiments');
  }
  await assertYearOpen(dto.fyCode);
  if (experiment.seasons.length && !experiment.seasons.includes(dto.seasonCode)) {
    throw AppError.badRequest(
      'SEASON_NOT_IN_PROTOCOL',
      `${dto.seasonCode} is not a season of this experiment`,
    );
  }
  if (dto.croppingSystemCode && !trial.croppingSystems.some((cs) => cs.code === dto.croppingSystemCode)) {
    throw AppError.badRequest(
      'UNKNOWN_CROPPING_SYSTEM',
      `Cropping system ${dto.croppingSystemCode} is not set up for this trial`,
    );
  }
  if (dto.cropCode && !(await activeMasterCodes('crop')).has(dto.cropCode)) {
    throw AppError.badRequest('UNKNOWN_CROP', `Crop ${dto.cropCode} is not in the crops master`);
  }
  return withTransaction(async (session) => {
    const [sheet] = await SheetModel.create(
      [
        {
          trialId: trial.id,
          experimentId: experiment.id,
          centreId: trial.centreId,
          fyCode: dto.fyCode,
          seasonCode: dto.seasonCode,
          croppingSystemCode: dto.croppingSystemCode ?? null,
          cropCode: dto.cropCode ?? null,
          history: [{ status: 'Draft', at: new Date(), byUserId: ctx.user.id, byName: ctx.user.name }],
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        },
      ],
      { session },
    );
    if (!sheet) throw new Error('Sheet was not created');
    await recordAudit(
      ctx,
      {
        action: `Opened sheet ${experiment.code} ${dto.fyCode} ${dto.seasonCode}`,
        module: MODULE,
        entityId: sheet.id,
        centreId: String(trial.centreId),
      },
      session,
    );
    return sheet;
  });
};

// ── Values ───────────────────────────────────────────────────────────────────

/** Checks one cell against the protocol and the parameter library. Returns the stored form or an error. */
const checkCell = (
  experiment: ExperimentDetail,
  params: Map<string, ParamDetail>,
  cell: CellInput,
): { ok: true; valueNumber: number | null; valueText: string | null } | { ok: false; message: string } => {
  const param = params.get(cell.parameterId);
  if (!param) return { ok: false, message: 'Parameter is not part of this experiment' };
  if (!experiment.treatments.some((t) => t.code === cell.treatmentCode)) {
    return { ok: false, message: `Unknown treatment ${cell.treatmentCode}` };
  }
  const replicated = param.level === 'plot' && experiment.replications;
  if (replicated) {
    if (!cell.replication || cell.replication > experiment.replications!) {
      return { ok: false, message: `Replication must be 1–${experiment.replications} for ${param.name}` };
    }
  } else if (cell.replication !== null) {
    return { ok: false, message: `${param.name} is recorded once per treatment (no replication)` };
  }
  if (cell.value === null || cell.value === '') return { ok: true, valueNumber: null, valueText: null };

  switch (param.dataType) {
    case 'number': {
      const n = typeof cell.value === 'number' ? cell.value : Number(String(cell.value).trim());
      if (!Number.isFinite(n)) return { ok: false, message: `${param.name} must be a number` };
      if (param.min !== null && n < param.min)
        return { ok: false, message: `${param.name} must be ≥ ${param.min}` };
      if (param.max !== null && n > param.max)
        return { ok: false, message: `${param.name} must be ≤ ${param.max}` };
      return { ok: true, valueNumber: n, valueText: null };
    }
    case 'choice': {
      const s = String(cell.value).trim();
      if (!param.choices.includes(s))
        return { ok: false, message: `${param.name} must be one of: ${param.choices.join(', ')}` };
      return { ok: true, valueNumber: null, valueText: s };
    }
    case 'date': {
      const d = new Date(String(cell.value));
      if (Number.isNaN(d.getTime())) return { ok: false, message: `${param.name} must be a date` };
      return { ok: true, valueNumber: null, valueText: d.toISOString().slice(0, 10) };
    }
    default:
      return { ok: true, valueNumber: null, valueText: String(cell.value).trim().slice(0, 2000) };
  }
};

const assertEditable = async (sheet: Sheet) => {
  if (!EDITABLE_STATUSES.includes(sheet.status)) {
    throw AppError.conflict(
      'SHEET_LOCKED',
      sheet.status === 'Approved'
        ? 'This sheet is approved and locked'
        : 'This sheet is submitted; wait for it to be returned',
    );
  }
  await assertYearOpen(sheet.fyCode);
};

/** Applies validated cells: values are upserted; null clears the cell. */
const writeCells = async (
  ctx: RequestContext,
  sheetId: string,
  experimentId: string,
  cells: (CellInput & { valueNumber: number | null; valueText: string | null })[],
) =>
  withTransaction(async (session) => {
    const ops = cells.map((c) => {
      const filter = {
        sheetId,
        treatmentCode: c.treatmentCode,
        replication: c.replication,
        parameterId: c.parameterId,
      };
      return c.valueNumber === null && c.valueText === null
        ? { deleteOne: { filter } }
        : {
            updateOne: {
              filter,
              update: {
                $set: { valueNumber: c.valueNumber, valueText: c.valueText, updatedBy: ctx.user.id },
              },
              upsert: true,
            },
          };
    });
    if (ops.length) await ObservationModel.bulkWrite(ops, { session });
    await SheetModel.updateOne({ _id: sheetId }, { updatedBy: ctx.user.id }, { session });
    await recordAudit(
      ctx,
      { action: `Saved ${cells.length} value(s)`, module: MODULE, entityId: sheetId },
      session,
    );
  }).then(() => markDataLocked(experimentId));

export const saveValues = async (ctx: RequestContext, id: string, cells: CellInput[]) => {
  const { sheet, experiment } = await loadSheet(ctx, id);
  await assertEditable(sheet);
  const params = new Map(experiment.parameters.map((p) => [p.parameterId, p]));
  const errors: { index: number; message: string }[] = [];
  const ready: (CellInput & { valueNumber: number | null; valueText: string | null })[] = [];
  cells.forEach((cell, index) => {
    const result = checkCell(experiment, params, cell);
    if (result.ok) ready.push({ ...cell, valueNumber: result.valueNumber, valueText: result.valueText });
    else errors.push({ index, message: result.message });
  });
  if (errors.length)
    throw AppError.badRequest('INVALID_VALUES', 'Some values are not valid', { cells: errors });
  await writeCells(ctx, id, String(sheet.experimentId), ready);
  return getSheetDetail(ctx, id);
};

// ── Workflow ─────────────────────────────────────────────────────────────────

/** Required parameters with no value, as "T1 R2: Grain yield" strings. */
const missingRequired = async (sheetId: string, experiment: ExperimentDetail) => {
  const have = new Set(
    (
      await ObservationModel.find({ sheetId }, { treatmentCode: 1, replication: 1, parameterId: 1 }).lean()
    ).map((o) => `${o.treatmentCode}|${o.replication}|${String(o.parameterId)}`),
  );
  const missing: string[] = [];
  for (const p of experiment.parameters.filter((x) => x.required)) {
    const reps =
      p.level === 'plot' && experiment.replications
        ? Array.from({ length: experiment.replications }, (_, i) => i + 1)
        : [null];
    for (const t of experiment.treatments) {
      for (const r of reps) {
        if (!have.has(`${t.code}|${r}|${p.parameterId}`))
          missing.push(`${t.code}${r ? ` R${r}` : ''}: ${p.name}`);
      }
    }
  }
  return missing;
};

const transition = async (
  ctx: RequestContext,
  id: string,
  from: SheetStatus[],
  to: SheetStatus,
  remark: string | undefined,
  verb: string,
) => {
  // Conditional update: if two people act at once, only the first succeeds.
  const sheet = await SheetModel.findOneAndUpdate(
    scoped(ctx, { _id: id, status: trusted({ $in: from }) }),
    {
      status: to,
      updatedBy: ctx.user.id,
      $push: {
        history: {
          status: to,
          at: new Date(),
          byUserId: ctx.user.id,
          byName: ctx.user.name,
          remark: remark ?? null,
        },
      },
    },
    { returnDocument: 'after' },
  );
  if (!sheet) {
    const current = await getScopedSheet(ctx, id);
    throw AppError.conflict('INVALID_TRANSITION', `Can't ${verb} a sheet that is ${current.status}`);
  }
  await recordAudit(ctx, {
    action: `${verb[0]!.toUpperCase()}${verb.slice(1)} sheet${remark ? `: ${remark}` : ''}`,
    module: MODULE,
    entityId: sheet.id,
    centreId: String(sheet.centreId),
  });
  return sheet;
};

export const submitSheet = async (ctx: RequestContext, id: string, remark?: string) => {
  const { sheet, experiment } = await loadSheet(ctx, id);
  await assertYearOpen(sheet.fyCode);
  const missing = await missingRequired(id, experiment);
  if (missing.length) {
    throw AppError.badRequest('INCOMPLETE_SHEET', `${missing.length} required value(s) are missing`, {
      missing: missing.slice(0, 200),
    });
  }
  await transition(ctx, id, ['Draft', 'Returned'], 'Submitted', remark, 'submit');
  return getSheetDetail(ctx, id);
};

export const returnSheet = async (ctx: RequestContext, id: string, remark: string) => {
  await transition(ctx, id, ['Submitted'], 'Returned', remark, 'return');
  return getSheetDetail(ctx, id);
};

export const approveSheet = async (ctx: RequestContext, id: string, remark?: string) => {
  await transition(ctx, id, ['Submitted'], 'Approved', remark, 'approve');
  return getSheetDetail(ctx, id);
};

// ── Excel ────────────────────────────────────────────────────────────────────

const PLOT_SHEET = 'Plot data';
const TREATMENT_SHEET = 'Treatment data';

const paramHeader = (p: ParamDetail) => `${p.name}${p.unitCode ? ` (${p.unitCode})` : ''} [${p.code}]`;

const layoutFor = (experiment: ExperimentDetail) => {
  const plotParams = experiment.parameters.filter((p) => p.level === 'plot' && experiment.replications);
  const treatmentParams = experiment.parameters.filter(
    (p) => !(p.level === 'plot' && experiment.replications),
  );
  const paramColumn = (p: ParamDetail): ExcelColumn => ({
    key: p.parameterId,
    header: paramHeader(p),
    width: 22,
    note: [
      p.required ? 'Required before submitting.' : null,
      p.dataType === 'choice' ? `One of: ${p.choices.join(', ')}` : null,
      p.min !== null || p.max !== null ? `Range ${p.min ?? '…'} – ${p.max ?? '…'}` : null,
    ]
      .filter(Boolean)
      .join(' '),
  });
  return {
    plotParams,
    treatmentParams,
    plotColumns: [
      { key: 'treatment', header: 'Treatment', required: true },
      { key: 'replication', header: 'Replication', required: true },
      ...plotParams.map(paramColumn),
    ] as ExcelColumn[],
    treatmentColumns: [
      { key: 'treatment', header: 'Treatment', required: true },
      ...treatmentParams.map(paramColumn),
    ] as ExcelColumn[],
  };
};

/** Excel with the sheet's current values: one row per treatment × replication (plus a treatment-level tab). */
export const sheetTemplate = async (ctx: RequestContext, id: string) => {
  const { sheet, experiment } = await loadSheet(ctx, id);
  const values = await valuesOf(id);
  const at = (t: string, r: number | null, p: string) =>
    values.find((v) => v.treatmentCode === t && v.replication === r && v.parameterId === p)?.value ?? null;
  const { plotParams, treatmentParams, plotColumns, treatmentColumns } = layoutFor(experiment);

  const sheets = [];
  if (plotParams.length) {
    sheets.push({
      name: PLOT_SHEET,
      columns: plotColumns,
      rows: experiment.treatments.flatMap((t) =>
        Array.from({ length: experiment.replications ?? 0 }, (_, i) => ({
          treatment: t.code,
          replication: i + 1,
          ...Object.fromEntries(plotParams.map((p) => [p.parameterId, at(t.code, i + 1, p.parameterId)])),
        })),
      ),
    });
  }
  if (treatmentParams.length || !plotParams.length) {
    sheets.push({
      name: TREATMENT_SHEET,
      columns: treatmentColumns,
      rows: experiment.treatments.map((t) => ({
        treatment: t.code,
        ...Object.fromEntries(treatmentParams.map((p) => [p.parameterId, at(t.code, null, p.parameterId)])),
      })),
    });
  }
  const buffer = await buildMultiSheetWorkbook(sheets);
  return { buffer, filename: `${experiment.code}_${sheet.fyCode}_${sheet.seasonCode}.xlsx` };
};

/**
 * Imports a filled template. Every cell is checked; with dryRun (default) or any error nothing is
 * saved. Empty cells clear existing values, so the file is the complete picture of the sheet.
 */
export const importSheet = async (ctx: RequestContext, id: string, buffer: Buffer, dryRun: boolean) => {
  const { sheet, experiment } = await loadSheet(ctx, id);
  await assertEditable(sheet);
  const params = new Map(experiment.parameters.map((p) => [p.parameterId, p]));
  const { plotParams, treatmentParams, plotColumns, treatmentColumns } = layoutFor(experiment);

  const errors: RowError[] = [];
  const cells: (CellInput & { valueNumber: number | null; valueText: string | null })[] = [];
  const seen = new Set<string>();

  const readTab = async (
    tab: string,
    columns: ExcelColumn[],
    tabParams: ParamDetail[],
    replicated: boolean,
  ) => {
    if (!tabParams.length) return;
    const rows = await readRows(buffer, columns, { sheetName: tab, optional: true });
    for (const { row, values } of rows) {
      const treatmentCode = String(values.treatment ?? '')
        .trim()
        .toUpperCase();
      const replication = replicated ? Number(values.replication) : null;
      const key = `${treatmentCode}|${replication}`;
      if (seen.has(key)) {
        errors.push({
          row,
          message: `${tab}: duplicate row for ${treatmentCode}${replication ? ` R${replication}` : ''}`,
        });
        continue;
      }
      seen.add(key);
      for (const p of tabParams) {
        const raw = values[p.parameterId] ?? null;
        const cell: CellInput = {
          treatmentCode,
          replication,
          parameterId: p.parameterId,
          value: raw instanceof Date ? raw.toISOString().slice(0, 10) : (raw as number | string | null),
        };
        const result = checkCell(experiment, params, cell);
        if (result.ok) cells.push({ ...cell, valueNumber: result.valueNumber, valueText: result.valueText });
        else errors.push({ row, field: p.code, message: `${tab}: ${result.message}` });
      }
    }
  };
  await readTab(PLOT_SHEET, plotColumns, plotParams, true);
  await readTab(TREATMENT_SHEET, treatmentColumns, treatmentParams, false);

  const filled = cells.filter((c) => c.valueNumber !== null || c.valueText !== null).length;
  const result = {
    dryRun: dryRun || errors.length > 0,
    total: cells.length,
    filled,
    cleared: cells.length - filled,
    errors,
  };
  if (result.dryRun) return result;
  await writeCells(ctx, id, String(sheet.experimentId), cells);
  return result;
};

// ── Analysis ─────────────────────────────────────────────────────────────────

export const analyseSheet = async (ctx: RequestContext, id: string) => {
  const { sheet, experiment } = await loadSheet(ctx, id);
  const observations = await ObservationModel.find({
    sheetId: id,
    valueNumber: trusted({ $ne: null }),
  }).lean();
  const codes = experiment.treatments.map((t) => t.code);
  const parameters = experiment.parameters
    .filter((p) => p.dataType === 'number')
    .map((p) => {
      const byTreatment = new Map<string, Map<number | null, number>>();
      for (const o of observations.filter((x) => String(x.parameterId) === p.parameterId)) {
        if (!byTreatment.has(o.treatmentCode)) byTreatment.set(o.treatmentCode, new Map());
        byTreatment.get(o.treatmentCode)!.set(o.replication, o.valueNumber!);
      }
      const replicated = p.level === 'plot' ? experiment.replications : null;
      const analysis: ParameterAnalysis = analyseParameter(byTreatment, codes, replicated);
      return {
        parameterId: p.parameterId,
        code: p.code,
        name: p.name,
        unitCode: p.unitCode,
        section: p.section,
        level: p.level,
        ...analysis,
      };
    });
  return {
    sheetId: sheet.id,
    experiment: {
      id: experiment.id,
      code: experiment.code,
      title: experiment.title,
      design: experiment.design,
    },
    fyCode: sheet.fyCode,
    seasonCode: sheet.seasonCode,
    treatments: experiment.treatments,
    parameters,
  };
};

/**
 * Cross-centre consolidation for one experiment and year: treatment means per centre and
 * parameter, from approved sheets (or all, with includeUnapproved). Centre users see only theirs.
 */
export const experimentSummary = async (ctx: RequestContext, query: SummaryQuery) => {
  const experiment = await withParameterDetails(await findExperiment(query.experimentId));
  const where: QueryFilter<Sheet> = { experimentId: query.experimentId, fyCode: query.fyCode };
  if (query.seasonCode) where.seasonCode = query.seasonCode;
  if (!query.includeUnapproved) where.status = 'Approved';
  const sheets = await SheetModel.find(scoped(ctx, where)).populate<{
    centreId: { _id: unknown; code: string; name: string };
  }>('centreId', 'code name');
  const observations = await ObservationModel.find({
    sheetId: trusted({ $in: sheets.map((s) => s.id) }),
    valueNumber: trusted({ $ne: null }),
  }).lean();

  const numeric = experiment.parameters.filter((p) => p.dataType === 'number');
  const rows = sheets.map((s) => {
    const mine = observations.filter((o) => String(o.sheetId) === s.id);
    const means: Record<string, Record<string, number | null>> = {};
    for (const p of numeric) {
      means[p.parameterId] = {};
      for (const t of experiment.treatments) {
        const xs = mine
          .filter((o) => o.treatmentCode === t.code && String(o.parameterId) === p.parameterId)
          .map((o) => o.valueNumber!);
        means[p.parameterId]![t.code] = xs.length
          ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000
          : null;
      }
    }
    return {
      sheetId: s.id,
      centre: { id: String(s.centreId._id), code: s.centreId.code, name: s.centreId.name },
      seasonCode: s.seasonCode,
      croppingSystemCode: s.croppingSystemCode,
      cropCode: s.cropCode,
      status: s.status,
      means,
    };
  });
  return {
    experiment: { id: experiment.id, code: experiment.code, title: experiment.title },
    fyCode: query.fyCode,
    treatments: experiment.treatments,
    parameters: numeric.map((p) => ({
      parameterId: p.parameterId,
      code: p.code,
      name: p.name,
      unitCode: p.unitCode,
      section: p.section,
    })),
    centres: rows,
  };
};
