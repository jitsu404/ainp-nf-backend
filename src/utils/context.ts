import type { Request } from 'express';
import { trusted } from 'mongoose';
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

export const isExperimentScoped = (user: AuthUser): boolean => ROLES[user.roleId].scope === 'experiment';
export const isNational = (user: AuthUser): boolean => ROLES[user.roleId].scope === 'national';

/**
 * Query filter that limits a scoped role to its own records. National roles get an empty filter.
 *   centre scope (Centre PI):          { [centreField]: user.centreId }
 *   experiment scope (Experiment PI):  { [experimentField]: { $in: user.experimentIds } }
 * Pass experimentField = null for collections an Experiment PI may read in full (centres).
 * The default fails closed: a collection without `experimentId` returns nothing for them.
 * Prefer withScope() in services.
 */
export const scopeFilter = (
  user: AuthUser,
  centreField = 'centreId',
  experimentField: string | null = 'experimentId',
): Record<string, unknown> => {
  const scope = ROLES[user.roleId].scope;
  if (scope === 'experiment') {
    return experimentField ? { [experimentField]: trusted({ $in: user.experimentIds }) } : {};
  }
  if (scope !== 'centre') return {};
  if (!user.centreId) throw AppError.forbidden('NO_CENTRE', 'Your account is not linked to a centre');
  return { [centreField]: user.centreId };
};

/**
 * Applies the scope to a query filter. Use it for every find/count/update in services:
 *   Model.find(withScope(ctx.user, { status: 'Draft' }))
 * The two filters are joined with $and rather than spread together, so a key in one
 * (e.g. `_id`) can never silently overwrite the same key in the other.
 */
export const withScope = <F extends object>(
  user: AuthUser,
  filter: F,
  centreField = 'centreId',
  experimentField: string | null = 'experimentId',
): F => {
  const scope = scopeFilter(user, centreField, experimentField);
  return (Object.keys(scope).length === 0 ? filter : { $and: [filter, scope] }) as F;
};
