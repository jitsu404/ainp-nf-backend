import { type QueryFilter, Types } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { type RequestContext, withScope } from '../../utils/context.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import type {
  BulkSaveBudgetAllocationDto,
  CreateBudgetAllocationDto,
  ListBudgetAllocationsQuery,
  UpdateBudgetAllocationDto,
} from './budget-allocation.dto.js';
import { BudgetAllocationModel, type BudgetAllocationType } from './budget-allocation.model.js';

const MODULE = 'budget-allocation';

const scoped = (ctx: RequestContext, filter: QueryFilter<BudgetAllocationType>) =>
  withScope(ctx.user, filter, 'centre');

export const listBudgetAllocations = async (ctx: RequestContext, query: ListBudgetAllocationsQuery) => {
  const where: QueryFilter<BudgetAllocationType> = {};
  if (query.centre) where.centre = new Types.ObjectId(query.centre);
  if (query.fy) where.fy = new Types.ObjectId(query.fy);
  if (query.budgetHead) where.budgetHead = new Types.ObjectId(query.budgetHead);
  if (query.fundCategory) where.fundCategory = new Types.ObjectId(query.fundCategory);
  if (query.isTotal !== undefined) where.isTotal = query.isTotal;

  return BudgetAllocationModel.find(scoped(ctx, where))
    .populate('centre', 'name code state type host hostShort city')
    .populate('fy', 'code startDate endDate isOpen isCurrent')
    .populate('budgetHead', 'name code group sortOrder')
    .populate('fundCategory', 'name code sortOrder')
    .sort({ centre: 1, budgetHead: 1, fundCategory: 1, createdAt: -1 })
    .limit(2000);
};

export const getBudgetAllocation = async (ctx: RequestContext, id: string) => {
  const record = await BudgetAllocationModel.findOne(scoped(ctx, { _id: new Types.ObjectId(id) }))
    .populate('centre', 'name code state type host hostShort city')
    .populate('fy', 'code startDate endDate isOpen isCurrent')
    .populate('budgetHead', 'name code group sortOrder')
    .populate('fundCategory', 'name code sortOrder');

  if (!record) {
    throw AppError.notFound('BUDGET_ALLOCATION_NOT_FOUND', 'Budget allocation not found');
  }
  return record;
};

export const createBudgetAllocation = async (ctx: RequestContext, dto: CreateBudgetAllocationDto) =>
  withTransaction(async (session) => {
    if (!dto.isTotal) {
      if (!dto.budgetHead) {
        throw AppError.badRequest('BUDGET_HEAD_REQUIRED', 'Budget head is required for head allocation');
      }
      if (!dto.fundCategory) {
        throw AppError.badRequest('FUND_CATEGORY_REQUIRED', 'Fund category is required for head allocation');
      }
    }

    if (ctx.user.roleId === 'pi') {
      if (dto.centre.toString() !== ctx.user.centreId) {
        throw AppError.forbidden('CENTRE_MISMATCH', 'You can only allocate budget for your own centre');
      }
      if (dto.isTotal) {
        throw AppError.forbidden(
          'CANNOT_SET_TOTAL',
          'Only PCU and Super Admin can manage total budget allocation',
        );
      }
    }

    const existing = await BudgetAllocationModel.findOne({
      centre: dto.centre,
      fy: dto.fy,
      budgetHead: dto.budgetHead ?? null,
      fundCategory: dto.fundCategory ?? null,
      isTotal: dto.isTotal ?? false,
    }).session(session);

    if (existing) {
      throw AppError.conflict(
        'ALLOCATION_EXISTS',
        'A budget allocation already exists for this centre, financial year, and head/category',
      );
    }

    const [created] = await BudgetAllocationModel.create(
      [
        {
          centre: dto.centre,
          fy: dto.fy,
          amount: dto.amount,
          isTotal: dto.isTotal,
          budgetHead: dto.budgetHead ?? null,
          fundCategory: dto.fundCategory ?? null,
        },
      ],
      { session },
    );
    if (!created) {
      throw new Error('Budget allocation was not created');
    }

    await recordAudit(
      ctx,
      {
        action: 'Created budget allocation',
        module: MODULE,
        entityId: created.id,
        centreId: dto.centre,
        details: {
          centre: dto.centre,
          fy: dto.fy,
          amount: dto.amount,
          isTotal: dto.isTotal,
          budgetHead: dto.budgetHead,
          fundCategory: dto.fundCategory,
        },
      },
      session,
    );

    return BudgetAllocationModel.findById(created._id)
      .populate('centre', 'name code state type host hostShort city')
      .populate('fy', 'code startDate endDate isOpen isCurrent')
      .populate('budgetHead', 'name code group sortOrder')
      .populate('fundCategory', 'name code sortOrder')
      .session(session);
  });

