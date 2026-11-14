import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { passwordSchema } from '../users/users.dto.js';

const loginBody = z
  .object({
    email: z.email().trim().toLowerCase().meta({ example: '{{loginEmail}}' }),
    // No strength rules here: just reject empty or absurdly long input.
    password: z.string().min(1, 'Password is required').max(128).meta({ example: '{{loginPassword}}' }),
  })
  .strict();

const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1).max(128).meta({ example: '{{loginPassword}}' }),
    newPassword: passwordSchema.meta({
      example: 'NewPassword2026',
      description: 'At least 10 characters with a letter and a digit',
    }),
  })
  .strict();

export const loginSchemas = { body: loginBody } satisfies RequestSchemas;
export const changePasswordSchemas = { body: changePasswordBody } satisfies RequestSchemas;

export type LoginDto = z.output<typeof loginBody>;
