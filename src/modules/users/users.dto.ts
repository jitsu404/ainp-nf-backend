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

const temporaryPassword = passwordSchema.meta({
  description:
    'Temporary password you share with the person. They must change it at first sign-in. At least 10 characters with a letter and a digit.',
});

/** The person's own details, shared by "create user" and "assign Centre PI". */
export const personFields = {
  name: z.string().trim().min(2).max(120).meta({ example: 'Dr. A. Sharma' }),
  email: z.email().trim().toLowerCase().meta({ example: 'agronomist.knp@example.com' }),
  designation: z.string().trim().max(120).optional().meta({ example: 'Chief Agronomist' }),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s-]{7,20}$/, 'Enter a valid phone number')
    .optional()
    .meta({ example: '+91 98765 43210' }),
};

const createUserBody = z
  .object({
    ...personFields,
    temporaryPassword,
    roleId: z.enum(ROLE_IDS).meta({ example: 'pc' }),
    centreId: objectId
      .nullable()
      .default(null)
      .meta({ description: 'Required for Centre PI; ignored for national roles' }),
  })
  .strict();

const updateUserBody = z
  .object(personFields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update' });

const deactivateBody = z
  .object({
    reason: z.string().trim().min(3).max(300).meta({ example: 'Transferred to another institute' }),
  })
  .strict();

const resetPasswordBody = z.object({ temporaryPassword }).strict();

const listUsersQuery = listQuery(['name', 'email', 'roleId', 'createdAt']).extend({
  roleId: z.enum(ROLE_IDS).optional(),
  centreId: objectId.optional(),
  isActive: z.stringbool().optional().meta({ description: 'true or false' }),
  search: z.string().trim().max(100).optional().meta({ description: 'Matches name, email or designation' }),
});

/** Assign the Centre PI, replacing the current one if there is one. */
const assignCentrePiBody = z
  .object({
    ...personFields,
    temporaryPassword,
    reason: z
      .string()
      .trim()
      .min(3)
      .max(300)
      .optional()
      .meta({ description: 'Why the current PI is being replaced (required when there is one)' }),
  })
  .strict();

export const listUsersSchemas = { query: listUsersQuery } satisfies RequestSchemas;
export const getUserSchemas = { params: idParams } satisfies RequestSchemas;
export const createUserSchemas = { body: createUserBody } satisfies RequestSchemas;
export const updateUserSchemas = { params: idParams, body: updateUserBody } satisfies RequestSchemas;
export const deactivateUserSchemas = { params: idParams, body: deactivateBody } satisfies RequestSchemas;
export const activateUserSchemas = { params: idParams } satisfies RequestSchemas;
export const resetPasswordSchemas = { params: idParams, body: resetPasswordBody } satisfies RequestSchemas;
export const centrePisSchemas = { params: idParams } satisfies RequestSchemas;
export const assignCentrePiSchemas = { params: idParams, body: assignCentrePiBody } satisfies RequestSchemas;

export type CreateUserDto = z.output<typeof createUserBody>;
export type UpdateUserDto = z.output<typeof updateUserBody>;
export type ListUsersQuery = z.output<typeof listUsersQuery>;
export type AssignCentrePiDto = z.output<typeof assignCentrePiBody>;
