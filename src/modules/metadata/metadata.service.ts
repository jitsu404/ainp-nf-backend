import { type QueryFilter, trusted } from 'mongoose';
import { hasCapability } from '../../config/constants.js';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { type RequestContext, isCentreScoped, isNational, withScope } from '../../utils/context.js';
import { buildWorkbook } from '../../utils/excel.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import { centresByIds } from '../centres/centres.service.js';
import {
  experimentSeasonCodes,
  getExperiment,
  updateExperimentMetadata,
  withParameterDetails,
} from '../experiments/experiments.service.js';
import { masterNames } from '../masters/masters.service.js';
import { sheetCoverageByTrial } from '../sheets/sheets.service.js';
import {
  assertTrialActive,
  assertTrialIdActive,
  getTrial,
  trialsByIds,
  trialsOfExperiment,
} from '../trials/trials.service.js';
import { activePisForCentres, contactEmailOf } from '../users/users.service.js';
import type { SaveCommonMetadataDto, SaveTrialMetadataDto } from './metadata.dto.js';
import {
  ALL_TRIAL_FIELD_KEYS,
  CENTRE_FIELD_KEYS,
  COMMON_DEFAULTS,
  type FieldDef,
  METADATA_FIELDS,
} from './metadata.fields.js';
import {
  EDITABLE_METADATA_STATUSES,
  type MetadataStatus,
  type TrialMetadata,
  TrialMetadataModel,
} from './metadata.model.js';

const MODULE = 'metadata';

type ExperimentDoc = Awaited<ReturnType<typeof getExperiment>>;
type TrialDoc = NonNullable<Awaited<ReturnType<typeof getTrial>>>;
type RecordDoc = Awaited<ReturnType<typeof TrialMetadataModel.findOne>>;
type Value =
  string | number | string[] | { name: string; designation: string | null; email: string | null }[] | null;

export interface MergedField extends FieldDef {
  value: Value;
  /** The value as text, for read-only views and the export. */
  display: string;
  defaultValue?: Value;
  defaultDisplay?: string;
  isCustomized?: boolean;
}

const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const joined = (xs: (string | null | undefined)[]) => xs.filter(Boolean).join(', ');

const displayOf = (value: Value): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : joined([v.name, v.designation, v.email])))
      .join(typeof value[0] === 'string' ? ', ' : '; ');
  }
  return String(value);
};

// ── Common fields (experiment, PCU) ─────────────────────────────────────────

/** Stored common values with defaults for the ones the PCU hasn't set. */
const commonValues = (experiment: ExperimentDoc): Record<string, Value> => {
  const stored = (experiment.metadata ?? {}) as unknown as Record<string, Value | undefined>;
  const ongoing = experiment.status !== 'Closed';
  const defaults: Record<string, Value> = {
    ...COMMON_DEFAULTS,
    projectTitle: experiment.title,
    projectCode: `AINP-NF/${experiment.code}`,
    dataCategory:
      experiment.design === 'Survey' || experiment.design === '2 Stage Stratified Sampling (No replication)'
        ? 'Survey'
        : 'Experimental',
    design: [
      experiment.design,
      experiment.replications ? `${experiment.replications} replications` : null,
      `${experiment.treatments.length} treatments`,
    ]
      .filter(Boolean)
      .join(', '),
    temporalExtent: `From ${experiment.startYear}${ongoing ? ', ongoing' : ''}`,
    availabilityLocation: 'AINP-NF data management system',
    methodology: experiment.objectives.length ? experiment.objectives.join('; ') : null,
  };
  return Object.fromEntries(
    METADATA_FIELDS.map((f) => [
      f.key,
      stored[f.key] !== undefined && stored[f.key] !== null ? stored[f.key]! : (defaults[f.key] ?? null),
    ]),
  );
};

// ── Merged records ──────────────────────────────────────────────────────────

/** Everything the derived fields need, loaded once for any number of trials of one experiment. */
const loadSources = async (experiment: ExperimentDoc, trials: TrialDoc[]) => {
  const centreIds = trials.map((t) => String(t.centreId));
  const [centres, pis, crops, seasons, units, coverage, detail] = await Promise.all([
    centresByIds(centreIds),
    activePisForCentres(centreIds),
    masterNames('crop'),
    masterNames('season'),
    masterNames('unit'),
    sheetCoverageByTrial(trials.map((t) => t.id as string)),
    withParameterDetails(experiment),
  ]);
  return { centres, pis, crops, seasons, units, coverage, parameters: detail.parameters };
};
type Sources = Awaited<ReturnType<typeof loadSources>>;

