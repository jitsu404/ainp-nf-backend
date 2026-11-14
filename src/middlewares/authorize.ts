import type { RequestHandler } from 'express';
import { type Capability, hasCapability } from '../config/constants.js';
import { tagHandler } from '../docs/routeMeta.js';
import { AppError } from '../utils/AppError.js';

/**
 * Role-based access control. Allows the request if the user's role has at least one
 * of the listed capabilities. Use after `authenticate`:
 *   router.post('/', authenticate, authorize('masters.edit'), validate(...), controller.create)
 *
 * Centre-level restrictions (PI / data entry only see their own centre) are enforced
 * in services with withScope(), because they depend on the record, not just the route.
 */
export const authorize = (...capabilities: [Capability, ...Capability[]]): RequestHandler =>
  tagHandler(
    (req, _res, next) => {
      const user = req.user;
      if (!user) throw AppError.unauthorized();
      if (!capabilities.some((capability) => hasCapability(user.roleId, capability))) {
        throw AppError.forbidden();
      }
      next();
    },
    { capabilityGroups: [capabilities] },
  );
