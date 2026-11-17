import { type QueryFilter, trusted } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { type RequestContext, withScope } from '../../utils/context.js';
import { escapeRegex } from '../../utils/validators.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import { centreExists } from '../centres/centres.service.js';
import { activeMasterCodes } from '../masters/masters.service.js';
import { parametersByIds } from '../parameters/parameters.service.js';
import type { CreateExperimentDto, ListExperimentsQuery, UpdateExperimentDto } from './experiments.dto.js';
export { DESIGNS_WITH_ANOVA } from './experiments.model.js';
import {
  DESIGNS_NEEDING_REPLICATIONS,
  DESIGNS_WITHOUT_REPLICATIONS,
  type Experiment,
  ExperimentModel,
} from './experiments.model.js';

const MODULE = 'experiments';

/** Centre users only see experiments assigned to their centre. */
const scoped = (ctx: RequestContext, filter: QueryFilter<Experiment>) =>
  withScope(ctx.user, filter, 'centreIds');

export const listExperiments = (ctx: RequestContext, query: ListExperimentsQuery) => {
  const where: QueryFilter<Experiment> = {};
  if (query.programmeCode) where.programmeCode = query.programmeCode;
  if (query.status) where.status = query.status;
  if (query.centreId) where.centreIds = query.centreId;
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    where.$or = [{ code: pattern }, { title: pattern }];
  }
  return ExperimentModel.find(scoped(ctx, where)).sort({ programmeCode: 1, code: 1 }).limit(500);
};

export const getExperiment = async (ctx: RequestContext, id: string) => {
  const experiment = await ExperimentModel.findOne(scoped(ctx, { _id: id }));
  if (!experiment) throw AppError.notFound('EXPERIMENT_NOT_FOUND', 'Experiment not found');
  return experiment;
};

/**
 * For other modules, after they have checked the caller's access another way (e.g. through a
 * trial at the caller's centre). Not scoped by centre.
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
  const library = await parametersByIds(experiment.parameters.map((p) => String(p.parameterId)));
  return {
    ...experiment.toJSON(),
    id: experiment.id as string,
    parameters: experiment.parameters.map((p) => {
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
    }),
  };
};

const validateReferences = async (dto: Partial<CreateExperimentDto>) => {
  if (dto.programmeCode && !(await activeMasterCodes('programme')).has(dto.programmeCode)) {
    throw AppError.badRequest(
      'UNKNOWN_PROGRAMME',
      `Programme ${dto.programmeCode} is not in the programmes master`,
    );
  }
  if (dto.seasons?.length) {
    const seasons = await activeMasterCodes('season');
    const unknown = dto.seasons.filter((s) => !seasons.has(s));
    if (unknown.length)
      throw AppError.badRequest('UNKNOWN_SEASON', `Unknown season(s): ${unknown.join(', ')}`);
  }
  if (dto.parameters?.length) {
    const library = await parametersByIds(dto.parameters.map((p) => p.parameterId));
    const missing = dto.parameters.filter((p) => !library.get(p.parameterId)?.isActive);
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
  if (dto.treatments) {
    const kept = new Set(dto.treatments.map((t) => t.code));
    const removed = existing.treatments.filter((t) => !kept.has(t.code)).map((t) => t.code);
    if (removed.length) problems.push(`treatments ${removed.join(', ')} (they have data)`);
  }
  if (dto.parameters) {
    const kept = new Set(dto.parameters.map((p) => p.parameterId));
    const removed = existing.parameters.filter((p) => !kept.has(String(p.parameterId)));
    if (removed.length) problems.push(`${removed.length} parameter(s) (they may have data)`);
  }
  if (problems.length) {
    throw AppError.conflict(
      'EXPERIMENT_HAS_DATA',
      `Centres have recorded data for this experiment, so you can't change ${problems.join('; ')}. You can still add treatments and parameters.`,
    );
  }
};

export const createExperiment = async (ctx: RequestContext, dto: CreateExperimentDto) => {
  await validateReferences(dto);
  return withTransaction(async (session) => {
    const [experiment] = await ExperimentModel.create(
      [
        {
          ...dto,
          replications: DESIGNS_WITHOUT_REPLICATIONS.includes(dto.design) ? null : (dto.replications ?? null),
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
    return experiment;
  });
};

export const updateExperiment = async (ctx: RequestContext, id: string, dto: UpdateExperimentDto) => {
  await validateReferences(dto);
  return withTransaction(async (session) => {
    const experiment = await ExperimentModel.findById(id).session(session);
    if (!experiment) throw AppError.notFound('EXPERIMENT_NOT_FOUND', 'Experiment not found');
    assertCompatibleWithData(experiment, dto);
    // Replications can change as a side effect of the design, so record them too.
    const keys = [...new Set([...Object.keys(dto), 'replications'])];
    const before = snapshot(experiment, keys);
    experiment.set({ ...dto, updatedBy: ctx.user.id });
    if (DESIGNS_WITHOUT_REPLICATIONS.includes(experiment.design)) experiment.replications = null;
    // The request may change only the design or only the replications; check the result.
    if (DESIGNS_NEEDING_REPLICATIONS.includes(experiment.design) && (experiment.replications ?? 0) < 2) {
      throw AppError.badRequest(
        'REPLICATIONS_REQUIRED',
        `${experiment.design} needs at least 2 replications`,
      );
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

/** Called by the sheets module when the first data is recorded. */
export const markDataLocked = async (experimentId: string): Promise<void> => {
  await ExperimentModel.updateOne({ _id: experimentId, dataLocked: false }, { dataLocked: true });
};

/** For other modules: experiments by id (unscoped; callers check access to the trial instead). */
export const experimentsByIds = async (ids: string[]) =>
  new Map((await ExperimentModel.find({ _id: trusted({ $in: ids }) })).map((e) => [e.id as string, e]));
