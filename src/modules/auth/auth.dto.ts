import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';

const loginBody = z
  .object({
    email: z.email().trim().toLowerCase().meta({ example: '{{loginEmail}}' }),
    // No strength rules here: just reject empty or absurdly long input.
    password: z.string().min(1, 'Password is required').max(128).meta({ example: '{{loginPassword}}' }),
  })
  .strict();

export const loginSchemas = { body: loginBody } satisfies RequestSchemas;

export type LoginDto = z.output<typeof loginBody>;
