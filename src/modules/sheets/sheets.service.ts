import { type QueryFilter, trusted } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { type RequestContext, withScope } from '../../utils/context.js';
import { type ExcelColumn, buildMultiSheetWorkbook, readRows } from '../../utils/excel.js';
import type { RowError } from '../../utils/importer.js';
import { type CellChange, recordAudit } from '../audit/audit.service.js';
import {
  DESIGNS_WITH_ANOVA,
  DESIGNS_WITH_FACTORS,
  experimentFactors,
  experimentSeasonCodes,
  experimentYears,
  findExperiment,
  getExperiment,
  markDataLocked,
  withParameterDetails,
} from '../experiments/experiments.service.js';
import { activeMasterCodes } from '../masters/masters.service.js';
import { calculatedParameters } from '../parameters/parameters.service.js';
import {
  assertTrialActive,
  assertTrialIdActive,
  getTrial,
  listTrials,
  trialsByIds,
  withdrawnTrialIds,
} from '../trials/trials.service.js';
import { type ObsRow, calculatedIds, computeCalculated } from './sheets.calculated.js';
import { type ParameterAnalysis, analyseParameter, pooledAnalysis } from './sheets.analysis.js';
import { type FactorialKind, factorialAnalysis } from './sheets.factorial.js';
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

/** Key of a treatment × parameter pair switched off in the trial protocol. */
const disabledKey = (treatmentCode: string, parameterId: string) => `${treatmentCode}|${parameterId}`;

/**
 * The treatment × parameter pairs the trial protocol switched off for the sheet's season
 * (the trial's own list, or the experiment's when the trial has none). Those cells take no value.
 */
const disabledCellsOf = async (
  sheet: { trialId: unknown; seasonCode: string },
  experiment: { disabledParameters?: { treatment: string; season: string; parameterId: unknown }[] },
) => {
  const trial = (await trialsByIds([String(sheet.trialId)])).get(String(sheet.trialId));
  const list = trial?.disabledParameters?.length
    ? trial.disabledParameters
    : (experiment.disabledParameters ?? []);
  return new Set(
    list
      .filter((d) => d.season === sheet.seasonCode)
      .map((d) => disabledKey(d.treatment, String(d.parameterId))),
  );
};

/** The sheet with its experiment protocol (access already checked through the sheet's centre). */
const loadSheet = async (ctx: RequestContext, id: string) => {
  const sheet = await getScopedSheet(ctx, id);
  const experiment = await withParameterDetails(await findExperiment(String(sheet.experimentId)));
  const disabled = await disabledCellsOf(sheet, experiment);
  return { sheet, experiment, disabled };
};

export const listSheets = (ctx: RequestContext, query: ListSheetsQuery) => {
  const where: QueryFilter<Sheet> = {};
  for (const key of ['trialId', 'experimentId', 'centreId', 'seasonCode', 'status'] as const) {
    if (query[key]) where[key] = query[key];
  }
  if (query.year) where.year = query.year;
  return SheetModel.find(scoped(ctx, where))
    .populate('experimentId', 'code title programmeCode')
    .populate('centreId', 'code name')
    .sort({ year: -1, updatedAt: -1 })
    .limit(1000);
};

/** Stored observation → ObsRow. */
const toRow = (o: {
  treatmentCode: string;
  replication: number | null;
  parameterId: unknown;
  valueNumber: number | null;
  valueText: string | null;
}): ObsRow => ({
  treatmentCode: o.treatmentCode,
  replication: o.replication,
  parameterId: String(o.parameterId),
  value: o.valueNumber ?? o.valueText,
});

const valuesOf = async (sheetId: string) => (await ObservationModel.find({ sheetId }).lean()).map(toRow);

/**
 * Entered values plus the computed values of calculated parameters (flagged `calculated`).
 * Anything stored for a calculated parameter (e.g. typed before it got a formula) is ignored.
 */
