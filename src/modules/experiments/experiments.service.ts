import moment from 'moment';
import { type ClientSession, type QueryFilter, trusted } from 'mongoose';
import { hasCapability } from '../../config/constants.js';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { type RequestContext, isCentreScoped, withScope } from '../../utils/context.js';
import { escapeRegex } from '../../utils/validators.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import { centreExists } from '../centres/centres.service.js';
import { generateExperimentCode } from '../counters/counters.service.js';
import { activeMasterCodes, masterItemsExist } from '../masters/masters.service.js';
import { parametersByIds } from '../parameters/parameters.service.js';
import { findExperimentPi } from '../users/users.service.js';
import type { CreateExperimentDto, ListExperimentsQuery, UpdateExperimentDto } from './experiments.dto.js';
export { DESIGNS_WITH_ANOVA, DESIGNS_WITH_PLOTS } from './experiments.model.js';
import {
  DESIGNS_NEEDING_REPLICATIONS,
  DESIGNS_WITH_PLOTS,
  DESIGNS_WITHOUT_REPLICATIONS,
  EXPERIMENT_METADATA_KEYS,
  type Experiment,
  type ExperimentMetadata,
  ExperimentModel,
  type Treatment,
} from './experiments.model.js';

const MODULE = 'experiments';

/**
 * Centre users see the experiments their centre has a trial in, including ones it was withdrawn
 * from (read-only; `experimentIds` comes from their trials, see authenticate). An Experiment PI
 * sees only the experiment(s) their seat leads.
 */
const scoped = (ctx: RequestContext, filter: QueryFilter<Experiment>): QueryFilter<Experiment> => {
  if (!isCentreScoped(ctx.user)) return withScope(ctx.user, filter, 'centreIds', '_id');
  if (!ctx.user.centreId) throw AppError.forbidden('NO_CENTRE', 'Your account is not linked to a centre');
  return { $and: [filter, { _id: trusted({ $in: ctx.user.experimentIds }) }] };
};

/**
 * Makes the experiment's trials match `centreIds` inside the experiment's transaction and returns
 * the centres with an active trial. Passed in by the controller (trials.syncTrials), so this
 * service doesn't depend on the trials module, which depends on it.
 */
export type SyncCentres = (
  experiment: { id: string; code: string },
  centreIds: string[],
  session: ClientSession,
  withdrawReason?: string | null,
) => Promise<string[]>;

/** First and last moment of the experiment's calendar years (stored for date-range queries). */
export const computeYearDates = (startYear: number, endYear: number) => ({
  startYearDate: moment.utc(String(startYear), 'YYYY').startOf('year').toDate(),
  endYearDate: moment.utc(String(endYear), 'YYYY').endOf('year').toDate(),
});

/** The season codes an experiment records in (keys of its seasons map); empty = any season. */
export const experimentSeasonCodes = (experiment: Pick<Experiment, 'seasons'>): string[] => {
  const seasons = experiment.seasons as unknown;
  if (seasons instanceof Map) return [...seasons.keys()];
  return seasons && typeof seasons === 'object' ? Object.keys(seasons) : [];
};

/** Every year the experiment runs, start to end (2026, 2027 …). Sheets are recorded per year. */
export const experimentYears = (e: Pick<Experiment, 'startYear' | 'endYear'>): number[] =>
  Array.from(
    { length: Math.max(0, (e.endYear ?? e.startYear) - e.startYear + 1) },
    (_, i) => e.startYear + i,
  );

export const listExperiments = (ctx: RequestContext, query: ListExperimentsQuery) => {
  const where: QueryFilter<Experiment> = {};
  if (query.programmeCode) where.programmeCode = query.programmeCode;
  if (query.status) where.status = query.status;
  if (query.centreId) where.centreIds = query.centreId;
  if (query.piUserId) where.piUserId = query.piUserId;
  if (query.startYear) where.startYear = query.startYear;
  if (query.endYear) where.endYear = query.endYear;
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    where.$or = [{ code: pattern }, { title: pattern }];
  }
  return ExperimentModel.find(scoped(ctx, where)).sort({ createdAt: -1 }).limit(500);
};