export const bulkSaveBudgetAllocations = async (ctx: RequestContext, dto: BulkSaveBudgetAllocationDto) => {
  let defaultCentre: string | undefined;
  let defaultFy: string | undefined;
  let rawItems: Array<{
    centre?: string;
    fy?: string;
    budgetHead?: string | null;
    fundCategory?: string | null;
    amount: number;
    isTotal: boolean;
  }> = [];

  if (Array.isArray(dto)) {
    rawItems = dto;
  } else if ('allocations' in dto) {
    defaultCentre = dto.centre;
    defaultFy = dto.fy;
    rawItems = dto.allocations;
  } else if ('items' in dto) {
    defaultCentre = dto.centre;
    defaultFy = dto.fy;
    rawItems = dto.items;
  }

  if (!rawItems.length) {
    throw AppError.badRequest('EMPTY_PAYLOAD', 'No allocation items provided');
  }

  if (ctx.user.roleId === 'pi') {
    if (defaultCentre && defaultCentre !== ctx.user.centreId) {
      throw AppError.forbidden('CENTRE_MISMATCH', 'You can only allocate budget for your own centre');
    }
  }

  const items = rawItems.map((item) => {
    const centre = item.centre || defaultCentre;
    const fy = item.fy || defaultFy;
    if (!centre) {
      throw AppError.badRequest('CENTRE_REQUIRED', 'Each allocation must specify a centre');
    }
    if (!fy) {
      throw AppError.badRequest('FY_REQUIRED', 'Each allocation must specify a financial year');
    }
    if (ctx.user.roleId === 'pi') {
      if (centre !== ctx.user.centreId) {
        throw AppError.forbidden('CENTRE_MISMATCH', 'You can only allocate budget for your own centre');
      }
      if (item.isTotal) {
        throw AppError.forbidden(
          'CANNOT_SET_TOTAL',
          'Only PCU and Super Admin can manage total budget allocation',
        );
      }
    }
    if (!item.isTotal) {
      if (!item.budgetHead) {
        throw AppError.badRequest('BUDGET_HEAD_REQUIRED', 'Budget head is required for head allocation');
      }
      if (!item.fundCategory) {
        throw AppError.badRequest('FUND_CATEGORY_REQUIRED', 'Fund category is required for head allocation');
      }
    }
    return {
      centre: new Types.ObjectId(centre),
      fy: new Types.ObjectId(fy),
      budgetHead: item.budgetHead ? new Types.ObjectId(item.budgetHead) : null,
      fundCategory: item.fundCategory ? new Types.ObjectId(item.fundCategory) : null,
      amount: Number(item.amount) || 0,
      isTotal: Boolean(item.isTotal),
    };
  });

  return withTransaction(async (session) => {
    const results = [];
    for (const item of items) {
      const updated = await BudgetAllocationModel.findOneAndUpdate(
        {
          centre: item.centre,
          fy: item.fy,
          budgetHead: item.budgetHead,
          fundCategory: item.fundCategory,
          isTotal: item.isTotal,
        },
        {
          $set: {
            amount: item.amount,
          },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
          session,
        },
      )
        .populate('centre', 'name code state type host hostShort city')
        .populate('fy', 'code startDate endDate isOpen isCurrent')
        .populate('budgetHead', 'name code group sortOrder')
        .populate('fundCategory', 'name code sortOrder');

      results.push(updated);
    }

    await recordAudit(
      ctx,
      {
        action: 'Bulk saved budget allocations',
        module: MODULE,
        centreId: defaultCentre ?? null,
        details: { count: results.length, centre: defaultCentre, fy: defaultFy },
      },
      session,
    );

    return results;
  });
};

