import type { ErrorRequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { ZodError, z } from 'zod';
import { isProduction } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

interface NormalizedError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

const hasProp = <K extends string>(value: unknown, key: K): value is Record<K, unknown> =>
  typeof value === 'object' && value !== null && key in value;

/** Maps every kind of thrown error to a status, a stable code and a safe message. */
const normalize = (err: unknown): NormalizedError => {
  if (err instanceof AppError) {
    return { status: err.statusCode, code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: z.flattenError(err),
    };
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const fields = Object.fromEntries(Object.entries(err.errors).map(([path, e]) => [path, e.message]));
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Validation failed', details: { fields } };
  }
  if (err instanceof mongoose.Error.CastError) {
    return { status: 400, code: 'INVALID_ID', message: `Invalid value for ${err.path}` };
  }
  if (hasProp(err, 'code') && err.code === 11000) {
    const keyValue = hasProp(err, 'keyValue') && typeof err.keyValue === 'object' ? err.keyValue : {};
    return {
      status: 409,
      code: 'DUPLICATE',
      message: 'A record with the same value already exists',
      details: { fields: Object.keys(keyValue ?? {}) },
    };
  }
  // TokenExpiredError extends JsonWebTokenError, so check it first.
  if (err instanceof jwt.TokenExpiredError) {
    return { status: 401, code: 'TOKEN_EXPIRED', message: 'Your session has expired, please sign in again' };
  }
  if (err instanceof jwt.JsonWebTokenError) {
    return { status: 401, code: 'INVALID_TOKEN', message: 'Invalid session, please sign in again' };
  }
  if (hasProp(err, 'type') && err.type === 'entity.parse.failed') {
    return { status: 400, code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' };
  }
  if (hasProp(err, 'type') && err.type === 'entity.too.large') {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
};

/** The single global error handler. Registered last in app.ts. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const { status, code, message, details } = normalize(err);
  const stack = err instanceof Error ? err.stack : undefined;
  const meta = { requestId: req.id, method: req.method, url: req.originalUrl, userId: req.user?.id, code };

  if (status >= 500) logger.error(err instanceof Error ? err.message : String(err), { ...meta, stack });
  else logger.warn(message, { ...meta, status });

  res.status(status).json({
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
      requestId: req.id,
      ...(!isProduction && stack && { stack }),
    },
  });
};
