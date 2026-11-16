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

/** Sends a generated file (e.g. an Excel template) as a download. */
export const sendFile = (res: Response, buffer: Buffer, filename: string, contentType: string): Response => {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
  return res.status(200).send(buffer);
};

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