const autoValues = (
  experiment: ExperimentDoc,
  trial: TrialDoc,
  coPis: TrialMetadata['coPis'],
  src: Sources,
) => {
  const centre = src.centres.get(String(trial.centreId));
  const pi = src.pis.get(String(trial.centreId));
  const coverage = src.coverage.get(trial.id as string);
  const cropCodes = [...new Set(trial.croppingSystems.flatMap((cs) => cs.crops.map((c) => c.cropCode)))];
  const ongoing = experiment.status !== 'Closed';
  const years = coverage?.years ?? [];
  const temporal = years.length
    ? `${years[0]}${years.length > 1 ? ` to ${years.at(-1)}` : ''}${ongoing ? ', ongoing' : ''}`
    : `From ${experiment.startYear}${ongoing ? ', ongoing' : ''}`;
  return {
    projectTitle: experiment.title,
    piNames: joined([pi?.name, ...coPis.map((c) => c.name)]) || null,
    piDesignations: joined([pi?.designation, ...coPis.map((c) => c.designation)]) || null,
    piEmails: joined([pi ? contactEmailOf(pi) : null, ...coPis.map((c) => c.email)]) || null,
    commodity: cropCodes.map((c) => src.crops.get(c) ?? c).join(', ') || null,
    design: [
      experiment.design,
      experiment.replications ? `${experiment.replications} replications` : null,
      `${experiment.treatments.length} treatments`,
    ]
      .filter(Boolean)
      .join(', '),
    temporalExtent: temporal,
    seasons:
      experimentSeasonCodes(experiment)
        .map((s) => src.seasons.get(s) ?? s)
        .join(', ') || null,
    spatialExtent: centre
      ? `Site-specific: ${centre.name}, ${centre.state}${centre.zone ? ` (${centre.zone})` : ''}`
      : null,
    custodian: pi ? joined([pi.name, pi.designation, contactEmailOf(pi)]) : null,
    attributes:
      src.parameters
        .map((p) => `${p.name}${p.unitCode ? ` (${src.units.get(p.unitCode) ?? p.unitCode})` : ''}`)
        .join('; ') || null,
    resource: coverage
      ? `${coverage.sheets} observation sheet(s), ${coverage.approved} approved, in the AINP-NF system`
      : null,
  } as Record<string, string | null>;
};

const centreValues = (experiment: ExperimentDoc, trial: TrialDoc, record: RecordDoc, src: Sources) => {
  const centre = src.centres.get(String(trial.centreId));
  const recordObj = (record ? record.toObject() : {}) as Record<string, unknown>;

  const baseValues: Record<string, Value> = {
    // Suggested until the centre writes its own.
    datasetTitle: record?.datasetTitle ?? `${experiment.title}: ${centre?.name ?? 'centre'} data`,
    description: record?.description ?? null,
    coPis: (record?.coPis ?? []).map((c) => ({
      name: c.name,
      designation: c.designation ?? null,
      email: c.email ?? null,
    })),
    completionDate: isoDate(record?.completionDate),
    plotSize: record?.plotSize ?? null,
    dataFormat: [...(record?.dataFormat ?? [])],
    instruments: record?.instruments ?? null,
    availabilityLocation: record?.availabilityLocation ?? 'AINP-NF data management system',
    embargoYears: record?.embargoYears ?? null,
    source: record?.source ?? null,
    relation: record?.relation ?? null,
    citation: record?.citation ?? null,
  };

  for (const key of ALL_TRIAL_FIELD_KEYS) {
    if (recordObj[key] !== undefined && recordObj[key] !== null) {
      if (key === 'completionDate') {
        baseValues[key] = isoDate(recordObj[key] as Date);
      } else if (key === 'dataFormat') {
        baseValues[key] = Array.isArray(recordObj[key]) ? (recordObj[key] as string[]) : [];
      } else if (key === 'coPis') {
        // already handled
      } else {
        baseValues[key] = recordObj[key] as Value;
      }
    }
  }

  return baseValues;
};

const isFilled = (v: Value) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

const merge = (experiment: ExperimentDoc, trial: TrialDoc, record: RecordDoc, src: Sources) => {
  const defaultValues: Record<string, Value> = {
    ...commonValues(experiment),
    ...autoValues(experiment, trial, record?.coPis ?? [], src),
    datasetTitle: `${experiment.title}: ${src.centres.get(String(trial.centreId))?.name ?? 'centre'} data`,
    availabilityLocation: 'AINP-NF data management system',
  };
  const centreVals = centreValues(experiment, trial, record, src);
  const values: Record<string, Value> = {
    ...defaultValues,
    ...centreVals,
  };

  const recordObj = (record ? record.toObject() : {}) as Record<string, unknown>;

  const fields: MergedField[] = METADATA_FIELDS.map((f) => {
    const value = values[f.key] ?? null;
    const defaultVal = defaultValues[f.key] ?? null;
    const isCustomized =
      recordObj[f.key] !== undefined && recordObj[f.key] !== null && recordObj[f.key] !== '';
    return {
      ...f,
      value,
      display: displayOf(value),
      defaultValue: defaultVal,
      defaultDisplay: displayOf(defaultVal),
      isCustomized,
    };
  });
  const required = fields.filter((f) => f.required);
  const missing = required.filter((f) => !isFilled(f.value)).map((f) => f.label);
  const centre = src.centres.get(String(trial.centreId));
  return {
    trialId: trial.id as string,
    experiment: { id: experiment.id as string, code: experiment.code, title: experiment.title },
    centre: centre
      ? {
          id: centre.id as string,
          code: centre.code,
          name: centre.name,
          state: centre.state,
          zone: centre.zone ?? null,
        }
      : null,
    status: (record?.status ?? 'Draft') as MetadataStatus,
    history: record?.history ?? [],
    updatedAt: record?.updatedAt ?? null,
    completeness: { filled: required.length - missing.length, total: required.length, missing },
    fields,
  };
};

