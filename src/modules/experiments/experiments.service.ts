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
import { croppingSystemsByIds } from '../croppingSystems/croppingSystems.service.js';
import { activeMasterCodes } from '../masters/masters.service.js';
import { parametersByIds } from '../parameters/parameters.service.js';
import { findExperimentPi } from '../users/users.service.js';
import type { CreateExperimentDto, ListExperimentsQuery, UpdateExperimentDto } from './experiments.dto.js';
export { DESIGNS_WITH_ANOVA, DESIGNS_WITH_PLOTS } from './experiments.model.js';
import {
  DESIGNS_NEEDING_REPLICATIONS,
  DESIGNS_WITH_PLOTS,
  DESIGNS_WITHOUT_REPLICATIONS,
  EXPERIMENT_METADATA_KEYS,
  type DisabledParameter,
  type Experiment,
  type ExperimentMetadata,
  ExperimentModel,
  type SubPlotItem,
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
  experiment: {
    id: string;
    code: string;
    treatments?: Treatment[];
    mainPlotData?: Treatment[];
    subPlotData?: SubPlotItem[];
    subSubPlotData?: Treatment[];
    factor1Data?: Treatment[];
    factor2Data?: Treatment[];
    factor3Data?: Treatment[];
    disabledParameters?: DisabledParameter[];
  },
  centreIds: string[],
  session: ClientSession,
  withdrawReason?: string | null,
) => Promise<string[]>;

/** First and last moment of the experiment's calendar years (stored for date-range queries). */
export type PushSubPlots = (
  experiment: { id: string; code: string; subPlotData: SubPlotItem[] },
  session: ClientSession,
) => Promise<void>;

export const computeYearDates = (startYear: number, endYear: number) => ({
  startYearDate: moment.utc(String(startYear), 'YYYY').startOf('year').toDate(),
  endYearDate: moment.utc(String(endYear), 'YYYY').endOf('year').toDate(),
});

/** The season codes an experiment records in; empty = any season. */
export const experimentSeasonCodes = (experiment: Pick<Experiment, 'seasons'>): string[] =>
  Array.isArray(experiment?.seasons) ? experiment.seasons : [];

/** Every year the experiment runs, start to end (2026, 2027 …). Sheets are recorded per year. */
export const experimentYears = (e: Pick<Experiment, 'startYear' | 'endYear'>): number[] =>
  Array.from(
    { length: Math.max(0, (e.endYear ?? e.startYear) - e.startYear + 1) },
    (_, i) => e.startYear + i,
  );

/**
 * For the public summary (no sign-in): the experiments running now (Active), with only what may be
 * shown to anyone: code, title, programme, design and years.
 */
export const publicExperiments = () =>
  ExperimentModel.find(
    { status: 'Active' },
    { code: 1, title: 1, programmeCode: 1, design: 1, startYear: 1, endYear: 1 },
  )
    .sort({ code: 1 })
    .lean();

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

type SubPlotSystems = { code: string; croppingSystems?: { seasonCode: string; croppingSystem: unknown }[] };

/**
 * Sub plots of split / split-split plots name one cropping system (masters) per season. Each must
 * be a system of that season, the season one of the protocol's, and the system active unless it
 * was already in use. Once the experiment has data, a season's choice can be set but not changed
 * or removed (409 EXPERIMENT_HAS_DATA), so recorded sheets keep their crops.
 */
