import { z } from 'zod';
import { ROLE_IDS } from '../../config/constants.js';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { idParams, listQuery, objectId } from '../../utils/validators.js';

/** At least 10 characters with a letter and a digit. */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a digit');

const createUserBody = z
  .object({
    name: z.string().trim().min(2).max(120).meta({ example: 'Dr. A. Sharma' }),
    email: z.email().trim().toLowerCase().meta({ example: 'pi.kanpur@example.com' }),
    password: passwordSchema.meta({ description: 'At least 10 characters with a letter and a digit' }),
    roleId: z.enum(ROLE_IDS).meta({ example: 'pi' }),
    centreId: objectId
      .nullable()
      .default(null)
      .meta({ description: 'Required for pi and dataEntry; ignored for national roles' }),
    designation: z.string().trim().max(120).optional().meta({ example: 'Principal Investigator' }),
  })
  .strict();

const listUsersQuery = listQuery(['name', 'email', 'roleId', 'createdAt']).extend({
  roleId: z.enum(ROLE_IDS).optional(),
  centreId: objectId.optional(),
  isActive: z.stringbool().optional().meta({ description: 'true or false' }),
});

export const listUsersSchemas = { query: listUsersQuery } satisfies RequestSchemas;
export const getUserSchemas = { params: idParams } satisfies RequestSchemas;
export const createUserSchemas = { body: createUserBody } satisfies RequestSchemas;

export type CreateUserDto = z.output<typeof createUserBody>;
export type ListUsersQuery = z.output<typeof listUsersQuery>;