export const getExperiment = async (ctx: RequestContext, id: string) => {
  const experiment = await ExperimentModel.findOne(scoped(ctx, { _id: id }));
  if (!experiment) throw AppError.notFound('EXPERIMENT_NOT_FOUND', 'Experiment not found');
  return experiment;
};

/**
 * For other modules, after they have checked the caller's access another way (e.g. through a
 * trial at the caller's centre). Not scoped.
 */
export const findExperiment = async (id: string) => {
  const experiment = await ExperimentModel.findById(id);
  if (!experiment) throw AppError.notFound('EXPERIMENT_NOT_FOUND', 'Experiment not found');
  return experiment;
};

/** The experiment with each parameter's library details attached, for forms and analysis. */
export const getExperimentWithParameters = async (ctx: RequestContext, id: string) =>
  withParameterDetails(await getExperiment(ctx, id));

export const withParameterDetails = async (experiment: Awaited<ReturnType<typeof findExperiment>>) => {
  const library = await parametersByIds(experiment.defaultParameters.map((p) => String(p.parameterId)));
  const defaultParameters = experiment.defaultParameters.map((p) => {
    const lib = library.get(String(p.parameterId));
    return {
      // Explicit fields: spreading a Mongoose sub-document does not copy its values.
      section: p.section,
      level: p.level,
      required: p.required,
      parameterId: String(p.parameterId),
      code: lib?.code,
      name: lib?.name,
      unitCode: lib?.unitCode ?? null,
      category: lib?.category,
      dataType: lib?.dataType ?? 'number',
      decimals: lib?.decimals ?? 2,
      min: lib?.min ?? null,
      max: lib?.max ?? null,
      choices: lib?.choices ?? [],
      /** Set for a calculated parameter: its values are computed, never entered. */
      formula: lib?.formula ?? null,
    };
  });
  return {
    ...experiment.toJSON(),
    id: experiment.id as string,
    defaultParameters,
    // Read-only alias for the sheets and analysis code, which work on "the parameters to record".
    parameters: defaultParameters,
  };
};

const validateReferences = async (dto: Partial<CreateExperimentDto>) => {
  if (dto.programmeCode && !(await activeMasterCodes('programme')).has(dto.programmeCode)) {
    throw AppError.badRequest(
      'UNKNOWN_PROGRAMME',
      `Programme ${dto.programmeCode} is not in the programmes master`,
    );
  }
  if (dto.seasons) {
    const known = await activeMasterCodes('season');
    const unknown = Object.keys(dto.seasons).filter((code) => !known.has(code));
    if (unknown.length)
      throw AppError.badRequest('UNKNOWN_SEASON', `Unknown season(s): ${unknown.join(', ')}`);
    const itemIds = [...new Set(Object.values(dto.seasons).flat())];
    if (itemIds.length && !(await masterItemsExist(itemIds))) {
      throw AppError.badRequest('UNKNOWN_SEASON_ITEM', 'One or more season master items not found');
    }
  }
  if (dto.defaultParameters?.length) {
    const library = await parametersByIds(dto.defaultParameters.map((p) => p.parameterId));
    const missing = dto.defaultParameters.filter((p) => !library.get(p.parameterId)?.isActive);
    if (missing.length) {
      throw AppError.badRequest(
        'UNKNOWN_PARAMETER',
        `${missing.length} parameter(s) are not active in the library`,
      );
    }
  }
  if (dto.centreIds?.length) {
    for (const id of dto.centreIds) {
      if (!(await centreExists(id))) throw AppError.badRequest('CENTRE_NOT_FOUND', `Centre ${id} not found`);
    }
  }
};