const withCalculated = async (
  experiment: ExperimentDetail,
  entered: ObsRow[],
): Promise<(ObsRow & { calculated?: true })[]> => {
  const calcIds = calculatedIds(experiment);
  if (!calcIds.size) return entered;
  const computed = computeCalculated(experiment, entered, await calculatedParameters());
  return [
    ...entered.filter((row) => !calcIds.has(row.parameterId)),
    ...computed.map((row) => ({ ...row, calculated: true as const })),
  ];
};

export const getSheetDetail = async (ctx: RequestContext, id: string) => {
  const { sheet, experiment, disabled } = await loadSheet(ctx, id);
  return {
    ...sheet.toJSON(),
    experiment,
    // Treatment × parameter cells switched off in the trial protocol for this season: no value.
    disabledCells: [...disabled].map((k) => {
      const [treatmentCode, parameterId] = k.split('|');
      return { treatmentCode, parameterId };
    }),
    values: await withCalculated(experiment, await valuesOf(id)),
  };
};

// ── Creating ─────────────────────────────────────────────────────────────────

export const createSheet = async (ctx: RequestContext, dto: CreateSheetDto) => {
  const trial = await getTrial(ctx, dto.trialId); // scoped: a centre can only open its own trials
  assertTrialActive(trial);
  const experiment = await findExperiment(String(trial.experimentId));
  if (experiment.status !== 'Active') {
    throw AppError.conflict('EXPERIMENT_NOT_ACTIVE', 'Data can only be recorded for active experiments');
  }
  // A sheet's year is any year of the experiment (start to end); years outside it are refused,
  // and the reporting grid and trend cover only these. The financial years master isn't used.
  if (dto.year < experiment.startYear) {
    throw AppError.badRequest(
      'YEAR_BEFORE_START',
      `This experiment started in ${experiment.startYear}; data can't be recorded for ${dto.year}`,
    );
  }
  if (experiment.endYear && dto.year > experiment.endYear) {
    throw AppError.badRequest(
      'YEAR_AFTER_END',
      `This experiment ends in ${experiment.endYear}; data can't be recorded for ${dto.year}`,
    );
  }
  const seasons = experimentSeasonCodes(experiment);
  if (seasons.length && !seasons.includes(dto.seasonCode)) {
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
          year: dto.year,
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
        action: `Opened sheet ${experiment.code} ${dto.seasonCode} ${dto.year}`,
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
  disabled: Set<string>,
  cell: CellInput,
): { ok: true; valueNumber: number | null; valueText: string | null } | { ok: false; message: string } => {
  const param = params.get(cell.parameterId);
  if (!param) return { ok: false, message: 'Parameter is not part of this experiment' };
  if (param.formula) {
    return { ok: false, message: `${param.name} is calculated from other values and can't be entered` };
  }
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
  // Clearing a disabled cell is fine (a value typed before it was switched off); entering one isn't.
  if (disabled.has(disabledKey(cell.treatmentCode, cell.parameterId))) {
    return { ok: false, message: `${param.name} is disabled for ${cell.treatmentCode} in this season` };
  }

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
  await assertTrialIdActive(String(sheet.trialId));
  if (!EDITABLE_STATUSES.includes(sheet.status)) {
    throw AppError.conflict(
      'SHEET_LOCKED',
      sheet.status === 'Approved'
        ? 'This sheet is approved and locked'
        : 'This sheet is submitted; wait for it to be returned',
    );
  }
};

/** One cell of a sheet: treatment × replication × parameter. */
const cellKey = (c: { treatmentCode: string; replication: number | null; parameterId: string }) =>
  `${c.treatmentCode}|${c.replication}|${c.parameterId}`;

/**
 * Writes checked cells and records, in the same transaction, every cell whose value changed
 * (old → new), how the data came in (form or Excel) and the sheet's centre.
 */
const writeCells = async (
  ctx: RequestContext,
  sheet: { id: string; centreId: unknown; experimentId: unknown },
  experiment: ExperimentDetail,
  cells: (CellInput & { valueNumber: number | null; valueText: string | null })[],
  source: 'form' | 'excel',
) => {
  const sheetId = sheet.id;
  const codes = new Map(experiment.parameters.map((p) => [p.parameterId, p.code ?? p.parameterId]));
  return withTransaction(async (session) => {
    const existing = new Map(
      (await ObservationModel.find({ sheetId }).session(session).lean()).map((o) => [
        cellKey(toRow(o)),
        o.valueNumber ?? o.valueText ?? null,
      ]),
    );
    const changed: CellChange[] = cells
      .map((c) => ({
        treatmentCode: c.treatmentCode,
        replication: c.replication,
        parameterCode: codes.get(c.parameterId) ?? c.parameterId,
        from: existing.get(cellKey(c)) ?? null,
        to: c.valueNumber ?? c.valueText ?? null,
      }))
      .filter((c) => c.from !== c.to);
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
    const what = `${changed.length} value${changed.length === 1 ? '' : 's'} changed`;
    await recordAudit(
      ctx,
      {
        action: source === 'excel' ? `Imported Excel: ${what}` : `Saved sheet: ${what}`,
        module: MODULE,
        entityId: sheetId,
        centreId: String(sheet.centreId),
        cells: changed,
        source,
      },
      session,
    );
  }).then(() => markDataLocked(String(sheet.experimentId)));
};

export const saveValues = async (ctx: RequestContext, id: string, cells: CellInput[]) => {
  const { sheet, experiment, disabled } = await loadSheet(ctx, id);
  await assertEditable(sheet);
  const params = new Map(experiment.parameters.map((p) => [p.parameterId, p]));
  const errors: { index: number; message: string }[] = [];
  const ready: (CellInput & { valueNumber: number | null; valueText: string | null })[] = [];
  cells.forEach((cell, index) => {
    const result = checkCell(experiment, params, disabled, cell);
    if (result.ok) ready.push({ ...cell, valueNumber: result.valueNumber, valueText: result.valueText });
    else errors.push({ index, message: result.message });
  });
  if (errors.length)
    throw AppError.badRequest('INVALID_VALUES', 'Some values are not valid', { cells: errors });
  await writeCells(ctx, sheet, experiment, ready, 'form');
  return getSheetDetail(ctx, id);
};

// ── Workflow ─────────────────────────────────────────────────────────────────

/** Required parameters with no value, as "T1 R2: Grain yield" strings. */
const missingRequired = async (sheetId: string, experiment: ExperimentDetail, disabled: Set<string>) => {
  const have = new Set((await valuesOf(sheetId)).map(cellKey));
  const missing: string[] = [];
  // Calculated parameters are never entered, so they can't be missing.
  for (const p of experiment.parameters.filter((x) => x.required && !x.formula)) {
    const reps =
      p.level === 'plot' && experiment.replications
        ? Array.from({ length: experiment.replications }, (_, i) => i + 1)
        : [null];
    for (const t of experiment.treatments) {
      // A cell switched off in the trial protocol is never required.
      if (disabled.has(disabledKey(t.code, p.parameterId))) continue;
      for (const r of reps) {
        if (!have.has(cellKey({ treatmentCode: t.code, replication: r, parameterId: p.parameterId }))) {
          missing.push(`${t.code}${r ? ` R${r}` : ''}: ${p.name}`);
        }
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
  // A withdrawn centre's sheets are read-only, whatever their status.
  const existing = await getScopedSheet(ctx, id);
  await assertTrialIdActive(String(existing.trialId));
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
  const { experiment, disabled } = await loadSheet(ctx, id);
  const missing = await missingRequired(id, experiment, disabled);
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
  // Calculated parameters aren't entered, so they have no column in the template.
  const entered = experiment.parameters.filter((p) => !p.formula);
  const plotParams = entered.filter((p) => p.level === 'plot' && experiment.replications);
  const treatmentParams = entered.filter((p) => !(p.level === 'plot' && experiment.replications));
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
  // Split / split-split plot and factorial: each row also shows the treatment's level of every factor
  // (Main plot M1, Sub plot S2 … or Factor A …), the ICAR B.5 layout, with the level's name beside
  // it where the protocol names it. These columns come from the treatment: on import an empty one
  // is fine, and a filled one must match the treatment.
  const factors = experimentFactors(experiment);
  const range = (prefix: string, n: number | null) => `${prefix}1 … ${prefix}${n ?? 1}`;
  const factorColumns: ExcelColumn[] = factors.flatMap((f) => [
    {
      key: `factor${f.key}`,
      header: f.label,
      note: `${f.label} of the treatment: ${f.levels[0]?.code} … ${f.levels.at(-1)?.code}. Set by the treatment; a different value is reported.`,
    },
    ...(f.levels.some((l) => l.name)
      ? [
          {
            key: `factor${f.key}Name`,
            header: `${f.label} name`,
            width: 24,
            note: 'For reference; not read on import.',
          },
        ]
      : []),
  ]);
  return {
    factors,
    plotParams,
    treatmentParams,
    plotColumns: [
      ...factorColumns,
      { key: 'treatment', header: 'Treatment', required: true },
      {
        key: 'replication',
        header: 'Replication',
        required: true,
        note: `Replication: ${range('R', experiment.replications)}`,
      },
      ...plotParams.map(paramColumn),
    ] as ExcelColumn[],
    treatmentColumns: [
      ...factorColumns,
      { key: 'treatment', header: 'Treatment', required: true },
      ...treatmentParams.map(paramColumn),
    ] as ExcelColumn[],
  };
};

/**
 * Excel with the sheet's current values: one row per treatment × replication (with the treatment's
 * factor levels for split plot and factorial designs), plus a treatment-level tab.
 */
export const sheetTemplate = async (ctx: RequestContext, id: string) => {
  const { sheet, experiment } = await loadSheet(ctx, id);
  const values = new Map((await valuesOf(id)).map((v) => [cellKey(v), v.value]));
  const at = (t: string, r: number | null, p: string) =>
    values.get(cellKey({ treatmentCode: t, replication: r, parameterId: p })) ?? null;
  const { factors, plotParams, treatmentParams, plotColumns, treatmentColumns } = layoutFor(experiment);
  const factorCells = (t: ExperimentDetail['treatments'][number]) =>
    Object.fromEntries(
      factors.flatMap((f) => {
        const code = t[f.field];
        return [
          [`factor${f.key}`, code ?? null],
          [`factor${f.key}Name`, f.levels.find((l) => l.code === code)?.name ?? null],
        ];
      }),
    );

  const sheets = [];
  if (plotParams.length) {
    sheets.push({
      name: PLOT_SHEET,
      columns: plotColumns,
      rows: experiment.treatments.flatMap((t) =>
        Array.from({ length: experiment.replications ?? 0 }, (_, i) => ({
          ...factorCells(t),
          treatment: t.code,
          replication: `R${i + 1}`,
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
        ...factorCells(t),
        treatment: t.code,
        ...Object.fromEntries(treatmentParams.map((p) => [p.parameterId, at(t.code, null, p.parameterId)])),
      })),
    });
  }
  const buffer = await buildMultiSheetWorkbook(sheets);
  return { buffer, filename: `${experiment.code}_${sheet.year}_${sheet.seasonCode}.xlsx` };
};

/**
 * A plot or replication label from the Excel file: "M2" (any case, spaces allowed) or a plain 2
 * → 2. A label with another letter ("S2" in the Main plot column) or nothing usable → null.
 */
const fromLabel = (raw: unknown, prefix: 'M' | 'S' | 'R'): number | null => {
  const text = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  const match = new RegExp(`^${prefix}?(\\d+)$`).exec(text);
  return match ? Number(match[1]) : null;
};

/**
 * Imports a filled template. Every cell is checked; with dryRun (default) or any error nothing is
 * saved. Empty cells clear existing values, so the file is the complete picture of the sheet.
 */
export const importSheet = async (ctx: RequestContext, id: string, buffer: Buffer, dryRun: boolean) => {
  const { sheet, experiment, disabled } = await loadSheet(ctx, id);
  await assertEditable(sheet);
  const params = new Map(experiment.parameters.map((p) => [p.parameterId, p]));
  const { factors, plotParams, treatmentParams, plotColumns, treatmentColumns } = layoutFor(experiment);
  const treatmentsByCode = new Map(experiment.treatments.map((t) => [t.code, t]));

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
      const replication = replicated ? fromLabel(values.replication, 'R') : null;
      if (replicated && !replication) {
        errors.push({
          row,
          message: `${tab}: can't read Replication "${String(values.replication ?? '')}" (write R1, R2 …)`,
        });
        continue;
      }
      // Factor levels come from the treatment; a filled-in level that differs is a mistake.
      const treatment = treatmentsByCode.get(treatmentCode);
      const mismatched = treatment
        ? factors.filter((f) => {
            const given = String(values[`factor${f.key}`] ?? '')
              .trim()
              .toUpperCase();
            const own = treatment[f.field];
            return given !== '' && given !== (own ?? '').toUpperCase();
          })
        : [];
      if (mismatched.length) {
        errors.push({
          row,
          message: `${tab}: ${mismatched
            .map((f) => `${f.label} "${String(values[`factor${f.key}`])}"`)
            .join(', ')} doesn't match treatment ${treatmentCode}`,
        });
        continue;
      }
      const key = `${tab}|${treatmentCode}|${replication}`;
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
        const result = checkCell(experiment, params, disabled, cell);
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
  await writeCells(ctx, sheet, experiment, cells, 'excel');
  return result;
};

// ── Analysis ─────────────────────────────────────────────────────────────────

const FACTORIAL_KIND: Partial<Record<ExperimentDetail['design'], FactorialKind>> = {
  'Split plot': 'split',
  'Split-split plot': 'split-split',
  Factorial: 'factorial',
};

/**
 * One sheet's analysis. RBD: treatment ANOVA, CD and DMRT. Split plot, split-split plot and
 * factorial: treatments are combinations of factor levels, so plot-level parameters get the
 * design's own ANOVA (`factorial`: each factor, their interactions, the right error terms) and the
 * means of every factor level.
 */
export const analyseSheet = async (ctx: RequestContext, id: string) => {
  const { sheet, experiment } = await loadSheet(ctx, id);
  const observations = (await withCalculated(experiment, await valuesOf(id))).filter(
    (o): o is ObsRow & { value: number } => typeof o.value === 'number',
  );
  const codes = experiment.treatments.map((t) => t.code);
  const kind = FACTORIAL_KIND[experiment.design];
  const factors = experimentFactors(experiment);
  const treatmentLevels = experiment.treatments.map((t) => ({
    code: t.code,
    levels: Object.fromEntries(factors.map((f) => [f.key, t[f.field] ?? null])),
  }));
  const parameters = experiment.parameters
    .filter((p) => p.dataType === 'number')
    .map((p) => {
      const byTreatment = new Map<string, Map<number | null, number>>();
      for (const o of observations.filter((x) => x.parameterId === p.parameterId)) {
        if (!byTreatment.has(o.treatmentCode)) byTreatment.set(o.treatmentCode, new Map());
        byTreatment.get(o.treatmentCode)!.set(o.replication, o.value);
      }
      const replicated = p.level === 'plot' ? experiment.replications : null;
      const describe = {
        parameterId: p.parameterId,
        code: p.code,
        name: p.name,
        unitCode: p.unitCode,
        section: p.section,
        level: p.level,
      };
      if (kind && replicated) {
        const result = factorialAnalysis(byTreatment, treatmentLevels, factors, replicated, kind);
        return { ...describe, ...result, anova: null };
      }
      let analysis: ParameterAnalysis = analyseParameter(byTreatment, codes, replicated);
      if (replicated && !DESIGNS_WITH_ANOVA.includes(experiment.design)) {
        analysis = {
          ...analysis,
          anova: null,
          reason: `Analysis of variance for ${experiment.design.toLowerCase()} design is not available yet; treatment means only`,
        };
      }
      // The design is replicated, but this parameter is recorded once per treatment.
      if (!replicated && experiment.replications) {
        analysis = { ...analysis, reason: 'Recorded once per treatment, so there is no ANOVA; means only' };
      }
      return { ...describe, ...analysis, factorial: null };
    });

  return {
    sheetId: sheet.id,
    experiment: {
      id: experiment.id,
      code: experiment.code,
      title: experiment.title,
      design: experiment.design,
      referenceTreatmentCode: experiment.referenceTreatmentCode ?? null,
    },
    year: sheet.year,
    seasonCode: sheet.seasonCode,
    treatments: experiment.treatments,
    factors: factors.map(({ key, label, levels }) => ({ key, label, levels })),
    parameters,
  };
};

/**
 * Cross-centre consolidation for one experiment and year: treatment means per centre and
 * parameter, from approved sheets (or all, with includeUnapproved). Centre users see only theirs.
 */
export const experimentSummary = async (ctx: RequestContext, query: SummaryQuery) => {
  const experiment = await withParameterDetails(await findExperiment(query.experimentId));
  const where: QueryFilter<Sheet> = { experimentId: query.experimentId, year: query.year };
  if (query.seasonCode) where.seasonCode = query.seasonCode;
  if (!query.includeUnapproved) where.status = 'Approved';
  // Withdrawn centres' sheets stay readable one by one but don't count in the consolidation.
  const withdrawn = await withdrawnTrialIds(query.experimentId);
  if (withdrawn.size) where.trialId = trusted({ $nin: [...withdrawn] });
  const sheets = await SheetModel.find(scoped(ctx, where)).populate<{
    centreId: { _id: unknown; code: string; name: string };
  }>('centreId', 'code name');
  const stored = await ObservationModel.find({
    sheetId: trusted({ $in: sheets.map((s) => s.id) }),
  }).lean();
  // Entered and calculated numeric values, per sheet.
  const perSheet = new Map<string, (ObsRow & { value: number })[]>();
  for (const s of sheets) {
    const entered = stored.filter((o) => String(o.sheetId) === s.id).map(toRow);
    perSheet.set(
      s.id,
      (await withCalculated(experiment, entered)).filter(
        (o): o is ObsRow & { value: number } => typeof o.value === 'number',
      ),
    );
  }

  const numeric = experiment.parameters.filter((p) => p.dataType === 'number');
  const trials = await trialsByIds([...new Set(sheets.map((s) => String(s.trialId)))]);
  const systemName = (s: (typeof sheets)[number]) =>
    trials.get(String(s.trialId))?.croppingSystems.find((cs) => cs.code === s.croppingSystemCode)?.name ??
    null;
  const rows = sheets.map((s) => {
    const mine = perSheet.get(s.id) ?? [];
    const means: Record<string, Record<string, number | null>> = {};
    for (const p of numeric) {
      means[p.parameterId] = {};
      for (const t of experiment.treatments) {
        const xs = mine
          .filter((o) => o.treatmentCode === t.code && o.parameterId === p.parameterId)
          .map((o) => o.value);
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
      croppingSystemName: systemName(s),
      cropCode: s.cropCode,
      status: s.status,
      means,
    };
  });

  // Pooled analysis over locations (each sheet is one location) for per-plot parameters of RBD
  // experiments, using the sheets with complete data. Split and strip plot have several plots per
  // location, so their means (over all plots) are shown without a pooled analysis for now.
  const codes = experiment.treatments.map((t) => t.code);
  const reps = experiment.replications ?? 0;
  const pooled: Record<string, ReturnType<typeof pooledAnalysis>> = {};
  if (
    DESIGNS_WITH_ANOVA.includes(experiment.design) &&
    !DESIGNS_WITH_FACTORS.includes(experiment.design) &&
    reps >= 2
  ) {
    const centresWithSeveral = new Set(
      sheets.map((s) => String(s.centreId._id)).filter((id, i, all) => all.indexOf(id) !== i),
    );
    for (const p of numeric.filter((x) => x.level === 'plot')) {
      const locations: { label: string; grid: number[][] }[] = [];
      for (const s of sheets) {
        const cells = new Map(
          (perSheet.get(s.id) ?? [])
            .filter((o) => o.parameterId === p.parameterId)
            .map((o) => [`${o.treatmentCode}|${o.replication}`, o.value]),
        );
        const grid = codes.map((t) => Array.from({ length: reps }, (_, j) => cells.get(`${t}|${j + 1}`)));
        if (grid.every((row) => row.every((v) => v !== undefined))) {
          const label = centresWithSeveral.has(String(s.centreId._id))
            ? `${s.centreId.name} (${s.croppingSystemCode ?? s.seasonCode})`
            : s.centreId.name;
          locations.push({ label, grid: grid as number[][] });
        }
      }
      pooled[p.parameterId] = pooledAnalysis(locations, codes);
    }
  }
  return {
    experiment: {
      id: experiment.id,
      code: experiment.code,
      title: experiment.title,
      design: experiment.design,
      referenceTreatmentCode: experiment.referenceTreatmentCode ?? null,
    },
    year: query.year,
    treatments: experiment.treatments,
    parameters: numeric.map((p) => ({
      parameterId: p.parameterId,
      code: p.code,
      name: p.name,
      unitCode: p.unitCode,
      section: p.section,
      level: p.level,
    })),
    centres: rows,
    pooled,
  };
};

// ── Reporting status ─────────────────────────────────────────────────────────

/**
 * Who has reported what: for each assigned centre, every year of the experiment × each of its
 * seasons, with the sheets opened there and their status. An empty cell
 * means no sheet was opened. Centre users see only their own centre (scoped trials and sheets).
 */
export const reportingStatus = async (ctx: RequestContext, experimentId: string) => {
  const experiment = await getExperiment(ctx, experimentId);
  const [trials, sheets] = await Promise.all([
    listTrials(ctx, { experimentId }),
    SheetModel.find(scoped(ctx, { experimentId }), {
      trialId: 1,
      year: 1,
      seasonCode: 1,
      croppingSystemCode: 1,
      cropCode: 1,
      status: 1,
      updatedAt: 1,
    }).lean(),
  ]);
  const years = experimentYears(experiment);
  const byTrial = new Map<string, typeof sheets>();
  for (const s of sheets) {
    const key = String(s.trialId);
    if (!byTrial.has(key)) byTrial.set(key, []);
    byTrial.get(key)!.push(s);
  }
  // A withdrawn centre's trial keeps its data (read-only); the grid shows the active ones.
  const centres = trials
    .filter((t) => t.assignmentStatus !== 'Withdrawn')
    .map((t) => {
      const centre = t.centreId as unknown as { _id: unknown; code: string; name: string };
      return {
        trialId: t.id as string,
        centre: { id: String(centre._id), code: centre.code, name: centre.name },
        sheets: (byTrial.get(t.id as string) ?? []).map((s) => ({
          id: String(s._id),
          year: s.year,
          seasonCode: s.seasonCode,
          croppingSystemCode: s.croppingSystemCode ?? null,
          cropCode: s.cropCode ?? null,
          status: s.status,
          updatedAt: s.updatedAt,
        })),
      };
    })
    .sort((a, b) => a.centre.name.localeCompare(b.centre.name));
  return {
    experiment: { id: experiment.id as string, code: experiment.code, status: experiment.status },
    years,
    seasons: experimentSeasonCodes(experiment),
    centres,
  };
};

/** For other modules: per trial, the years with a sheet and how many sheets are approved. */
export const sheetCoverageByTrial = async (trialIds: string[]) => {
  const sheets = await SheetModel.find(
    { trialId: trusted({ $in: trialIds }) },
    { trialId: 1, year: 1, status: 1 },
  ).lean();
  const coverage = new Map<string, { years: number[]; sheets: number; approved: number }>();
  for (const s of sheets) {
    const key = String(s.trialId);
    const c = coverage.get(key) ?? { years: [], sheets: 0, approved: 0 };
    if (!c.years.includes(s.year)) c.years.push(s.year);
    c.sheets += 1;
    if (s.status === 'Approved') c.approved += 1;
    coverage.set(key, c);
  }
  for (const c of coverage.values()) c.years.sort((a, b) => a - b);
  return coverage;
};
