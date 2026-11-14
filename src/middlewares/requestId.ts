import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const SAFE_ID = /^[\w-]{1,100}$/;

/**
 * Gives every request a correlation id, reusing a well-formed incoming X-Request-Id
 * (e.g. from the load balancer). It appears in logs, error responses and the response header.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.validated = {};
  res.setHeader('X-Request-Id', req.id);
  next();
};