/** Once data exists, nothing that recorded data depends on may change or disappear. */
const assertCompatibleWithData = (existing: Experiment, dto: UpdateExperimentDto) => {
  if (!existing.dataLocked) return;
  const problems: string[] = [];
  if (dto.design && dto.design !== existing.design) problems.push('the design');
  if (dto.replications !== undefined && dto.replications !== existing.replications)
    problems.push('the replications');
  if (dto.mainPlotCount !== undefined && dto.mainPlotCount !== existing.mainPlotCount)
    problems.push('the number of main plots');
  if (dto.subPlotCount !== undefined && dto.subPlotCount !== existing.subPlotCount)
    problems.push('the number of sub plots');
  if (dto.subSubPlotCount !== undefined && dto.subSubPlotCount !== existing.subSubPlotCount)
    problems.push('the number of sub-sub plots');
  if (dto.treatments) {
    const kept = new Set(dto.treatments.map((t) => t.code));
    const removed = existing.treatments.filter((t) => !kept.has(t.code)).map((t) => t.code);
    if (removed.length) problems.push(`treatments ${removed.join(', ')} (they have data)`);
  }
  if (dto.mainPlotData) {
    const kept = new Set(dto.mainPlotData.map((t) => t.code));
    const removed = (existing.mainPlotData ?? []).filter((t) => !kept.has(t.code)).map((t) => t.code);
    if (removed.length) problems.push(`main plot treatments ${removed.join(', ')} (they have data)`);
  }
  if (dto.subPlotData) {
    const kept = new Set(dto.subPlotData.map((t) => t.code));
    const removed = (existing.subPlotData ?? []).filter((t) => !kept.has(t.code)).map((t) => t.code);
    if (removed.length) problems.push(`sub plot treatments ${removed.join(', ')} (they have data)`);
  }
  if (dto.subSubPlotData) {
    const kept = new Set(dto.subSubPlotData.map((t) => t.code));
    const removed = (existing.subSubPlotData ?? []).filter((t) => !kept.has(t.code)).map((t) => t.code);
    if (removed.length) problems.push(`sub-sub plot treatments ${removed.join(', ')} (they have data)`);
  }
  if (dto.defaultParameters) {
    const kept = new Set(dto.defaultParameters.map((p) => p.parameterId));
    const removed = existing.defaultParameters.filter((p) => !kept.has(String(p.parameterId)));
    if (removed.length) problems.push(`${removed.length} parameter(s) (they may have data)`);
  }
  if (problems.length) {
    throw AppError.conflict(
      'EXPERIMENT_HAS_DATA',
      `Centres have recorded data for this experiment, so you can't change ${problems.join('; ')}. You can still add treatments and default parameters.`,
    );
  }
};

/**
 * Main, sub and sub-sub plot counts for the design: split and strip plot need at least one of each;
 * split-split plot needs at least one of each three; every other design is a single plot (all 0).
 */
const plotCounts = (
  design: Experiment['design'],
  mainPlotCount = 0,
  subPlotCount = 0,
  subSubPlotCount = 0,
) => {
  if (!DESIGNS_WITH_PLOTS.includes(design)) {
    return { mainPlotCount: 0, subPlotCount: 0, subSubPlotCount: 0 };
  }
  if (mainPlotCount < 1 || subPlotCount < 1) {
    throw AppError.badRequest('PLOT_COUNTS_REQUIRED', `${design} needs at least 1 main plot and 1 sub plot`);
  }
  if (design === 'Split-split plot') {
    if (subSubPlotCount < 1) {
      throw AppError.badRequest('PLOT_COUNTS_REQUIRED', 'Split-split plot needs at least 1 sub-sub plot');
    }
    return { mainPlotCount, subPlotCount, subSubPlotCount };
  }
  return { mainPlotCount, subPlotCount, subSubPlotCount: 0 };
};

/** A sheet cell's plot: both null for a single-plot design. */
export interface PlotRef {
  mainPlot: number | null;
  subPlot: number | null;
}