const recordsByTrial = async (trialIds: string[]) =>
  new Map(
    (await TrialMetadataModel.find({ trialId: trusted({ $in: trialIds }) })).map((r) => [
      String(r.trialId),
      r,
    ]),
  );

// ── Access ──────────────────────────────────────────────────────────────────

/** Anyone who can see the experiment may read every centre's metadata (not their data). */
const readableTrial = async (ctx: RequestContext, trialId: string) => {
  const trial = (await trialsByIds([trialId])).get(trialId);
  if (!trial) throw AppError.notFound('TRIAL_NOT_FOUND', 'Trial not found');
  const experiment = await getExperiment(ctx, String(trial.experimentId)).catch(() => {
    throw AppError.notFound('TRIAL_NOT_FOUND', 'Trial not found');
  });
  return { trial, experiment };
};

/** National users act for every centre; a Centre PI for their own; an Experiment PI for none. */
const ownsTrial = (ctx: RequestContext, trial: TrialDoc) =>
  isNational(ctx.user) || (isCentreScoped(ctx.user) && ctx.user.centreId === String(trial.centreId));

const permissionsFor = (ctx: RequestContext, trial: TrialDoc, status: MetadataStatus) => {
  const can = (c: Parameters<typeof hasCapability>[1]) => hasCapability(ctx.user.roleId, c);
  // A withdrawn centre's metadata is read-only, like the rest of its trial.
  const active = trial.assignmentStatus !== 'Withdrawn';
  const own = active && ownsTrial(ctx, trial);
  const editable = EDITABLE_METADATA_STATUSES.includes(status);
  return {
    canEdit: own && editable && can('research.enter'),
    canSubmit: own && editable && can('research.submit'),
    canReturn:
      active &&
      !isCentreScoped(ctx.user) &&
      (status === 'Submitted' || status === 'Approved') &&
      (can('research.review') || can('research.approve')),
    canApprove: active && !isCentreScoped(ctx.user) && status === 'Submitted' && can('research.approve'),
  };
};

// ── Reading ─────────────────────────────────────────────────────────────────

export const getTrialMetadata = async (ctx: RequestContext, trialId: string) => {
  const { trial, experiment } = await readableTrial(ctx, trialId);
  const record = await TrialMetadataModel.findOne({ trialId });
  const merged = merge(experiment, trial, record, await loadSources(experiment, [trial]));
  return { ...merged, isOwnCentre: ownsTrial(ctx, trial), ...permissionsFor(ctx, trial, merged.status) };
};

const allRecords = async (experiment: ExperimentDoc) => {
  const trials = (await trialsOfExperiment(experiment.id as string)).filter((t) =>
    experiment.centreIds.some((c) => String(c) === String(t.centreId)),
  );
  const [records, src] = await Promise.all([
    recordsByTrial(trials.map((t) => t.id as string)),
    loadSources(experiment, trials),
  ]);
  return trials
    .map((t) => merge(experiment, t, records.get(t.id as string) ?? null, src))
    .sort((a, b) => (a.centre?.name ?? '').localeCompare(b.centre?.name ?? ''));
};

/** The experiment's common fields and every assigned centre's status. */
export const getExperimentMetadata = async (ctx: RequestContext, experimentId: string) => {
  const experiment = await getExperiment(ctx, experimentId);
  const stored = (experiment.metadata ?? {}) as unknown as Record<string, Value | undefined>;
  const values = commonValues(experiment);
  const records = await allRecords(experiment);
  return {
    experiment: { id: experiment.id as string, code: experiment.code, title: experiment.title },
    canEditCommon: hasCapability(ctx.user.roleId, 'research.config'),
    common: METADATA_FIELDS.map((f) => {
      const val = values[f.key] ?? null;
      return {
        ...f,
        value: val,
        display: displayOf(val),
        isDefault: stored[f.key] === undefined || stored[f.key] === null,
      };
    }),
    centres: records.map((r) => ({
      trialId: r.trialId,
      centre: r.centre,
      status: r.status,
      updatedAt: r.updatedAt,
      completeness: r.completeness,
      isOwnCentre: isNational(ctx.user) || (isCentreScoped(ctx.user) && ctx.user.centreId === r.centre?.id),
    })),
  };
};

