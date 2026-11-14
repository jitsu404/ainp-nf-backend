import type { RequestHandler } from 'express';
import { AppError } from '../utils/AppError.js';

export const notFound: RequestHandler = (req) => {
  throw AppError.notFound('ROUTE_NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`);
};