/**
 * Every plot of the layout, main plot first (M1·S1, M1·S2, M2·S1 …); one `{ null, null }` plot
 * for designs that aren't split into plots. Each plot holds all treatments × replications.
 */
export const experimentPlots = (
  e: Pick<Experiment, 'design' | 'mainPlotCount' | 'subPlotCount'>,
): PlotRef[] => {
  if (!DESIGNS_WITH_PLOTS.includes(e.design) || !e.mainPlotCount || !e.subPlotCount) {
    return [{ mainPlot: null, subPlot: null }];
  }
  return Array.from({ length: e.mainPlotCount }, (_, m) =>
    Array.from({ length: e.subPlotCount }, (_, s) => ({ mainPlot: m + 1, subPlot: s + 1 })),
  ).flat();
};

/** "M1·S2", or '' for a single-plot design. */
export const plotLabel = (p: PlotRef) => (p.mainPlot === null ? '' : `M${p.mainPlot}·S${p.subPlot}`);

/**
 * What a plot's main plot and sub plot stand for: the names given in mainPlotData / subPlotData
 * (codes M1 … / S1 …), or null where none is given.
 */
export const plotNames = (
  e: { mainPlotData?: { code: string; name: string }[]; subPlotData?: { code: string; name: string }[] },
  p: PlotRef,
) => ({
  mainPlotName:
    p.mainPlot === null
      ? null
      : ((e.mainPlotData ?? []).find((t) => t.code === `M${p.mainPlot}`)?.name ?? null),
  subPlotName:
    p.subPlot === null ? null : ((e.subPlotData ?? []).find((t) => t.code === `S${p.subPlot}`)?.name ?? null),
});

/** "M1 Conventional tillage · S2 Jeevamrit" (codes alone where no name is given); '' for one plot. */
export const plotTitle = (e: Parameters<typeof plotNames>[0], p: PlotRef) => {
  if (p.mainPlot === null) return '';
  const { mainPlotName, subPlotName } = plotNames(e, p);
  const part = (code: string, name: string | null) => (name ? `${code} ${name}` : code);
  return `${part(`M${p.mainPlot}`, mainPlotName)} · ${part(`S${p.subPlot}`, subPlotName)}`;
};

/** The reference treatment, if set, must be one of the experiment's treatments. */
const assertReferenceTreatment = (code: string | null | undefined, treatments: { code: string }[]) => {
  if (code && !treatments.some((t) => t.code === code)) {
    throw AppError.badRequest(
      'UNKNOWN_REFERENCE_TREATMENT',
      `${code} is not one of this experiment's treatments`,
    );
  }
};

const assertPlotTreatmentsCount = (
  design: string,
  mainPlotCount: number,
  subPlotCount: number,
  subSubPlotCount: number,
  mainPlotData?: { code: string }[],
  subPlotData?: { code: string }[],
  subSubPlotData?: { code: string }[],
) => {
  if (design === 'Split plot' || design === 'Split-split plot') {
    if (mainPlotData !== undefined && mainPlotData.length > 0) {
      if (mainPlotCount <= 0) {
        throw AppError.badRequest(
          'MAIN_PLOT_COUNT_REQUIRED',
          'Set mainPlotCount before configuring main plot treatments',
        );
      }
      if (mainPlotData.length !== mainPlotCount) {
        throw AppError.badRequest(
          'MAIN_PLOT_COUNT_MISMATCH',
          `Main plot treatments count (${mainPlotData.length}) must match mainPlotCount (${mainPlotCount})`,
        );
      }
    }
    if (subPlotData !== undefined && subPlotData.length > 0) {
      if (subPlotCount <= 0) {
        throw AppError.badRequest(
          'SUB_PLOT_COUNT_REQUIRED',
          'Set subPlotCount before configuring sub plot treatments',
        );
      }
      if (subPlotData.length !== subPlotCount) {
        throw AppError.badRequest(
          'SUB_PLOT_COUNT_MISMATCH',
          `Sub plot treatments count (${subPlotData.length}) must match subPlotCount (${subPlotCount})`,
        );
      }
    }
  }
  if (design === 'Split-split plot') {
    if (subSubPlotData !== undefined && subSubPlotData.length > 0) {
      if (subSubPlotCount <= 0) {
        throw AppError.badRequest(
          'SUB_SUB_PLOT_COUNT_REQUIRED',
          'Set subSubPlotCount before configuring sub-sub plot treatments',
        );
      }
      if (subSubPlotData.length !== subSubPlotCount) {
        throw AppError.badRequest(
          'SUB_SUB_PLOT_COUNT_MISMATCH',
          `Sub-sub plot treatments count (${subSubPlotData.length}) must match subSubPlotCount (${subSubPlotCount})`,
        );
      }
    }
  }
};

