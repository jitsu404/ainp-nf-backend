import { type ClientSession, type QueryFilter, Types, trusted } from 'mongoose';
import { hasCapability } from '../../config/constants.js';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { type RequestContext, withScope } from '../../utils/context.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import {
  assertSubPlotSystems,
  experimentSeasonCodes,
  findExperiment,
  withParameterDetails,
} from '../experiments/experiments.service.js';
import type {
  DisabledParameter,
  Experiment,
  SubPlotItem,
  Treatment,
} from '../experiments/experiments.model.js';
import { croppingSystemsByIds } from '../croppingSystems/croppingSystems.service.js';
import { activeMasterCodes, masterItemsByIds } from '../masters/masters.service.js';
import { getOwnProfile } from '../users/users.service.js';
import type { ListTrialsQuery, UpdateTrialDto } from './trials.dto.js';
import { type Trial, TrialModel } from './trials.model.js';

const MODULE = 'trials';

const scoped = (ctx: RequestContext, filter: QueryFilter<Trial>) => withScope(ctx.user, filter);

/**
 * Makes the experiment's trials match the centres it is assigned to, inside the caller's
 * transaction: a new centre gets a trial, a centre that was withdrawn earlier gets its old trial
 * back (with its data), and a centre no longer listed is withdrawn. Nothing is deleted.
 * Returns the centres with an active trial, for the experiment's `centreIds` cache.
 */
export const syncTrials = async (
  ctx: RequestContext,
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
): Promise<string[]> => {
  const wanted = new Set(centreIds.map(String));
  const trials = await TrialModel.find({ experimentId: experiment.id }).session(session);
  const byCentre = new Map(trials.map((t) => [String(t.centreId), t]));
  const now = new Date();
  const audit = (trialId: string, centreId: string, action: string) =>
    recordAudit(ctx, { action, module: MODULE, entityId: trialId, centreId }, session);

  for (const centreId of wanted) {
    const trial = byCentre.get(centreId);
    if (!trial) {
      const [created] = await TrialModel.create(
        [
          {
            experimentId: experiment.id,
            centreId,
            assignmentStatus: 'Active',
            assignedAt: now,
            assignedBy: ctx.user.id,
            treatments: experiment.treatments ?? [],
            mainPlotData: experiment.mainPlotData ?? [],
            subPlotData: experiment.subPlotData ?? [],
            subSubPlotData: experiment.subSubPlotData ?? [],
            factor1Data: experiment.factor1Data ?? [],
            factor2Data: experiment.factor2Data ?? [],
            factor3Data: experiment.factor3Data ?? [],
            disabledParameters: experiment.disabledParameters ?? [],
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
          },
        ],
        { session },
      );
      if (!created) throw new Error('Trial was not created');
      await audit(created.id as string, centreId, `Assigned ${experiment.code} to the centre`);
    } else {
      let needsSave = false;
      if (!trial.treatments || trial.treatments.length === 0) {
        trial.set({
          treatments: experiment.treatments ?? [],
          mainPlotData: experiment.mainPlotData ?? [],
          subPlotData: experiment.subPlotData ?? [],
          subSubPlotData: experiment.subSubPlotData ?? [],
          factor1Data: experiment.factor1Data ?? [],
          factor2Data: experiment.factor2Data ?? [],
          factor3Data: experiment.factor3Data ?? [],
        });
        needsSave = true;
      }
      if (
        (!trial.disabledParameters || trial.disabledParameters.length === 0) &&
        experiment.disabledParameters?.length
      ) {
        trial.set({
          disabledParameters: experiment.disabledParameters,
        });
        needsSave = true;
      }
      if (trial.assignmentStatus === 'Withdrawn') {
        trial.set({
          assignmentStatus: 'Active',
          assignedAt: now,
          assignedBy: ctx.user.id,
          withdrawnAt: null,
          withdrawnBy: null,
          withdrawReason: null,
          updatedBy: ctx.user.id,
        });
        await trial.save({ session });
        await audit(trial.id as string, centreId, `Assigned ${experiment.code} to the centre again`);
      } else if (needsSave) {
        await trial.save({ session });
      }
    }
  }

  for (const trial of trials) {
    const centreId = String(trial.centreId);
    if (wanted.has(centreId) || trial.assignmentStatus === 'Withdrawn') continue;
    trial.set({
      assignmentStatus: 'Withdrawn',
      withdrawnAt: now,
      withdrawnBy: ctx.user.id,
      withdrawReason: withdrawReason ?? null,
      updatedBy: ctx.user.id,
    });
    await trial.save({ session });
    await audit(
      trial.id as string,
      centreId,
      `Withdrew the centre from ${experiment.code}${withdrawReason ? `: ${withdrawReason}` : ''}`,
    );
  }
  return [...wanted];
};

