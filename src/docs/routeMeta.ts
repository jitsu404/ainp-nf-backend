import type { RequestHandler } from 'express';
import type { Capability } from '../config/constants.js';
import type { RequestSchemas } from '../middlewares/validate.js';

// Middlewares tag themselves with what they enforce (schemas, capabilities, sign-in), so the
// API docs generator can read a route's real behaviour straight from its handler chain.
// Tagging only attaches a hidden property; it never changes how a request is handled.

const META = Symbol.for('ainp-nf.routeMeta');

export interface RouteDoc {
  /** Request name shown in Postman. Defaults to one derived from the controller name. */
  name?: string;
  /** Markdown description shown in Postman. */
  description?: string;
}

export interface RouteMeta {
  requiresAuth?: boolean;
  /** Each inner array is one authorize() call: the user needs ANY capability in it, and ALL groups. */
  capabilityGroups?: Capability[][];
  schemas?: RequestSchemas;
  doc?: RouteDoc;
}

type Tagged = { [META]?: RouteMeta };

export const readMeta = (handler: unknown): RouteMeta =>
  typeof handler === 'function' ? ((handler as Tagged)[META] ?? {}) : {};

export const tagHandler = <H extends RequestHandler>(handler: H, meta: RouteMeta): H => {
  (handler as Tagged)[META] = meta;
  return handler;
};

/** Merges metadata from several handlers, in chain order. */
export const mergeMeta = (metas: RouteMeta[]): RouteMeta =>
  metas.reduce<RouteMeta>(
    (acc, meta) => ({
      requiresAuth: acc.requiresAuth || meta.requiresAuth || undefined,
      capabilityGroups: [...(acc.capabilityGroups ?? []), ...(meta.capabilityGroups ?? [])],
      schemas: { ...acc.schemas, ...meta.schemas },
      doc: { ...acc.doc, ...meta.doc },
    }),
    {},
  );

/**
 * Optional documentation for a route. Adds a pass-through handler that only carries docs:
 *   router.post('/login', apiDoc({ name: 'Sign in', description: '…' }), validate(...), controller.login)
 */
export const apiDoc = (doc: RouteDoc): RequestHandler => tagHandler((_req, _res, next) => next(), { doc });
