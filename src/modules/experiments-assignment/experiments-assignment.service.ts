import { type QueryFilter, Types, trusted } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { type RequestContext, withScope } from '../../utils/context.js';
import { escapeRegex } from '../../utils/validators.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import { CentreModel } from '../centres/centres.model.js';
import { ExperimentModel } from '../experiments/experiments.model.js';
import { MasterItemModel } from '../masters/masters.model.js';
import { ensureTrials } from '../trials/trials.service.js';
import type {
  BulkAssignExperimentDto,
  CreateExperimentAssignmentDto,
  ListExperimentAssignmentsQuery,
  UpdateExperimentAssignmentDto,
} from './experiments-assignment.dto.js';
import {
  type AssignmentMetaData,
  type ExperimentAssignment,
  ExperimentAssignmentModel,
} from './experiments-assignment.model.js';

const MODULE = 'experiments-assignment';

const scoped = (ctx: RequestContext, filter: QueryFilter<ExperimentAssignment>) =>
  withScope(ctx.user, filter, 'centre');

const validateReferences = async (dto: Partial<CreateExperimentAssignmentDto>) => {
  if (dto.experiment) {
    const experiment = await ExperimentModel.findById(dto.experiment);
    if (!experiment) {
      throw AppError.badRequest('EXPERIMENT_NOT_FOUND', `Experiment ${dto.experiment} not found`);
    }
  }
  if (dto.centre) {
    const centre = await CentreModel.findById(dto.centre);
    if (!centre) {
      throw AppError.badRequest('CENTRE_NOT_FOUND', `Centre ${dto.centre} not found`);
    }
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
};

export const listExperimentAssignments = async (
  ctx: RequestContext,
  query: ListExperimentAssignmentsQuery,
) => {
  const where: QueryFilter<ExperimentAssignment> = {};
  if (query.experiment) where.experiment = query.experiment;
  if (query.centre) where.centre = query.centre;
  if (query.status) where.status = query.status;
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    where.$or = trusted([
      { 'metaData.code': pattern },
      { 'metaData.title': pattern },
      { 'metaData.projectCode': pattern },
      { 'metaData.keywords': pattern },
    ]);
  }

  return ExperimentAssignmentModel.find(scoped(ctx, where))
    .populate('experiment', 'code title programmeCode design status startYear endYear')
    .populate('centre', 'code name state type host hostShort city zone isActive')
    .populate('seasons.$*')
    .populate('lastUpdatedBy', 'name email roleId designation')
    .populate('createdBy', 'name email roleId designation')
    .sort({ createdAt: -1 })
    .limit(500);
};

export const getExperimentAssignmentById = async (ctx: RequestContext, id: string) => {
  const assignment = await ExperimentAssignmentModel.findOne(
    scoped(ctx, { _id: id } as QueryFilter<ExperimentAssignment>),
  )
    .populate('experiment', 'code title programmeCode design status startYear endYear')
    .populate('centre', 'code name state type host hostShort city zone isActive')
    .populate('seasons.$*')
    .populate('lastUpdatedBy', 'name email roleId designation')
    .populate('createdBy', 'name email roleId designation');

  if (!assignment) {
    throw AppError.notFound('ASSIGNMENT_NOT_FOUND', 'Experiment assignment not found');
  }
  return assignment;
};

export const createExperimentAssignment = async (ctx: RequestContext, dto: CreateExperimentAssignmentDto) => {
  if (ctx.user.centreId && String(dto.centre) !== String(ctx.user.centreId)) {
    throw AppError.forbidden('CENTRE_MISMATCH', 'Cannot create assignment for another centre');
  }

  await validateReferences(dto);

  return withTransaction(async (session) => {
    const existing = await ExperimentAssignmentModel.findOne({
      experiment: dto.experiment,
      centre: dto.centre,
    }).session(session);

    if (existing) {
      throw AppError.conflict(
        'ASSIGNMENT_ALREADY_EXISTS',
        'This experiment is already assigned to this centre',
      );
    }

    const [assignment] = await ExperimentAssignmentModel.create(
      [
        {
          ...dto,
          createdBy: ctx.user.id,
          lastUpdatedBy: ctx.user.id,
        },
      ],
      { session },
    );

    if (!assignment) {
      throw new Error('Experiment assignment could not be created');
    }

    await recordAudit(
      ctx,
      {
        action: `Assigned experiment ${dto.experiment} to centre ${dto.centre}`,
        module: MODULE,
        entityId: assignment.id as string,
      },
      session,
    );

    return assignment;
  });
};