export const assertSubPlotSystems = async (
  dto: { design?: Experiment['design']; seasons?: string[]; subPlotData?: SubPlotSystems[] },
  existing?: Pick<Experiment, 'design' | 'seasons' | 'dataLocked'> & { subPlotData?: SubPlotSystems[] },
  alsoInUse: SubPlotSystems[] = [],
) => {
  if (!dto.subPlotData) return;
  const entries = dto.subPlotData.flatMap((sp) =>
    (sp.croppingSystems ?? []).map((x) => ({
      sub: sp.code,
      season: x.seasonCode,
      id: String(x.croppingSystem),
    })),
  );
  const design = dto.design ?? existing?.design;
  if (entries.length && design !== 'Split plot' && design !== 'Split-split plot') {
    throw AppError.badRequest(
      'CROPPING_SYSTEM_NOT_ALLOWED',
      'Cropping systems can be sub plots of split and split-split plot designs only',
    );
  }
  const before = new Map(
    (existing?.subPlotData ?? []).flatMap((sp) =>
      (sp.croppingSystems ?? []).map(
        (x) => [`${sp.code}|${x.seasonCode}`, String(x.croppingSystem)] as const,
      ),
    ),
  );
  if (existing?.dataLocked) {
    const now = new Map(entries.map((e) => [`${e.sub}|${e.season}`, e.id]));
    const changed = [...before]
      .filter(([key, id]) => now.get(key) !== id)
      .map(([key]) => key.replace('|', ' in '));
    if (changed.length) {
      throw AppError.conflict(
        'EXPERIMENT_HAS_DATA',
        `Data has been recorded, so these cropping systems can't change: ${changed.join(', ')}`,
      );
    }
  }
  if (!entries.length) return;
  const protocolSeasons = experimentSeasonCodes({
    seasons: dto.seasons ?? existing?.seasons ?? [],
  });
  const inUse = new Set([
    ...before.values(),
    ...alsoInUse.flatMap((sp) => (sp.croppingSystems ?? []).map((x) => String(x.croppingSystem))),
  ]);
  const systems = await croppingSystemsByIds(entries.map((e) => e.id));
  for (const e of entries) {
    const system = systems.get(e.id);
    if (!system || (!system.isActive && !inUse.has(e.id))) {
      throw AppError.badRequest(
        'UNKNOWN_CROPPING_SYSTEM',
        `${e.sub} in ${e.season}: not an active cropping system in the masters`,
      );
    }
    if (system.seasonCode !== e.season) {
      throw AppError.badRequest(
        'SEASON_MISMATCH',
        `${e.sub} in ${e.season}: ${system.code} is a ${system.seasonCode} system`,
      );
    }
    if (protocolSeasons.length && !protocolSeasons.includes(e.season)) {
      throw AppError.badRequest('SEASON_NOT_IN_PROTOCOL', `${e.season} is not a season of this experiment`);
    }
  }
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
    const unknown = dto.seasons.filter((code) => !known.has(code));
    if (unknown.length)
      throw AppError.badRequest('UNKNOWN_SEASON', `Unknown season(s): ${unknown.join(', ')}`);
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
  if (dto.factor1Data) {
    const kept = new Set(dto.factor1Data.map((t) => t.code));
    const removed = (existing.factor1Data ?? []).filter((t) => !kept.has(t.code)).map((t) => t.code);
    if (removed.length) problems.push(`factor 1 levels ${removed.join(', ')} (they have data)`);
  }
  if (dto.factor2Data) {
    const kept = new Set(dto.factor2Data.map((t) => t.code));
    const removed = (existing.factor2Data ?? []).filter((t) => !kept.has(t.code)).map((t) => t.code);
    if (removed.length) problems.push(`factor 2 levels ${removed.join(', ')} (they have data)`);
  }
  if (dto.factor3Data) {
    const kept = new Set(dto.factor3Data.map((t) => t.code));
    const removed = (existing.factor3Data ?? []).filter((t) => !kept.has(t.code)).map((t) => t.code);
    if (removed.length) problems.push(`factor 3 levels ${removed.join(', ')} (they have data)`);
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
  if (design === 'Factorial') {
    // Factor A and B levels (main / sub lists), optional factor C (sub-sub list).
    if (mainPlotCount < 2 || subPlotCount < 2) {
      throw AppError.badRequest(
        'PLOT_COUNTS_REQUIRED',
        'A factorial design needs at least 2 levels of factor A and of factor B',
      );
    }
    return { mainPlotCount, subPlotCount, subSubPlotCount };
  }
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

/** Designs whose treatments are combinations of factor levels (each treatment one combination). */
export const DESIGNS_WITH_FACTORS: readonly Experiment['design'][] = [
  'Split plot',
  'Split-split plot',
  'Factorial',
];

export type FactorKey = 'A' | 'B' | 'C';

/**
 * The experiment's factors, for sheets and analysis: in split / split-split plot the main, sub and
 * sub-sub plots; in a factorial, factors A, B (and C). Levels are the codes M1 … / S1 … / SS1 …
 * with the names given in mainPlotData / subPlotData / subSubPlotData. Each treatment carries its
 * level of each factor (mainPlotCode / subPlotCode / subSubPlotCode). Empty for other designs.
 */
export const experimentFactors = (
  e: Pick<Experiment, 'design' | 'mainPlotCount' | 'subPlotCount' | 'subSubPlotCount'> & {
    mainPlotData?: { code: string; name: string }[];
    subPlotData?: { code: string }[];
    subSubPlotData?: { code: string; name: string }[];
    factor1Data?: { code: string; name: string }[];
    factor2Data?: { code: string; name: string }[];
    factor3Data?: { code: string; name: string }[];
  },
) => {
  if (!DESIGNS_WITH_FACTORS.includes(e.design)) return [];
  const factorial = e.design === 'Factorial';
  const levels = (prefix: string, count: number, data?: { code: string; name?: string }[]) =>
    Array.from({ length: count }, (_, i) => {
      const code = `${prefix}${i + 1}`;
      return { code, name: data?.find((d) => d.code === code)?.name || null };
    });
  if (factorial) {
    const list = [
      {
        key: 'A' as FactorKey,
        label: 'Factor 1',
        field: 'factor1Code' as const,
        levels: levels('F1_', e.mainPlotCount ?? 0, e.factor1Data),
      },
      {
        key: 'B' as FactorKey,
        label: 'Factor 2',
        field: 'factor2Code' as const,
        levels: levels('F2_', e.subPlotCount ?? 0, e.factor2Data),
      },
      {
        key: 'C' as FactorKey,
        label: 'Factor 3',
        field: 'factor3Code' as const,
        levels: levels('F3_', e.subSubPlotCount ?? 0, e.factor3Data),
      },
    ];
    return list.filter((f) => f.levels.length > 0 && (f.key !== 'C' || (e.subSubPlotCount ?? 0) > 0));
  }
  const list = [
    {
      key: 'A' as FactorKey,
      label: 'Main plot',
      field: 'mainPlotCode' as const,
      levels: levels('M', e.mainPlotCount ?? 0, e.mainPlotData),
    },
    {
      key: 'B' as FactorKey,
      label: 'Sub plot',
      field: 'subPlotCode' as const,
      levels: levels('S', e.subPlotCount ?? 0, e.subPlotData),
    },
    {
      key: 'C' as FactorKey,
      label: 'Sub-sub plot',
      field: 'subSubPlotCode' as const,
      levels: levels('SS', e.subSubPlotCount ?? 0, e.subSubPlotData),
    },
  ];
  return list.filter((f) => f.levels.length > 0 && (f.key !== 'C' || e.design !== 'Split plot'));
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
  factor1Data?: { code: string }[],
  factor2Data?: { code: string }[],
  factor3Data?: { code: string }[],
) => {
  if (design === 'Factorial') {
    if (factor1Data !== undefined && factor1Data.length > 0) {
      if (mainPlotCount <= 0) {
        throw AppError.badRequest('FACTOR1_COUNT_REQUIRED', 'Set Factor 1 count before configuring Factor 1');
      }
      if (factor1Data.length !== mainPlotCount) {
        throw AppError.badRequest(
          'FACTOR1_COUNT_MISMATCH',
          `Factor 1 count (${factor1Data.length}) must match ${mainPlotCount}`,
        );
      }
    }
    if (factor2Data !== undefined && factor2Data.length > 0) {
      if (subPlotCount <= 0) {
        throw AppError.badRequest('FACTOR2_COUNT_REQUIRED', 'Set Factor 2 count before configuring Factor 2');
      }
      if (factor2Data.length !== subPlotCount) {
        throw AppError.badRequest(
          'FACTOR2_COUNT_MISMATCH',
          `Factor 2 count (${factor2Data.length}) must match ${subPlotCount}`,
        );
      }
    }
    if (factor3Data !== undefined && factor3Data.length > 0) {
      if (subSubPlotCount <= 0) {
        throw AppError.badRequest('FACTOR3_COUNT_REQUIRED', 'Set Factor 3 count before configuring Factor 3');
      }
      if (factor3Data.length !== subSubPlotCount) {
        throw AppError.badRequest(
          'FACTOR3_COUNT_MISMATCH',
          `Factor 3 count (${factor3Data.length}) must match ${subSubPlotCount}`,
        );
      }
    }
    return;
  }
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
      factor1Code: null,
      factor2Code: null,
      factor3Code: null,
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
      factor1Code: null,
      factor2Code: null,
      factor3Code: null,
    }));
  }
  if (design === 'Factorial') {
    const expected = mainPlotCount * subPlotCount * (subSubPlotCount || 1);
    if (mainPlotCount > 0 && subPlotCount > 0 && treatments.length > 0 && treatments.length !== expected) {
      throw AppError.badRequest(
        'TREATMENTS_COUNT_MISMATCH',
        `Factorial treatments count (${treatments.length}) must match the number of level combinations (${expected})`,
      );
    }
    return treatments.map((t) => ({
      code: t.code,
      name: t.name,
      description: t.description ?? null,
      mainPlotCode: null,
      subPlotCode: null,
      subSubPlotCode: null,
      factor1Code: t.factor1Code ?? null,
      factor2Code: t.factor2Code ?? null,
      factor3Code: subSubPlotCount > 0 ? (t.factor3Code ?? null) : null,
    }));
  }
  // For other designs, all plot and factor codes remain null
  return treatments.map((t) => ({
    code: t.code,
    name: t.name,
    description: t.description ?? null,
    mainPlotCode: null,
    subPlotCode: null,
    subSubPlotCode: null,
    factor1Code: null,
    factor2Code: null,
    factor3Code: null,
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
  await assertSubPlotSystems(dto);
  assertReferenceTreatment(dto.referenceTreatmentCode, dto.treatments ?? []);
  assertPlotTreatmentsCount(
    dto.design,
    dto.mainPlotCount ?? 0,
    dto.subPlotCount ?? 0,
    dto.subSubPlotCount ?? 0,
    dto.mainPlotData,
    dto.subPlotData,
    dto.subSubPlotData,
    dto.factor1Data,
    dto.factor2Data,
    dto.factor3Data,
  );
  const treatments = normalizeTreatmentsForDesign(
    dto.design,
    dto.treatments,
    dto.mainPlotCount ?? 0,
    dto.subPlotCount ?? 0,
    dto.subSubPlotCount ?? 0,
  );
  return withTransaction(async (session) => {
    // A given code is kept; otherwise the programme's next one (AINP-NF-P2-EXPT-001 …).
    const code =
      dto.code ??
      (await generateExperimentCode(
        dto.programmeCode,
        async (c) => Boolean(await ExperimentModel.exists({ code: c }).session(session)),
        session,
      ));
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
      await syncCentres(
        {
          id: experiment.id as string,
          code: experiment.code,
          treatments: experiment.treatments,
          mainPlotData: experiment.mainPlotData,
          subPlotData: experiment.subPlotData,
          subSubPlotData: experiment.subSubPlotData,
          factor1Data: experiment.factor1Data,
          factor2Data: experiment.factor2Data,
          factor3Data: experiment.factor3Data,
          disabledParameters: experiment.disabledParameters,
        },
        dto.centreIds,
        session,
      );
    }
    return experiment;
  });
};

export const updateExperiment = async (
  ctx: RequestContext,
  id: string,
  { withdrawReason, ...dto }: UpdateExperimentDto,
  syncCentres: SyncCentres,
  /** Applies the sub plots' cropping systems to the active trials (trials service). */
  pushSubPlots?: PushSubPlots,
) => {
  // Scoped: an Experiment PI may edit only the experiment they lead (others: 404).
  const current = await getExperiment(ctx, id);
  await assertAssignment(ctx, dto, id);
  await validateReferences(dto);
  await assertSubPlotSystems(dto, current);
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
    } else if (dto.design && !DESIGNS_WITH_FACTORS.includes(dto.design)) {
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
      dto.factor1Data,
      dto.factor2Data,
      dto.factor3Data,
    );
    // Assigned centres: the trials are the record; centreIds caches their active centres.
    if (dto.centreIds !== undefined) {
      const active = await syncCentres(
        {
          id: experiment.id as string,
          code: experiment.code,
          treatments: experiment.treatments,
          mainPlotData: experiment.mainPlotData,
          subPlotData: experiment.subPlotData,
          subSubPlotData: experiment.subSubPlotData,
          factor1Data: experiment.factor1Data,
          factor2Data: experiment.factor2Data,
          factor3Data: experiment.factor3Data,
          disabledParameters: experiment.disabledParameters,
        },
        dto.centreIds,
        session,
        withdrawReason,
      );
      experiment.set('centreIds', active);
    }
    await experiment.save({ session });
    if (dto.subPlotData && pushSubPlots) {
      await pushSubPlots(
        { id: experiment.id as string, code: experiment.code, subPlotData: experiment.subPlotData },
        session,
      );
    }
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