const normalizeTreatmentsForDesign = (
  design: string,
  treatments: Treatment[] | undefined,
  mainPlotCount: number,
  subPlotCount: number,
  subSubPlotCount: number,
): Treatment[] | undefined => {
  if (!treatments) return treatments;
  if (design === 'Split plot') {
    if (mainPlotCount > 0 && subPlotCount > 0 && treatments.length > 0) {
      const expected = mainPlotCount * subPlotCount;
      if (treatments.length !== expected) {
        throw AppError.badRequest(
          'TREATMENTS_COUNT_MISMATCH',
          `Split plot treatments count (${treatments.length}) must match mainPlotCount × subPlotCount (${expected})`,
        );
      }
    }
    return treatments.map((t) => ({
      code: t.code,
      name: t.name,
      description: t.description ?? null,
      mainPlotCode: t.mainPlotCode ?? null,
      subPlotCode: t.subPlotCode ?? null,
      subSubPlotCode: null,
    }));
  }
  if (design === 'Split-split plot') {
    if (mainPlotCount > 0 && subPlotCount > 0 && subSubPlotCount > 0 && treatments.length > 0) {
      const expected = mainPlotCount * subPlotCount * subSubPlotCount;
      if (treatments.length !== expected) {
        throw AppError.badRequest(
          'TREATMENTS_COUNT_MISMATCH',
          `Split-split plot treatments count (${treatments.length}) must match mainPlotCount × subPlotCount × subSubPlotCount (${expected})`,
        );
      }
    }
    return treatments.map((t) => ({
      code: t.code,
      name: t.name,
      description: t.description ?? null,
      mainPlotCode: t.mainPlotCode ?? null,
      subPlotCode: t.subPlotCode ?? null,
      subSubPlotCode: t.subSubPlotCode ?? null,
    }));
  }
  // For other designs, mainPlotCode, subPlotCode, and subSubPlotCode remain null
  return treatments.map((t) => ({
    code: t.code,
    name: t.name,
    description: t.description ?? null,
    mainPlotCode: null,
    subPlotCode: null,
    subSubPlotCode: null,
  }));
};

/**
 * Only `research.assign` (PCU) may change which centres run it and who leads it. The PI must be
 * an active Experiment PI seat that doesn't already lead another experiment.
 */
const assertAssignment = async (
  ctx: RequestContext,
  dto: { centreIds?: unknown; piUserId?: string | null },
  experimentId?: string,
) => {
  const assigning = dto.centreIds !== undefined || dto.piUserId !== undefined;
  if (assigning && !hasCapability(ctx.user.roleId, 'research.assign')) {
    throw AppError.forbidden('ASSIGNMENT_NOT_ALLOWED', 'Only the PCU assigns centres and the Experiment PI');
  }
  if (!dto.piUserId) return;
  const pi = await findExperimentPi(dto.piUserId);
  const other = await ExperimentModel.findOne(
    experimentId ? { piUserId: pi.id, _id: trusted({ $ne: experimentId }) } : { piUserId: pi.id },
    { code: 1 },
  );
  if (other) {
    throw AppError.conflict('PI_ALREADY_LINKED', `${pi.email} already leads ${other.code}`);
  }
};

