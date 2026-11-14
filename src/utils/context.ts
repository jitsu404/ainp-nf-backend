import type { Request } from 'express';
import type { AuthUser } from '../types/express.js';
import { ROLES } from '../config/constants.js';
import { AppError } from './AppError.js';

/** What a service needs to know about the caller: who they are, plus ids for auditing. */
export interface RequestContext {
  user: AuthUser;
  requestId: string;
  ip: string | undefined;
}

/** Builds the service context from an authenticated request. */
export const contextOf = (req: Request): RequestContext => {
  if (!req.user) throw AppError.unauthorized();
  return { user: req.user, requestId: req.id, ip: req.ip };
};

export const isCentreScoped = (user: AuthUser): boolean => ROLES[user.roleId].scope === 'centre';

/**
 * Query filter that limits centre-level roles (PI, data entry) to their own centre.
 * National roles get an empty filter and see everything. Prefer withScope() in services.
 */
export const scopeFilter = (user: AuthUser, field = 'centreId'): Record<string, string> => {
  if (!isCentreScoped(user)) return {};
  if (!user.centreId) throw AppError.forbidden('NO_CENTRE', 'Your account is not linked to a centre');
  return { [field]: user.centreId };
};

/**
 * Applies the centre scope to a query filter. Use it for every find/count/update in services:
 *   Model.find(withScope(ctx.user, { status: 'Draft' }))
 * The two filters are joined with $and rather than spread together, so a key in one
 * (e.g. `_id`) can never silently overwrite the same key in the other.
 */
export const withScope = <F extends object>(user: AuthUser, filter: F, field = 'centreId'): F => {
  const scope = scopeFilter(user, field);
  return (Object.keys(scope).length === 0 ? filter : { $and: [filter, scope] }) as F;
};