/** Writes to a withdrawn trial (its setup, sheets, metadata) are refused; its data stays readable. */
/**
 * The experiment's sub plot cropping systems take priority: each one set there (sub plot × season)
 * replaces the trial's own for every active trial. Seasons the experiment leaves empty keep what the
 * centre chose, and sub plots the trial lacks are added. Runs inside the experiment's update.
 */
export const pushSubPlotSystems = async (
  ctx: RequestContext,
  experiment: { id: string; code: string; subPlotData: SubPlotItem[] },
  session: ClientSession,
) => {
  const trials = await TrialModel.find({ experimentId: experiment.id, assignmentStatus: 'Active' }).session(
    session,
  );
  for (const trial of trials) {
    const own = new Map((trial.subPlotData ?? []).map((sp) => [sp.code, sp]));
    let changed = false;
    const next: SubPlotItem[] = experiment.subPlotData.map((sp) => {
      const mine = own.get(sp.code);
      const seasons = new Map(
        (mine?.croppingSystems ?? []).map((x) => [x.seasonCode, String(x.croppingSystem)]),
      );
      for (const x of sp.croppingSystems ?? []) {
        if (seasons.get(x.seasonCode) !== String(x.croppingSystem)) changed = true;
        seasons.set(x.seasonCode, String(x.croppingSystem));
      }
      if (!mine) changed = true;
      const base = mine ?? sp;
      return {
        code: sp.code,
        description: base.description ?? null,
        croppingSystems: [...seasons].map(([seasonCode, croppingSystem]) => ({ seasonCode, croppingSystem })),
      } as SubPlotItem;
    });
    // Sub plots the trial has beyond the experiment's stay as they are.
    for (const sp of trial.subPlotData ?? []) {
      if (!experiment.subPlotData.some((x) => x.code === sp.code)) next.push(sp);
    }
    if (!changed) continue;
    trial.set({ subPlotData: next, updatedBy: ctx.user.id });
    await trial.save({ session });
    await recordAudit(
      ctx,
      {
        action: `Applied ${experiment.code}'s sub plot cropping systems to the trial`,
        module: MODULE,
        entityId: trial.id as string,
        centreId: String(trial.centreId),
      },
      session,
    );
  }
};

export const assertTrialActive = (trial: { assignmentStatus?: string | null }) => {
  if (trial.assignmentStatus === 'Withdrawn') {
    throw AppError.conflict(
      'TRIAL_WITHDRAWN',
      'This centre has been withdrawn from the experiment; its data is read-only',
    );
  }
};

/** By id, for modules that hold only the trial id (e.g. a sheet's `trialId`). */
export const assertTrialIdActive = async (trialId: string) => {
  const trial = await TrialModel.findById(trialId, { assignmentStatus: 1 }).lean();
  if (trial) assertTrialActive(trial);
};

/**
 * For authenticate: the experiments a centre has (or had) a trial in. A Centre PI's scope for
 * experiments, so a withdrawn centre still sees its past experiment, read-only.
 */
export const experimentIdsAtCentre = async (centreId: string): Promise<string[]> =>
  (await TrialModel.find({ centreId }, { experimentId: 1 }).lean()).map((t) => String(t.experimentId));

/** For other modules: the ids of an experiment's withdrawn trials. */
export const withdrawnTrialIds = async (experimentId: string): Promise<Set<string>> =>
  new Set(
    (await TrialModel.find({ experimentId, assignmentStatus: 'Withdrawn' }, { _id: 1 }).lean()).map((t) =>
      String(t._id),
    ),
  );

