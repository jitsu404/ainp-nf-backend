import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './croppingSystems.controller.js';
import {
  createCroppingSystemSchemas,
  getCroppingSystemSchemas,
  listCroppingSystemsSchemas,
  updateCroppingSystemSchemas,
} from './croppingSystems.dto.js';

export const croppingSystemsRouter = Router();

croppingSystemsRouter.use(authenticate);

croppingSystemsRouter.get(
  '/',
  apiDoc({ name: 'List cropping systems', description: '`isActive=true` for the ones that can be chosen.' }),
  validate(listCroppingSystemsSchemas),
  controller.list,
);
croppingSystemsRouter.get(
  '/:id',
  apiDoc({ name: 'Get cropping system' }),
  validate(getCroppingSystemSchemas),
  controller.get,
);
croppingSystemsRouter.post(
  '/',
  apiDoc({
    name: 'Add cropping system',
    description:
      'One season, its main crop and up to 5 intercrops (crop master codes). Several systems may share a season and main crop. The code is generated (CSY-001 …); the name is made from the crops when left out, and then follows them on later edits.',
  }),
  authorize('masters.edit'),
  validate(createCroppingSystemSchemas),
  controller.create,
);
croppingSystemsRouter.patch(
  '/:id',
  apiDoc({
    name: 'Update cropping system',
    description: '`isActive: false` hides it from new choices; experiments and trials using it keep it.',
  }),
  authorize('masters.edit'),
  validate(updateCroppingSystemSchemas),
  controller.update,
);
