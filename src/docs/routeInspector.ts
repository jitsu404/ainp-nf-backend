import type { RequestHandler, Router } from 'express';
import type { ApiModule } from '../routes.js';
import { type RouteMeta, mergeMeta, readMeta } from './routeMeta.js';

export interface RouteInfo {
  module: ApiModule;
  method: string;
  /** Path inside the module router, Express style (e.g. "/:id"). */
  path: string;
  /** Name of the last handler in the chain: the controller function (e.g. "getById"). */
  handlerName: string;
  meta: RouteMeta;
}

// Minimal view of Express 5's router internals (the `router` package). They are not a public
// API, so this file is the only place that touches them, and tests/postman.test.ts fails
// if a future Express version changes the shape.
interface RouteLayer {
  method?: string;
  handle: RequestHandler;
}
interface StackLayer {
  handle: RequestHandler;
  route?: { path: string; methods: Record<string, boolean>; stack: RouteLayer[] };
}

const stackOf = (router: Router): StackLayer[] => {
  const stack = (router as unknown as { stack?: StackLayer[] }).stack;
  if (!Array.isArray(stack)) throw new Error('Unexpected Express router shape: no stack');
  return stack;
};

/** Lists every route of every module with the metadata its middlewares carry. */
export const collectRoutes = (modules: readonly ApiModule[]): RouteInfo[] =>
  modules.flatMap((module) => {
    const routes: RouteInfo[] = [];
    // router.use(authenticate, …) applies to every route registered after it.
    const inherited: RouteMeta[] = [];

    for (const layer of stackOf(module.router)) {
      if (!layer.route) {
        inherited.push(readMeta(layer.handle));
        continue;
      }
      for (const method of Object.keys(layer.route.methods)) {
        const chain = layer.route.stack.filter((l) => !l.method || l.method === method);
        routes.push({
          module,
          method: method.toUpperCase(),
          path: layer.route.path,
          handlerName: chain.at(-1)?.handle.name ?? '',
          meta: mergeMeta([...inherited, ...chain.map((l) => readMeta(l.handle))]),
        });
      }
    }
    return routes;
  });
