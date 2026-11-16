import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './financialYears.controller.js';
import { createFySchemas, listFySchemas, updateFySchemas } from './financialYears.dto.js';

export const financialYearsRouter = Router();

financialYearsRouter.use(authenticate);

financialYearsRouter.get(
  '/',
  apiDoc({ name: 'List financial years' }),
  validate(listFySchemas),
  controller.list,
);
financialYearsRouter.post(
  '/',
  apiDoc({
    name: 'Add financial year',
    description: 'Dates are derived from the code (1 April – 31 March).',
  }),
  authorize('masters.edit'),
  validate(createFySchemas),
  controller.create,
);
financialYearsRouter.patch(
  '/:id',
  apiDoc({
    name: 'Update financial year',
    description:
      '`isOpen: false` closes the year for data entry. `isCurrent: true` makes it the default year.',
  }),
  authorize('masters.edit'),
  validate(updateFySchemas),
  controller.update,
);
