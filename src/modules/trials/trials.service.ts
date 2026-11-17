import { type QueryFilter, type Types, trusted } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { type RequestContext, withScope } from '../../utils/context.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import { findExperiment, withParameterDetails } from '../experiments/experiments.service.js';
import type { Experiment } from '../experiments/experiments.model.js';
import { activeMasterCodes } from '../masters/masters.service.js';
import { getOwnProfile } from '../users/users.service.js';
import type { ListTrialsQuery, UpdateTrialDto } from './trials.dto.js';
import { type Trial, TrialModel } from './trials.model.js';

const MODULE = 'trials';

const scoped = (ctx: RequestContext, filter: QueryFilter<Trial>) => withScope(ctx.user, filter);

/** Creates the missing trial for every centre the experiment is assigned to. Idempotent. */
export const ensureTrials = async (
  ctx: RequestContext,
  experiment: { id: string; centreIds: Types.ObjectId[] },
) => {
  if (!experiment.centreIds.length) return;
  await TrialModel.bulkWrite(
    experiment.centreIds.map((centreId) => ({
      updateOne: {
        filter: { experimentId: experiment.id, centreId },
        update: {
          $setOnInsert: {
            experimentId: experiment.id,
            centreId,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id,
          },
        },
        upsert: true,
      },
    })),
  );
};

export const listTrials = (ctx: RequestContext, query: ListTrialsQuery) => {
  const where: QueryFilter<Trial> = {};
  if (query.experimentId) where.experimentId = query.experimentId;
  if (query.centreId) where.centreId = query.centreId;
  if (query.status) where.status = query.status;
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

/** The trial together with its experiment protocol (treatments, parameters with library details). */
export const getTrialDetail = async (ctx: RequestContext, id: string) => {
  const trial = await TrialModel.findOne(scoped(ctx, { _id: id })).populate(
    'centreId',
    'code name state host',
  );
  if (!trial) throw AppError.notFound('TRIAL_NOT_FOUND', 'Trial not found');
  // Access was already checked through the trial (scoped to the caller's centre).
  const experiment = await withParameterDetails(await findExperiment(String(trial.experimentId)));
  return { ...trial.toJSON(), experiment };
};

const validateAgainstProtocol = async (experiment: Experiment, trial: Trial, dto: UpdateTrialDto) => {
  if (dto.croppingSystems) {
    const [seasons, crops] = await Promise.all([activeMasterCodes('season'), activeMasterCodes('crop')]);
    for (const cs of dto.croppingSystems) {
      for (const s of cs.seasons) {
        if (!seasons.has(s.seasonCode))
          throw AppError.badRequest('UNKNOWN_SEASON', `Unknown season ${s.seasonCode}`);
        if (experiment.seasons.length && !experiment.seasons.includes(s.seasonCode)) {
          throw AppError.badRequest(
            'SEASON_NOT_IN_PROTOCOL',
            `${s.seasonCode} is not a season of this experiment`,
          );
        }
        for (const crop of [s.mainCropCode, s.intercropCode].filter(Boolean) as string[]) {
          if (!crops.has(crop))
            throw AppError.badRequest('UNKNOWN_CROP', `Crop ${crop} is not in the crops master`);
        }
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
  const experiment = await findExperiment(String(trial.experimentId));
  if (experiment.status === 'Closed')
    throw AppError.conflict('EXPERIMENT_CLOSED', 'This experiment is closed');
  await validateAgainstProtocol(experiment, trial, dto);
  return withTransaction(async (session) => {
    const doc = await TrialModel.findById(id).session(session);
    if (!doc) throw AppError.notFound('TRIAL_NOT_FOUND', 'Trial not found');
    const before = snapshot(doc, Object.keys(dto));
    doc.set({ ...dto, updatedBy: ctx.user.id });
    await doc.save({ session });
    await recordAudit(
      ctx,
      {
        action: `Updated trial setup of ${experiment.code}`,
        module: MODULE,
        entityId: doc.id,
        centreId: String(doc.centreId),
        changes: fieldChanges(before, snapshot(doc, Object.keys(dto))),
      },
      session,
    );
    return doc;
  });
};

/** For other modules: trials by id. */
export const trialsByIds = async (ids: string[]) =>
  new Map((await TrialModel.find({ _id: trusted({ $in: ids }) })).map((t) => [t.id as string, t]));
