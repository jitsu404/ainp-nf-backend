import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { created, noContent, ok } from '../../utils/response.js';
import type {
  bulkSaveBudgetAllocationsSchemas,
  createBudgetAllocationSchemas,
  deleteBudgetAllocationSchemas,
  getBudgetAllocationSchemas,
  listBudgetAllocationsSchemas,
  updateBudgetAllocationSchemas,
} from './budget-allocation.dto.js';
import * as budgetAllocationService from './budget-allocation.service.js';

/**
 * List budget allocations with optional filters (centre, fy, budgetHead, fundCategory, isTotal).
 * Centre-scoped users (PI, data entry) automatically receive only their centre's records.
 */
export const list = async (req: Request, res: Response): Promise<void> => {
  const { query } = getValidated<typeof listBudgetAllocationsSchemas>(req);
  ok(res, await budgetAllocationService.listBudgetAllocations(contextOf(req), query));
};

/**
 * Get a single budget allocation record by ID.
 */
export const getById = async (req: Request, res: Response): Promise<void> => {
  const { params } = getValidated<typeof getBudgetAllocationSchemas>(req);
  ok(res, await budgetAllocationService.getBudgetAllocation(contextOf(req), params.id));
};

/**
 * Create a new budget allocation record.
 */
export const create = async (req: Request, res: Response): Promise<void> => {
  const { body } = getValidated<typeof createBudgetAllocationSchemas>(req);
  created(res, await budgetAllocationService.createBudgetAllocation(contextOf(req), body));
};

/**
 * Bulk create or update budget allocations in batch (e.g. allocation matrix per centre/FY).
 */
export const bulkSave = async (req: Request, res: Response): Promise<void> => {
  const { body } = getValidated<typeof bulkSaveBudgetAllocationsSchemas>(req);
  ok(res, await budgetAllocationService.bulkSaveBudgetAllocations(contextOf(req), body));
};

/**
 * Update an existing budget allocation record by ID.
 */
export const update = async (req: Request, res: Response): Promise<void> => {
  const { params, body } = getValidated<typeof updateBudgetAllocationSchemas>(req);
  ok(res, await budgetAllocationService.updateBudgetAllocation(contextOf(req), params.id, body));
};

/**
 * Delete a budget allocation record by ID.
 */
export const remove = async (req: Request, res: Response): Promise<void> => {
  const { params } = getValidated<typeof deleteBudgetAllocationSchemas>(req);
  await budgetAllocationService.deleteBudgetAllocation(contextOf(req), params.id);
  noContent(res);
};
