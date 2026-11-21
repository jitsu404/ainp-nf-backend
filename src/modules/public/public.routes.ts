import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import * as controller from './public.controller.js';

export const publicRouter = Router();

// No sign-in: these routes feed the public landing page, so they return only figures that may be
// shown to anyone (see public.service.ts). The general API rate limit still applies.
publicRouter.get(
  '/summary',
  apiDoc({
    name: 'Public summary',
    description:
      'No sign-in needed. The number of active centres and, for each Active experiment, its code, title, programme, design, years and how many centres run it. Used by the landing page.',
  }),
  controller.summary,
);
