import { z } from 'zod';
import { ROLE_IDS } from '../../config/constants.js';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { idParams, listQuery, objectId } from '../../utils/validators.js';
import { TITLES } from './users.names.js';

/** At least 10 characters with a letter and a digit. */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a digit');

const temporaryPassword = passwordSchema.meta({
  description:
    'Password you share with the person. Personal accounts must change it at first sign-in; PI seats keep it until the holder changes it. At least 10 characters with a letter and a digit.',
});

const seatPassword = passwordSchema.meta({
  description:
    'Password for the seat, shared with the person who holds it. They can change it later. At least 10 characters with a letter and a digit.',
});

const namePart = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(60)
    .regex(
      /^[\p{L}][\p{L}\p{M}.' -]*$/u,
      `${label} can contain letters, spaces, dots, apostrophes and hyphens`,
    );

/** Indian mobile number: 10 digits starting 6–9, optionally prefixed +91 / 0, spaces or hyphens allowed. */
const mobile = z
  .string()
  .trim()
  .regex(/^(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}$/, 'Enter a 10-digit mobile number')
  .meta({ example: '+91 98765 43210' });

/**
 * The person's details, as in the PCU master table ("Users" sheet):
 * Title | First Name | Middle Name | Surname | Designation | Email | Mobile | Organization Name.
 * Shared by "create user" and "assign Centre PI". The display name is built from the parts.
 */
export const personFields = {
  title: z.enum(TITLES).meta({ example: 'Dr' }),
  firstName: namePart('First name').meta({ example: 'Sujit' }),
  middleName: namePart('Middle name').optional().meta({ example: 'Kumar' }),
  surname: namePart('Surname')
    .optional()
    .meta({ example: 'Singh', description: 'Leave empty if the person has no surname' }),
  designation: z.string().trim().min(2).max(120).meta({ example: 'Chief Agronomist' }),
  email: z.email().trim().toLowerCase().meta({ example: 'agronomist.knp@example.com' }),
  mobile,
  organization: z.string().trim().min(2).max(200).meta({
    example: 'CSK Himachal Pradesh Krishi Vishwavidyalaya, Palampur',
    description: 'Organization name',
  }),
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
  // Send null to remove a middle name or surname.
  .extend({
    middleName: personFields.middleName.unwrap().nullable().optional(),
    surname: personFields.surname.unwrap().nullable().optional(),
  })
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
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .meta({ description: 'Matches name, email, designation, mobile or organization' }),
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

/** A new Experiment PI seat (pi<n>.npnf@…): the person who holds it and its password. */
const createExperimentPiBody = z.object({ ...personFields, password: seatPassword }).strict();

/** A new person takes over a PI seat; the login stays, the password is replaced. */
const replaceSeatHolderBody = z
  .object({
    ...personFields,
    password: seatPassword,
    reason: z.string().trim().min(3).max(300).meta({ example: 'Transferred to another institute' }),
  })
  .strict();

/** The person's details alone (for seat holders). */
export const personSchema = z.object(personFields);

export const listUsersSchemas = { query: listUsersQuery } satisfies RequestSchemas;
export const getUserSchemas = { params: idParams } satisfies RequestSchemas;
export const createUserSchemas = { body: createUserBody } satisfies RequestSchemas;
export const updateUserSchemas = { params: idParams, body: updateUserBody } satisfies RequestSchemas;
export const deactivateUserSchemas = { params: idParams, body: deactivateBody } satisfies RequestSchemas;
export const activateUserSchemas = { params: idParams } satisfies RequestSchemas;
export const resetPasswordSchemas = { params: idParams, body: resetPasswordBody } satisfies RequestSchemas;
export const centrePisSchemas = { params: idParams } satisfies RequestSchemas;
export const assignCentrePiSchemas = { params: idParams, body: assignCentrePiBody } satisfies RequestSchemas;

export const createExperimentPiSchemas = { body: createExperimentPiBody } satisfies RequestSchemas;
export const replaceSeatHolderSchemas = {
  params: idParams,
  body: replaceSeatHolderBody,
} satisfies RequestSchemas;
export const experimentPiSchemas = { params: idParams } satisfies RequestSchemas;

export type PersonDto = z.output<typeof personSchema>;
export type CreateExperimentPiDto = z.output<typeof createExperimentPiBody>;
export type ReplaceSeatHolderDto = z.output<typeof replaceSeatHolderBody>;
export type CreateUserDto = z.output<typeof createUserBody>;
export type UpdateUserDto = z.output<typeof updateUserBody>;
export type ListUsersQuery = z.output<typeof listUsersQuery>;
export type AssignCentrePiDto = z.output<typeof assignCentrePiBody>;
