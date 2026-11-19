import moment from 'moment';
import { type QueryFilter, trusted } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import type { RequestContext } from '../../utils/context.js';
import { escapeRegex } from '../../utils/validators.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import { generateExperimentCode } from '../counters/counter.model.js';
import { MasterItemModel } from '../masters/masters.model.js';
import { activeMasterCodes } from '../masters/masters.service.js';
import { parametersByIds } from '../parameters/parameters.service.js';
import { findActiveUserById } from '../users/users.service.js';
import type { CreateExperimentDto, ListExperimentsQuery, UpdateExperimentDto } from './experiments.dto.js';
export { DESIGNS_WITH_ANOVA } from './experiments.model.js';
import {
  DESIGNS_NEEDING_REPLICATIONS,
  DESIGNS_WITHOUT_REPLICATIONS,
  type Experiment,
  type ExperimentParameter,
  ExperimentModel,
} from './experiments.model.js';

const MODULE = 'experiments';

export const computeYearDates = (startYear: number, endYear: number) => ({
  startYearDate: moment.utc(String(startYear), 'YYYY').startOf('year').toDate(),
  endYearDate: moment.utc(String(endYear), 'YYYY').endOf('year').toDate(),
});

export const listExperiments = (_ctx: RequestContext, query: ListExperimentsQuery) => {
  const where: QueryFilter<Experiment> = {};
  if (query.programmeCode) where.programmeCode = query.programmeCode;
  if (query.status) where.status = query.status;
  if (query.assignedTo) where.assignedTo = query.assignedTo;
  if (query.startYear) where.startYear = query.startYear;
  if (query.endYear) where.endYear = query.endYear;
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    where.$or = [{ code: pattern }, { title: pattern }];
  }
  return ExperimentModel.find(where)
    .populate('defaultParameters.parameterId')
    .populate('seasons.$*')
    .populate('assignedTo', 'name email roleId centreId designation')
    .populate('createdBy', 'name email roleId')
    .populate('updatedBy', 'name email roleId')
    .sort({ createdAt: -1 })
    .limit(500);
};

export const getExperiment = async (_ctx: RequestContext, id: string) => {
  const experiment = await ExperimentModel.findById(id)
    .populate('defaultParameters.parameterId')
    .populate('seasons.$*')
    .populate('assignedTo', 'name email roleId centreId designation')
    .populate('createdBy', 'name email roleId')
    .populate('updatedBy', 'name email roleId');
  if (!experiment) throw AppError.notFound('EXPERIMENT_NOT_FOUND', 'Experiment not found');
  return experiment;
};

/**
 * For other modules, after they have checked the caller's access another way (e.g. through a
 * trial at the caller's centre). Not scoped by centre.
 */
export const findExperiment = async (id: string) => {
  const experiment = await ExperimentModel.findById(id)
    .populate('defaultParameters.parameterId')
    .populate('seasons.$*')
    .populate('assignedTo', 'name email roleId centreId designation')
    .populate('createdBy', 'name email roleId')
    .populate('updatedBy', 'name email roleId');
  if (!experiment) throw AppError.notFound('EXPERIMENT_NOT_FOUND', 'Experiment not found');
  return experiment;
};

/** The experiment with each parameter's library details attached, for forms and analysis. */
export const getExperimentWithParameters = async (ctx: RequestContext, id: string) =>
  withParameterDetails(await getExperiment(ctx, id));