/** One row per centre with the 37 ICAR fields in their order (Co-PIs are inside 9–11). */
export const exportExperimentMetadata = async (ctx: RequestContext, experimentId: string) => {
  const experiment = await getExperiment(ctx, experimentId);
  const records = await allRecords(experiment);
  const numbered = METADATA_FIELDS.filter((f) => f.no !== null);
  const buffer = await buildWorkbook(
    'Metadata',
    [
      { key: 'centre', header: 'Centre', width: 28 },
      { key: 'status', header: 'Status', width: 12 },
      ...numbered.map((f) => ({ key: f.key, header: `${f.no}. ${f.label}`, width: 30 })),
    ],
    records.map((r) => ({
      centre: r.centre?.name ?? '',
      status: r.status,
      ...Object.fromEntries(r.fields.filter((f) => f.no !== null).map((f) => [f.key, f.display])),
    })),
  );
  return { buffer, filename: `${experiment.code}_metadata.xlsx` };
};

// ── Writing ─────────────────────────────────────────────────────────────────

export const saveTrialMetadata = async (ctx: RequestContext, trialId: string, dto: SaveTrialMetadataDto) => {
  // Only the trial's own centre (or a national user) can change it: others get 404.
  const trial = await getTrial(ctx, trialId);
  assertTrialActive(trial);
  await withTransaction(async (session) => {
    let record = await TrialMetadataModel.findOne({ trialId }).session(session);
    if (record && !EDITABLE_METADATA_STATUSES.includes(record.status)) {
      throw AppError.conflict('METADATA_LOCKED', `Metadata that is ${record.status} can't be edited`);
    }
    const isNew = !record;
    record ??= new TrialMetadataModel({
      trialId: trial.id,
      experimentId: trial.experimentId,
      centreId: trial.centreId,
      createdBy: ctx.user.id,
    });
    const keys = CENTRE_FIELD_KEYS.filter((k) => k in dto);
    const before = snapshot(record, keys);
    record.set({ ...dto, updatedBy: ctx.user.id });
    await record.save({ session });
    await recordAudit(
      ctx,
      {
        action: `${isNew ? 'Started' : 'Updated'} trial metadata`,
        module: MODULE,
        entityId: trial.id as string,
        centreId: String(trial.centreId),
        changes: fieldChanges(before, snapshot(record, keys)),
      },
      session,
    );
  });
  return getTrialMetadata(ctx, trialId);
};

const transition = async (
  ctx: RequestContext,
  trialId: string,
  from: MetadataStatus[],
  to: MetadataStatus,
  remark: string | undefined,
  verb: string,
) => {
  await assertTrialIdActive(trialId);
  // Conditional update: if two people act at once, only the first succeeds.
  const filter: QueryFilter<TrialMetadata> = { trialId, status: trusted({ $in: from }) };
  const record = await TrialMetadataModel.findOneAndUpdate(
    withScope(ctx.user, filter),
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
  if (!record) {
    const current = await TrialMetadataModel.findOne({ trialId });
    throw AppError.conflict(
      'INVALID_TRANSITION',
      `Can't ${verb} metadata that is ${current?.status ?? 'not started'}`,
    );
  }
  await recordAudit(ctx, {
    action: `${verb[0]!.toUpperCase()}${verb.slice(1)} trial metadata${remark ? `: ${remark}` : ''}`,
    module: MODULE,
    entityId: trialId,
    centreId: String(record.centreId),
  });
  return getTrialMetadata(ctx, trialId);
};

export const submitTrialMetadata = async (ctx: RequestContext, trialId: string, remark?: string) => {
  assertTrialActive(await getTrial(ctx, trialId));
  return transition(ctx, trialId, ['Draft', 'Returned'], 'Submitted', remark, 'submit');
};

export const returnTrialMetadata = (ctx: RequestContext, trialId: string, remark: string) =>
  transition(ctx, trialId, ['Submitted', 'Approved'], 'Returned', remark, 'return');

export const approveTrialMetadata = (ctx: RequestContext, trialId: string, remark?: string) =>
  transition(ctx, trialId, ['Submitted'], 'Approved', remark, 'approve');

export const saveCommonMetadata = async (
  ctx: RequestContext,
  experimentId: string,
  dto: SaveCommonMetadataDto,
) => {
  await getExperiment(ctx, experimentId);
  await updateExperimentMetadata(ctx, experimentId, dto);
  return getExperimentMetadata(ctx, experimentId);
};
