import type { Request, Response } from 'express';
import morgan from 'morgan';
import { isTest } from '../config/env.js';
import { logger } from '../utils/logger.js';

const SKIP_PATHS = new Set(['/health', '/ready']);

/**
 * HTTP access log: one structured line per request, written to logs/http-*.log via winston.
 * It runs when the response finishes, so req.user (set later by authenticate) is available.
 */
export const httpLogger = morgan<Request, Response>(
  (tokens, req, res) =>
    JSON.stringify({
      requestId: req.id,
      method: tokens.method?.(req, res),
      url: tokens.url?.(req, res),
      status: Number(tokens.status?.(req, res)),
      contentLength: tokens.res?.(req, res, 'content-length') ?? null,
      responseTimeMs: Number(tokens['response-time']?.(req, res)),
      ip: req.ip,
      userId: req.user?.id ?? null,
      userAgent: req.get('user-agent') ?? null,
    }),
  {
    skip: (req) => isTest || SKIP_PATHS.has(req.path),
    stream: {
      write: (line: string) => {
        const entry = JSON.parse(line) as { method?: string; url?: string; status?: number };
        logger.http(`${entry.method} ${entry.url} ${entry.status}`, entry);
      },
    },
  },
);