/** For authenticate: the experiments an Experiment PI seat leads (its scope). */
export const experimentIdsOfPi = async (userId: string): Promise<string[]> =>
  (await ExperimentModel.find({ piUserId: userId }, { _id: 1 }).lean()).map((e) => String(e._id));

/** For the PI accounts list: which experiment each seat leads. */
export const experimentsByPi = async (userIds: string[]) =>
  new Map(
    (
      await ExperimentModel.find({ piUserId: trusted({ $in: userIds }) }, { code: 1, title: 1, piUserId: 1 })
    ).map((e) => [String(e.piUserId), { id: e.id as string, code: e.code, title: e.title }]),
  );

export const createExperiment = async (
  ctx: RequestContext,
  dto: CreateExperimentDto,
  syncCentres: SyncCentres,
) => {
  await assertAssignment(ctx, dto);
  await validateReferences(dto);
  assertReferenceTreatment(dto.referenceTreatmentCode, dto.treatments ?? []);
  assertPlotTreatmentsCount(
    dto.design,
    dto.mainPlotCount ?? 0,
    dto.subPlotCount ?? 0,
    dto.subSubPlotCount ?? 0,
    dto.mainPlotData,
    dto.subPlotData,
    dto.subSubPlotData,
  );
  const treatments = normalizeTreatmentsForDesign(
    dto.design,
    dto.treatments,
    dto.mainPlotCount ?? 0,
    dto.subPlotCount ?? 0,
    dto.subSubPlotCount ?? 0,
  );
  return withTransaction(async (session) => {
    // A given code is kept; otherwise the next one in the sequence (AINP-NF-EXPT-001 …).
    const code = dto.code ?? (await generateExperimentCode(session));
    const [experiment] = await ExperimentModel.create(
      [
        {
          ...dto,
          treatments: treatments ?? [],
          code,
          ...computeYearDates(dto.startYear, dto.endYear),
          replications: DESIGNS_WITHOUT_REPLICATIONS.includes(dto.design) ? null : (dto.replications ?? null),
          ...plotCounts(dto.design, dto.mainPlotCount, dto.subPlotCount, dto.subSubPlotCount),
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        },
      ],
      { session },
    );
    if (!experiment) throw new Error('Experiment was not created');
    await recordAudit(
      ctx,
      { action: `Created experiment ${experiment.code}`, module: MODULE, entityId: experiment.id },
      session,
    );
    if (dto.centreIds?.length) {
      await syncCentres({ id: experiment.id as string, code: experiment.code }, dto.centreIds, session);
    }
    return experiment;
  });
};

