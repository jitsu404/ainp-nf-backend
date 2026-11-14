import type { Response } from 'express';

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export const pageMeta = (page: number, limit: number, total: number): PageMeta => ({
  page,
  limit,
  total,
  pages: Math.ceil(total / limit),
});

// Every successful response goes through these helpers so the envelope stays consistent:
// { success: true, data, meta? }. Errors are shaped by middlewares/errorHandler.ts.

export const ok = <T>(res: Response, data: T, meta?: PageMeta | Record<string, unknown>): Response =>
  res.status(200).json(meta ? { success: true, data, meta } : { success: true, data });

export const created = <T>(res: Response, data: T): Response => res.status(201).json({ success: true, data });

export const noContent = (res: Response): Response => res.status(204).end();