export const withParameterDetails = async (experiment: Awaited<ReturnType<typeof findExperiment>>) => {
  const defaultParameters = experiment.defaultParameters ?? [];
  const library = await parametersByIds(
    defaultParameters.map((p) => {
      const pid = p.parameterId as unknown as { _id?: unknown };
      return String(pid?._id ?? p.parameterId);
    }),
  );
  const mappedParams = defaultParameters.map((p) => {
    const pid = p.parameterId as unknown as { _id?: unknown };
    const paramId = String(pid?._id ?? p.parameterId);
    const lib = library.get(paramId);
    return {
      // Explicit fields: spreading a Mongoose sub-document does not copy its values.
      section: p.section,
      level: p.level,
      required: p.required,
      parameterId: paramId,
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
    defaultParameters: mappedParams,
    parameters: mappedParams,
  };
};

const validateReferences = async (dto: Partial<CreateExperimentDto>) => {
  if (dto.programmeCode && !(await activeMasterCodes('programme')).has(dto.programmeCode)) {
    throw AppError.badRequest(
      'UNKNOWN_PROGRAMME',
      `Programme ${dto.programmeCode} is not in the programmes master`,
    );
  }
  if (dto.assignedTo) {
    const user = await findActiveUserById(dto.assignedTo);
    if (!user) throw AppError.badRequest('USER_NOT_FOUND', `Assigned user ${dto.assignedTo} not found`);
  }
  if (dto.seasons) {
    const allItemIds = Object.values(dto.seasons).flat();
    if (allItemIds.length > 0) {
      const existingCount = await MasterItemModel.countDocuments({
        _id: trusted({ $in: allItemIds }),
      });
      if (existingCount !== new Set(allItemIds).size) {
        throw AppError.badRequest('UNKNOWN_SEASON_ITEM', 'One or more season master items not found');
      }
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

/** The reference treatment, if set, must be one of the experiment's treatments. */
const assertReferenceTreatment = (code: string | null | undefined, treatments: { code: string }[]) => {
  if (code && !treatments.some((t) => t.code === code)) {
    throw AppError.badRequest(
      'UNKNOWN_REFERENCE_TREATMENT',
      `${code} is not one of this experiment's treatments`,
    );
  }
};

export const createExperiment = async (ctx: RequestContext, dto: CreateExperimentDto) => {
  await validateReferences(dto);
  assertReferenceTreatment(dto.referenceTreatmentCode, dto.treatments ?? []);
  const dates = computeYearDates(dto.startYear, dto.endYear);
  const defaultParameters =
    dto.defaultParameters ?? (dto as { parameters?: typeof dto.defaultParameters }).parameters ?? [];
  return withTransaction(async (session) => {
    const code = await generateExperimentCode(session);
    const [experiment] = await ExperimentModel.create(
      [
        {
          ...dto,
          code,
          defaultParameters,
          ...dates,
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

    const keys = [...new Set([...Object.keys(dto), 'replications', 'startYearDate', 'endYearDate'])];
    const before = snapshot(experiment, keys);

    // Only update dates if startYear or endYear were explicitly sent in the patch
    if (dto.startYear !== undefined || dto.endYear !== undefined) {
      const newStartYear = dto.startYear ?? experiment.startYear;
      const newEndYear = dto.endYear ?? experiment.endYear;
      if (newStartYear && newEndYear && newEndYear < newStartYear) {
        throw AppError.badRequest('INVALID_YEARS', 'endYear must be greater than or equal to startYear');
      }
      if (newStartYear && newEndYear) {
        const dates = computeYearDates(newStartYear, newEndYear);
        experiment.set(dates);
      }
    }

    // Only update fields explicitly provided in dto (the patch)
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined && key !== 'startYearDate' && key !== 'endYearDate') {
        if (key === 'parameters' || key === 'defaultParameters') {
          experiment.defaultParameters = value as unknown as ExperimentParameter[];
          experiment.parameters = value as unknown as ExperimentParameter[];
        } else {
          experiment.set(key, value);
        }
      }
    }
    if (ctx.user.id) {
      experiment.set('updatedBy', ctx.user.id);
    }

    if (dto.design !== undefined && DESIGNS_WITHOUT_REPLICATIONS.includes(experiment.design)) {
      experiment.replications = null;
    }

    if (dto.replications !== undefined || dto.design !== undefined) {
      if (DESIGNS_NEEDING_REPLICATIONS.includes(experiment.design) && (experiment.replications ?? 0) < 2) {
        throw AppError.badRequest(
          'REPLICATIONS_REQUIRED',
          `${experiment.design} needs at least 2 replications`,
        );
      }
    }

    if (dto.treatments !== undefined || dto.referenceTreatmentCode !== undefined) {
      assertReferenceTreatment(experiment.referenceTreatmentCode, experiment.treatments);
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