export const updateExperiment = async (
  ctx: RequestContext,
  id: string,
  { withdrawReason, ...dto }: UpdateExperimentDto,
  syncCentres: SyncCentres,
) => {
  // Scoped: an Experiment PI may edit only the experiment they lead (others: 404).
  await getExperiment(ctx, id);
  await assertAssignment(ctx, dto, id);
  await validateReferences(dto);
  return withTransaction(async (session) => {
    const experiment = await ExperimentModel.findById(id).session(session);
    if (!experiment) throw AppError.notFound('EXPERIMENT_NOT_FOUND', 'Experiment not found');
    assertCompatibleWithData(experiment, dto);
    // Replications and the year dates can change as a side effect, so record them too.
    const keys = [
      ...new Set([
        ...Object.keys(dto),
        'replications',
        'mainPlotCount',
        'subPlotCount',
        'subSubPlotCount',
        'startYearDate',
        'endYearDate',
      ]),
    ];
    const before = snapshot(experiment, keys);

    // `dto` holds only the fields the request sent (validate parsed it; nothing is defaulted).
    experiment.set({ ...dto, updatedBy: ctx.user.id });
    if (dto.treatments !== undefined) {
      const normalized = normalizeTreatmentsForDesign(
        experiment.design,
        dto.treatments,
        experiment.mainPlotCount ?? 0,
        experiment.subPlotCount ?? 0,
        experiment.subSubPlotCount ?? 0,
      );
      experiment.set('treatments', normalized);
    } else if (dto.design && !['Split plot', 'Split-split plot'].includes(dto.design)) {
      experiment.treatments = (experiment.treatments ?? []).map((t) => ({
        ...t,
        mainPlotCode: null,
        subPlotCode: null,
        subSubPlotCode: null,
      }));
    }
    if (dto.startYear !== undefined || dto.endYear !== undefined) {
      if (experiment.endYear < experiment.startYear) {
        throw AppError.badRequest('INVALID_YEARS', 'The end year must not be before the start year');
      }
      experiment.set(computeYearDates(experiment.startYear, experiment.endYear));
    }
    if (DESIGNS_WITHOUT_REPLICATIONS.includes(experiment.design)) experiment.replications = null;
    // The request may change only the design or only the replications; check the result.
    if (DESIGNS_NEEDING_REPLICATIONS.includes(experiment.design) && (experiment.replications ?? 0) < 2) {
      throw AppError.badRequest(
        'REPLICATIONS_REQUIRED',
        `${experiment.design} needs at least 2 replications`,
      );
    }
    experiment.set(
      plotCounts(
        experiment.design,
        experiment.mainPlotCount,
        experiment.subPlotCount,
        experiment.subSubPlotCount,
      ),
    );
    assertReferenceTreatment(experiment.referenceTreatmentCode, experiment.treatments);
    assertPlotTreatmentsCount(
      experiment.design,
      experiment.mainPlotCount ?? 0,
      experiment.subPlotCount ?? 0,
      experiment.subSubPlotCount ?? 0,
      dto.mainPlotData,
      dto.subPlotData,
      dto.subSubPlotData,
    );
    // Assigned centres: the trials are the record; centreIds caches their active centres.
    if (dto.centreIds !== undefined) {
      const active = await syncCentres(
        { id: experiment.id as string, code: experiment.code },
        dto.centreIds,
        session,
        withdrawReason,
      );
      experiment.set('centreIds', active);
    }
    await experiment.save({ session });
    await recordAudit(
      ctx,
      {
        action: `Updated experiment ${experiment.code}`,
        module: MODULE,
        entityId: experiment.id,
        changes: fieldChanges(before, snapshot(experiment, keys)),
      },
      session,
    );
    return experiment;
  });
};

/** The PCU's common metadata fields (modules/metadata checks access and values). */
export const updateExperimentMetadata = async (
  ctx: RequestContext,
  id: string,
  dto: Partial<ExperimentMetadata>,
) =>
  withTransaction(async (session) => {
    const experiment = await ExperimentModel.findById(id).session(session);
    if (!experiment) throw AppError.notFound('EXPERIMENT_NOT_FOUND', 'Experiment not found');
    const keys = EXPERIMENT_METADATA_KEYS.filter((k) => k in dto);
    const before = snapshot(experiment.metadata ?? {}, keys);
    for (const key of keys) experiment.set(`metadata.${key}`, dto[key] ?? null);
    experiment.set('updatedBy', ctx.user.id);
    await experiment.save({ session });
    await recordAudit(
      ctx,
      {
        action: `Updated metadata of experiment ${experiment.code}`,
        module: MODULE,
        entityId: experiment.id,
        changes: fieldChanges(before, snapshot(experiment.metadata, keys)),
      },
      session,
    );
    return experiment;
  });

/** Called by the sheets module when the first data is recorded. */
export const markDataLocked = async (experimentId: string): Promise<void> => {
  await ExperimentModel.updateOne({ _id: experimentId, dataLocked: false }, { dataLocked: true });
};

/** For other modules: experiments by id (unscoped; callers check access to the trial instead). */
export const experimentsByIds = async (ids: string[]) =>
  new Map((await ExperimentModel.find({ _id: trusted({ $in: ids }) })).map((e) => [e.id as string, e]));