export const listTrials = (ctx: RequestContext, query: ListTrialsQuery) => {
  const where: QueryFilter<Trial> = {};
  if (query.experimentId) where.experimentId = query.experimentId;
  if (query.centreId) where.centreId = query.centreId;
  if (query.status) where.status = query.status;
  if (query.assignmentStatus) where.assignmentStatus = query.assignmentStatus;
  return TrialModel.find(scoped(ctx, where))
    .populate('experimentId', 'code title programmeCode design status')
    .populate('centreId', 'code name state')
    .sort({ createdAt: -1 })
    .limit(1000);
};

export const getTrial = async (ctx: RequestContext, id: string) => {
  const trial = await TrialModel.findOne(scoped(ctx, { _id: id }));
  if (!trial) throw AppError.notFound('TRIAL_NOT_FOUND', 'Trial not found');
  return trial;
};

const idsOf = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

/** A Mongoose map or a plain object (lean) as season code → ids. */
const seasonMap = (value: unknown): Map<string, string[]> => {
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [String(k), idsOf(v)]));
  if (value && typeof value === 'object') {
    return new Map(Object.entries(value).map(([k, v]) => [k, idsOf(v)]));
  }
  return new Map();
};

/**
 * The crops the centre grows in each of the experiment's seasons: the experiment's crops (the
 * default for every centre) unless the centre chose its own for that season (`changed`).
 */
export const trialSeasonCrops = async (
  experiment: Pick<Experiment, 'seasons'>,
  trial: Pick<Trial, 'seasonCrops'>,
) => {
  const defaults = seasonMap(experiment.seasons);
  const own = seasonMap(trial.seasonCrops);
  const codes = [...new Set([...defaults.keys(), ...own.keys()])];
  const items = await masterItemsByIds(
    codes.flatMap((c) => [...(defaults.get(c) ?? []), ...(own.get(c) ?? [])]),
  );
  const describe = (ids: string[]) =>
    ids.map((id) => ({ id, code: items.get(id)?.code ?? null, name: items.get(id)?.name ?? null }));
  return codes.map((seasonCode) => {
    const defaultCrops = defaults.get(seasonCode) ?? [];
    const changed = own.has(seasonCode);
    return {
      seasonCode,
      crops: describe(changed ? own.get(seasonCode)! : defaultCrops),
      defaultCrops: describe(defaultCrops),
      changed,
      /** In the trial but no longer one of the experiment's seasons. */
      inProtocol: defaults.has(seasonCode) || defaults.size === 0,
    };
  });
};

/** The trial together with its experiment protocol (treatments, parameters with library details). */
export const getTrialDetail = async (ctx: RequestContext, id: string) => {
  const trial = await TrialModel.findOne(scoped(ctx, { _id: id })).populate(
    'centreId',
    'code name state host',
  );
  if (!trial) throw AppError.notFound('TRIAL_NOT_FOUND', 'Trial not found');
  // Access was already checked through the trial (scoped to the caller's centre).
  const experiment = await withParameterDetails(await findExperiment(String(trial.experimentId)));
  return {
    ...trial.toJSON(),
    cropsBySeason: await trialSeasonCrops(experiment, trial),
    experiment,
  };
};

/** Protocol sections the PCU can lock per trial (`trial.locked`), and the fields each covers. */
const LOCKABLE: Record<string, (keyof UpdateTrialDto)[]> = {
  mainPlot: ['mainPlotData'],
  subPlot: ['subPlotData'],
  subSubPlot: ['subSubPlotData'],
  factor1: ['factor1Data'],
  factor2: ['factor2Data'],
  factor3: ['factor3Data'],
  treatments: ['treatments'],
  parameters: ['disabledParameters'],
};

/** A locked section can be changed only by the PCU (research.assign / research.config). */
const assertUnlocked = (ctx: RequestContext, trial: Trial, dto: UpdateTrialDto) => {
  if (hasCapability(ctx.user.roleId, 'research.assign') || hasCapability(ctx.user.roleId, 'research.config'))
    return;
  const locked = Object.entries(LOCKABLE)
    .filter(([key, fields]) => trial.locked?.includes(key) && fields.some((f) => dto[f] !== undefined))
    .map(([key]) => key);
  if (locked.length) {
    throw AppError.conflict(
      'SECTION_LOCKED',
      `Locked by the PCU, ask them to unlock it first: ${locked.join(', ')}`,
    );
  }
};