export const updateExperimentAssignment = async (
  ctx: RequestContext,
  id: string,
  dto: UpdateExperimentAssignmentDto,
) => {
  if (ctx.user.centreId && dto.centre && String(dto.centre) !== String(ctx.user.centreId)) {
    throw AppError.forbidden('CENTRE_MISMATCH', 'Cannot move assignment to another centre');
  }

  await validateReferences(dto);

  return withTransaction(async (session) => {
    const assignment = await ExperimentAssignmentModel.findOne(
      scoped(ctx, { _id: id } as QueryFilter<ExperimentAssignment>),
    ).session(session);

    if (!assignment) {
      throw AppError.notFound('ASSIGNMENT_NOT_FOUND', 'Experiment assignment not found');
    }

    const nextExperiment = dto.experiment ?? assignment.experiment;
    const nextCentre = dto.centre ?? assignment.centre;

    if (
      (dto.experiment && String(dto.experiment) !== String(assignment.experiment)) ||
      (dto.centre && String(dto.centre) !== String(assignment.centre))
    ) {
      const duplicate = await ExperimentAssignmentModel.findOne({
        _id: { $ne: assignment._id },
        experiment: nextExperiment,
        centre: nextCentre,
      }).session(session);

      if (duplicate) {
        throw AppError.conflict(
          'ASSIGNMENT_ALREADY_EXISTS',
          'This experiment is already assigned to this centre',
        );
      }
    }

    const keys = Object.keys(dto);
    const before = snapshot(assignment, keys);

    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        if (key === 'metaData' && value) {
          const currentMeta = assignment.metaData ?? {};
          assignment.metaData = {
            ...currentMeta,
            ...(value as AssignmentMetaData),
          };
        } else {
          assignment.set(key, value);
        }
      }
    }

    if (ctx.user.id) {
      assignment.set('lastUpdatedBy', ctx.user.id);
    }

    await assignment.save({ session });

    await recordAudit(
      ctx,
      {
        action: `Updated experiment assignment ${assignment.id}`,
        module: MODULE,
        entityId: assignment.id as string,
        changes: fieldChanges(before, snapshot(assignment, keys)),
      },
      session,
    );

    return assignment;
  });
};

export const deleteExperimentAssignment = async (ctx: RequestContext, id: string) => {
  return withTransaction(async (session) => {
    const assignment = await ExperimentAssignmentModel.findOne(
      scoped(ctx, { _id: id } as QueryFilter<ExperimentAssignment>),
    ).session(session);

    if (!assignment) {
      throw AppError.notFound('ASSIGNMENT_NOT_FOUND', 'Experiment assignment not found');
    }

    await assignment.deleteOne({ session });

    await recordAudit(
      ctx,
      {
        action: `Deleted experiment assignment ${assignment.id}`,
        module: MODULE,
        entityId: assignment.id as string,
      },
      session,
    );
  });
};

export const bulkAssignExperiment = async (ctx: RequestContext, dto: BulkAssignExperimentDto) => {
  const experiment = await ExperimentModel.findById(dto.experiment);
  if (!experiment) {
    throw AppError.notFound('EXPERIMENT_NOT_FOUND', `Experiment ${dto.experiment} not found`);
  }

  // Validate all centres and crop items
  const centreIds = dto.assignments.map((a) => a.centre);
  const centres = await CentreModel.find({ _id: trusted({ $in: centreIds }) });
  if (centres.length !== new Set(centreIds).size) {
    throw AppError.badRequest('CENTRE_NOT_FOUND', 'One or more assigned centres not found');
  }

  const allCropIds = dto.assignments.flatMap((a) => (a.seasons ? Object.values(a.seasons).flat() : []));
  if (allCropIds.length > 0) {
    const existingCount = await MasterItemModel.countDocuments({
      _id: trusted({ $in: allCropIds }),
    });
    if (existingCount !== new Set(allCropIds).size) {
      throw AppError.badRequest('UNKNOWN_SEASON_ITEM', 'One or more season master items not found');
    }
  }

  return withTransaction(async (session) => {
    const assignedCentresSet = new Set(centreIds);

    // 1. Upsert active assignments for all selected centres
    for (const item of dto.assignments) {
      await ExperimentAssignmentModel.findOneAndUpdate(
        { experiment: dto.experiment, centre: item.centre },
        {
          $set: {
            seasons: item.seasons ?? {},
            status: item.status ?? 'In progress',
            ...(item.metaData ? { metaData: item.metaData } : {}),
            lastUpdatedBy: ctx.user.id,
          },
          $setOnInsert: {
            createdBy: ctx.user.id,
          },
        },
        { upsert: true, new: true, session },
      );
    }

    // 2. Mark unselected centres as 'inactive'
    await ExperimentAssignmentModel.updateMany(
      {
        experiment: dto.experiment,
        centre: trusted({ $nin: Array.from(assignedCentresSet) }),
        status: trusted({ $ne: 'inactive' }),
      },
      {
        $set: {
          status: 'inactive',
          lastUpdatedBy: ctx.user.id,
        },
      },
      { session },
    );

    // 3. Update experiment.centreIds
    await ExperimentModel.findByIdAndUpdate(
      dto.experiment,
      { $set: { centreIds: centreIds.map((cid) => new Types.ObjectId(cid)) } },
      { session },
    );

    // 4. Ensure trials exist for all assigned centres
    await ensureTrials(ctx, {
      id: dto.experiment,
      centreIds: centreIds.map((cid) => new Types.ObjectId(cid)),
    });

    // 4. Record audit log
    await recordAudit(
      ctx,
      {
        action: `Bulk assigned experiment ${dto.experiment} to ${dto.assignments.length} centres`,
        module: MODULE,
        entityId: dto.experiment,
      },
      session,
    );

    // 5. Return updated list of active assignments
    return ExperimentAssignmentModel.find({
      experiment: dto.experiment,
      centre: trusted({ $in: centreIds }),
    })
      .session(session)
      .populate('experiment', 'code title programmeCode design status startYear endYear')
      .populate('centre', 'code name state type host hostShort city zone isActive')
      .populate('seasons.$*')
      .populate('lastUpdatedBy', 'name email roleId designation')
      .populate('createdBy', 'name email roleId designation');
  });
};
