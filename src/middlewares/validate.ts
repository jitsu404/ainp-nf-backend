import type { Request, RequestHandler } from 'express';
import { z, type ZodType } from 'zod';
import { tagHandler } from '../docs/routeMeta.js';
import { AppError } from '../utils/AppError.js';

export interface RequestSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/** The parsed output types for a set of request schemas. */
export type Validated<S extends RequestSchemas> = {
  [K in keyof S]: S[K] extends ZodType ? z.output<S[K]> : never;
};

const PARTS = ['params', 'query', 'body'] as const;

/**
 * Validates and coerces the request against Zod DTOs.
 * Parsed values are stored on req.validated (Express 5 makes req.query read-only),
 * so controllers never read raw req.body / req.query.
 */
export const validate = (schemas: RequestSchemas): RequestHandler =>
  tagHandler(
    (req, _res, next) => {
      const errors: Record<string, unknown> = {};

      for (const part of PARTS) {
        const schema = schemas[part];
        if (!schema) continue;
        const result = schema.safeParse(req[part] ?? {});
        if (result.success) req.validated[part] = result.data;
        else errors[part] = z.flattenError(result.error);
      }

      if (Object.keys(errors).length > 0) {
        throw AppError.badRequest('VALIDATION_ERROR', 'Request validation failed', errors);
      }
      next();
    },
    // Lets the API docs generator build example requests from the same schemas.
    { schemas },
  );

/**
 * Typed access to what validate() stored. Pass the same schema object the route used:
 *   const { body } = getValidated<typeof createCentreSchemas>(req);
 */
export const getValidated = <S extends RequestSchemas>(req: Request): Validated<S> =>
  req.validated as Validated<S>;