const validateAgainstProtocol = async (experiment: Experiment, trial: Trial, dto: UpdateTrialDto) => {
  await assertSubPlotSystems(
    { design: experiment.design, subPlotData: dto.subPlotData },
    {
      design: experiment.design,
      seasons: experiment.seasons,
      dataLocked: experiment.dataLocked,
      subPlotData: trial.subPlotData,
    },
    experiment.subPlotData,
  );
  if (dto.seasonCrops) {
    const protocolSeasons = experimentSeasonCodes(experiment);
    const known = await activeMasterCodes('season');
    for (const code of Object.keys(dto.seasonCrops)) {
      if (!known.has(code)) throw AppError.badRequest('UNKNOWN_SEASON', `Unknown season ${code}`);
      if (protocolSeasons.length && !protocolSeasons.includes(code)) {
        throw AppError.badRequest('SEASON_NOT_IN_PROTOCOL', `${code} is not a season of this experiment`);
      }
    }
    const ids = Object.values(dto.seasonCrops).flatMap((v) => v ?? []);
    const items = await masterItemsByIds(ids);
    // A crop already used here (the experiment's or the centre's own) may stay after it was
    // deactivated in the master; only newly chosen crops must be active.
    const inUse = new Set([
      ...[...seasonMap(experiment.seasons).values()].flat(),
      ...[...seasonMap(trial.seasonCrops).values()].flat(),
    ]);
    const bad = [...new Set(ids)].filter((id) => {
      const item = items.get(id);
      return !item || item.type !== 'crop' || (!item.isActive && !inUse.has(id));
    });
    if (bad.length) {
      throw AppError.badRequest('UNKNOWN_CROP', `Not active crops in the crops master: ${bad.join(', ')}`);
    }
  }
  if (dto.croppingSystems) {
    // The master fixes each system's season and crops; the centre fills in how it grows them. A
    // system the trial already has may stay after being deactivated in the master.
    const systems = await croppingSystemsByIds(dto.croppingSystems.map((cs) => cs.croppingSystemId));
    const kept = new Set((trial.croppingSystems ?? []).map((cs) => String(cs.croppingSystemId)));
    for (const cs of dto.croppingSystems) {
      const system = systems.get(cs.croppingSystemId);
      if (!system || (!system.isActive && !kept.has(cs.croppingSystemId))) {
        throw AppError.badRequest(
          'UNKNOWN_CROPPING_SYSTEM',
          `Cropping system ${cs.croppingSystemId} is not an active cropping system in the masters`,
        );
      }
      // The crops sent must be exactly the system's main crop and intercrops (none = not filled in).
      if (!cs.crops.length) continue;
      const expected = [
        `${system.mainCropCode}:main`,
        ...system.intercropCodes.map((c) => `${c}:intercrop`),
      ].sort();
      const sent = cs.crops.map((c) => `${c.cropCode}:${c.role}`).sort();
      if (expected.join() !== sent.join()) {
        throw AppError.badRequest(
          'CROPS_NOT_IN_SYSTEM',
          `The crops must be those of ${system.code}: main ${system.mainCropCode}${
            system.intercropCodes.length ? `, intercrops ${system.intercropCodes.join(', ')}` : ''
          }`,
        );
      }
    }
  }
  if (dto.practices) {
    const codes = new Set(experiment.treatments.map((t) => t.code));
    const unknown = dto.practices.filter((p) => !codes.has(p.treatmentCode)).map((p) => p.treatmentCode);
    if (unknown.length)
      throw AppError.badRequest(
        'UNKNOWN_TREATMENT',
        `Not treatments of this experiment: ${unknown.join(', ')}`,
      );
  }
  if (dto.inChargeUserId) {
    const person = await getOwnProfile(dto.inChargeUserId).catch(() => null);
    if (!person?.isActive || String(person.centreId) !== String(trial.centreId)) {
      throw AppError.badRequest('INVALID_IN_CHARGE', 'The in-charge must be an active member of this centre');
    }
  }
};

