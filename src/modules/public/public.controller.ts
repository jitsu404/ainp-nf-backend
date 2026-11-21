import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import * as publicService from './public.service.js';

export const summary = async (_req: Request, res: Response) => {
  ok(res, await publicService.publicSummary());
};
