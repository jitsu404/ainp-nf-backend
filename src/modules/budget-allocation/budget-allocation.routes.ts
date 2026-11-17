import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './budget-allocation.controller.js';
import {
  bulkSaveBudgetAllocationsSchemas,
  createBudgetAllocationSchemas,
  deleteBudgetAllocationSchemas,
  getBudgetAllocationSchemas,
  listBudgetAllocationsSchemas,
  updateBudgetAllocationSchemas,
} from './budget-allocation.dto.js';

export const budgetAllocationRouter = Router();

// Every signed-in user must be authenticated
budgetAllocationRouter.use(authenticate);

budgetAllocationRouter.get(
  '/',
  authorize('finance.allocation', 'finance.manage'),
  validate(listBudgetAllocationsSchemas),
  apiDoc({
    name: 'List budget allocations',
    description: 'List budget allocations with optional filters (centre, financial year, etc.).',
  }),
  controller.list,
);

budgetAllocationRouter.get(
  '/:id',
  authorize('finance.allocation', 'finance.manage'),
  validate(getBudgetAllocationSchemas),
  apiDoc({
    name: 'Get budget allocation by ID',
    description: 'Retrieve a single budget allocation record by its ID.',
  }),
  controller.getById,
);

budgetAllocationRouter.post(
  '/',
  authorize('finance.allocation', 'finance.manage'),
  validate(createBudgetAllocationSchemas),
  apiDoc({
    name: 'Create budget allocation',
    description: 'Create a new budget allocation record.',
  }),
  controller.create,
);

budgetAllocationRouter.post(
  '/bulk',
  authorize('finance.allocation', 'finance.manage'),
  validate(bulkSaveBudgetAllocationsSchemas),
  apiDoc({
    name: 'Bulk save budget allocations',
    description: 'Batch create or update budget allocations for a centre and financial year.',
  }),
  controller.bulkSave,
);

budgetAllocationRouter.patch(
  '/:id',
  authorize('finance.allocation', 'finance.manage'),
  validate(updateBudgetAllocationSchemas),
  apiDoc({
    name: 'Update budget allocation',
    description: 'Update an existing budget allocation by ID.',
  }),
  controller.update,
);

budgetAllocationRouter.delete(
  '/:id',
  authorize('finance.allocation', 'finance.manage'),
  validate(deleteBudgetAllocationSchemas),
  apiDoc({
    name: 'Delete budget allocation',
    description: 'Remove a budget allocation record by ID.',
  }),
  controller.remove,
);