export const updateTrial = async (ctx: RequestContext, id: string, dto: UpdateTrialDto) => {
  const trial = await getTrial(ctx, id);
  assertTrialActive(trial);
  const experiment = await findExperiment(String(trial.experimentId));
  if (experiment.status === 'Closed')
    throw AppError.conflict('EXPERIMENT_CLOSED', 'This experiment is closed');
  assertUnlocked(ctx, trial, dto);
  await validateAgainstProtocol(experiment, trial, dto);
  return withTransaction(async (session) => {
    const doc = await TrialModel.findById(id).session(session);
    if (!doc) throw AppError.notFound('TRIAL_NOT_FOUND', 'Trial not found');
    const { seasonCrops, ...rest } = dto;
    const keys = Object.keys(rest);
    // Maps don't survive snapshot(); record the centre's crops as plain objects.
    const cropsBefore = Object.fromEntries(seasonMap(doc.seasonCrops));
    const before = snapshot(doc, keys);
    doc.set({ ...rest, updatedBy: ctx.user.id });
    // Only the seasons sent change; null goes back to the experiment's crops.
    for (const [code, ids] of Object.entries(seasonCrops ?? {})) {
      if (ids === null) doc.seasonCrops.delete(code);
      else doc.seasonCrops.set(code, ids as unknown as Types.ObjectId[]);
    }
    await doc.save({ session });
    const changes = fieldChanges(before, snapshot(doc, keys)) ?? {};
    const cropsAfter = Object.fromEntries(seasonMap(doc.seasonCrops));
    if (JSON.stringify(cropsBefore) !== JSON.stringify(cropsAfter)) {
      // null = no crops of its own (Mongoose would drop an empty object).
      const orNull = (v: object) => (Object.keys(v).length ? v : null);
      changes.seasonCrops = { from: orNull(cropsBefore), to: orNull(cropsAfter) };
    }
    await recordAudit(
      ctx,
      {
        action: `Updated trial setup of ${experiment.code}`,
        module: MODULE,
        entityId: doc.id,
        centreId: String(doc.centreId),
        changes: Object.keys(changes).length ? changes : undefined,
      },
      session,
    );
    return doc;
  });
};

export const toggleTrialLock = async (
  ctx: RequestContext,
  id: string,
  lockedKey: string,
  isLocked: boolean,
) => {
  const trial = await getTrial(ctx, id);
  assertTrialActive(trial);

  return withTransaction(async (session) => {
    const doc = await TrialModel.findById(id).session(session);
    if (!doc) throw AppError.notFound('TRIAL_NOT_FOUND', 'Trial not found');

    const before = [...(doc.locked ?? [])];
    if (isLocked) {
      if (!doc.locked.includes(lockedKey)) {
        doc.locked.push(lockedKey);
      }
    } else {
      doc.locked = doc.locked.filter((k) => k !== lockedKey);
    }

    doc.updatedBy = ctx.user.id as unknown as Types.ObjectId;
    await doc.save({ session });

    await recordAudit(
      ctx,
      {
        action: `${isLocked ? 'Locked' : 'Unlocked'} ${lockedKey} for trial of centre ${doc.centreId}`,
        module: MODULE,
        entityId: id,
        centreId: String(doc.centreId),
        changes: { locked: { from: before, to: doc.locked } },
      },
      session,
    );

    return getTrialDetail(ctx, id);
  });
};

/** For other modules: trials by id. */
export const trialsByIds = async (ids: string[]) =>
  new Map((await TrialModel.find({ _id: trusted({ $in: ids }) })).map((t) => [t.id as string, t]));

/** For other modules: every trial of an experiment (unscoped; callers check access to the experiment). */
export const trialsOfExperiment = (experimentId: string) => TrialModel.find({ experimentId });

/** For the public summary: experiment id → number of centres running it (active trials). */
export const activeTrialCounts = async (experimentIds: string[]): Promise<Map<string, number>> => {
  const rows = await TrialModel.aggregate<{ _id: unknown; count: number }>([
    {
      $match: {
        experimentId: { $in: experimentIds.map((id) => new Types.ObjectId(id)) },
        assignmentStatus: { $ne: 'Withdrawn' },
      },
    },
    { $group: { _id: '$experimentId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
};