export const updateBudgetAllocation = async (
  ctx: RequestContext,
  id: string,
  dto: UpdateBudgetAllocationDto,
) =>
  withTransaction(async (session) => {
    const existing = await BudgetAllocationModel.findOne(
      scoped(ctx, { _id: new Types.ObjectId(id) }),
    ).session(session);

    if (!existing) {
      throw AppError.notFound('BUDGET_ALLOCATION_NOT_FOUND', 'Budget allocation not found');
    }

    if (ctx.user.roleId === 'pi') {
      if (existing.centre.toString() !== ctx.user.centreId) {
        throw AppError.forbidden('CENTRE_MISMATCH', 'You can only update allocations for your own centre');
      }
      if (existing.isTotal || dto.isTotal) {
        throw AppError.forbidden(
          'CANNOT_SET_TOTAL',
          'Only PCU and Super Admin can modify total budget allocation',
        );
      }
    }

    const willBeTotal = dto.isTotal !== undefined ? dto.isTotal : existing.isTotal;
    if (!willBeTotal) {
      const finalHead = dto.budgetHead !== undefined ? dto.budgetHead : existing.budgetHead;
      const finalCategory = dto.fundCategory !== undefined ? dto.fundCategory : existing.fundCategory;
      if (!finalHead) {
        throw AppError.badRequest('BUDGET_HEAD_REQUIRED', 'Budget head is required for head allocation');
      }
      if (!finalCategory) {
        throw AppError.badRequest('FUND_CATEGORY_REQUIRED', 'Fund category is required for head allocation');
      }
    }

    const trackedKeys = ['amount', 'isTotal', 'budgetHead', 'fundCategory', 'centre', 'fy'] as const;
    const before = snapshot(existing.toObject(), trackedKeys);

    if (dto.amount !== undefined) existing.amount = dto.amount;
    if (dto.isTotal !== undefined) existing.isTotal = dto.isTotal;
    if (dto.budgetHead !== undefined) {
      existing.budgetHead = dto.budgetHead ? new Types.ObjectId(dto.budgetHead) : null;
    }
    if (dto.fundCategory !== undefined) {
      existing.fundCategory = dto.fundCategory ? new Types.ObjectId(dto.fundCategory) : null;
    }
    if (dto.centre !== undefined) {
      existing.centre = new Types.ObjectId(dto.centre);
    }
    if (dto.fy !== undefined) {
      existing.fy = new Types.ObjectId(dto.fy);
    }

    await existing.save({ session });
    const after = snapshot(existing.toObject(), trackedKeys);

    await recordAudit(
      ctx,
      {
        action: 'Updated budget allocation',
        module: MODULE,
        entityId: existing.id,
        centreId: existing.centre.toString(),
        changes: fieldChanges(before, after),
      },
      session,
    );

    return BudgetAllocationModel.findById(existing._id)
      .populate('centre', 'name code state type host hostShort city')
      .populate('fy', 'code startDate endDate isOpen isCurrent')
      .populate('budgetHead', 'name code group sortOrder')
      .populate('fundCategory', 'name code sortOrder')
      .session(session);
  });

export const deleteBudgetAllocation = async (ctx: RequestContext, id: string) =>
  withTransaction(async (session) => {
    const existing = await BudgetAllocationModel.findOne(
      scoped(ctx, { _id: new Types.ObjectId(id) }),
    ).session(session);

    if (!existing) {
      throw AppError.notFound('BUDGET_ALLOCATION_NOT_FOUND', 'Budget allocation not found');
    }

    if (ctx.user.roleId === 'pi') {
      if (existing.centre.toString() !== ctx.user.centreId) {
        throw AppError.forbidden('CENTRE_MISMATCH', 'You can only delete allocations for your own centre');
      }
      if (existing.isTotal) {
        throw AppError.forbidden(
          'CANNOT_SET_TOTAL',
          'Only PCU and Super Admin can delete total budget allocation',
        );
      }
    }

    await BudgetAllocationModel.findByIdAndDelete(existing._id, { session });

    await recordAudit(
      ctx,
      {
        action: 'Deleted budget allocation',
        module: MODULE,
        entityId: existing.id,
        centreId: existing.centre.toString(),
        details: {
          amount: existing.amount,
          budgetHead: existing.budgetHead,
          fundCategory: existing.fundCategory,
          isTotal: existing.isTotal,
        },
      },
      session,
    );
  });
