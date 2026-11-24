import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { idParams, objectId } from '../../utils/validators.js';
import { COMMUNICATION_TYPES } from './communications.model.js';

const sendBody = z
  .object({
    type: z.enum(COMMUNICATION_TYPES).meta({ example: 'Circular' }),
    subject: z.string().trim().min(3).max(300).meta({ example: 'Submission of Kharif 2026 data' }),
    body: z
      .string()
      .trim()
      .min(1)
      .max(20000)
      .meta({ example: 'All centres are requested to submit the Kharif 2026 observation sheets.' }),
    toAllCentres: z.boolean().optional().meta({ description: 'PCU only: send to every active centre' }),
    centreIds: z
      .array(objectId)
      .max(100)
      .optional()
      .meta({ description: 'PCU only: the centres to send to (when not toAllCentres)' }),
    replyRequired: z.boolean().optional(),
    dueDate: z.coerce.date().nullable().optional(),
  })
  .strict();

const replyBody = z.object({ body: z.string().trim().min(1).max(10000) }).strict();

const threadQuery = z.object({
  centreId: objectId.optional().meta({
    description: "Sender only: which recipient centre's thread. A recipient always uses its own.",
  }),
});

const listQuery = z.object({
  box: z.enum(['inbox', 'sent']).default('inbox'),
  type: z.enum(COMMUNICATION_TYPES).optional(),
  status: z
    .enum(['unread', 'unacknowledged'])
    .optional()
    .meta({ description: 'Inbox only: unread, or not yet acknowledged' }),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const listCommunicationsSchemas = { query: listQuery } satisfies RequestSchemas;
export const getCommunicationSchemas = { params: idParams } satisfies RequestSchemas;
export const sendCommunicationSchemas = { body: sendBody } satisfies RequestSchemas;
export const markCommunicationSchemas = { params: idParams } satisfies RequestSchemas;
export const listRepliesSchemas = { params: idParams, query: threadQuery } satisfies RequestSchemas;
export const replyCommunicationSchemas = {
  params: idParams,
  query: threadQuery,
  body: replyBody,
} satisfies RequestSchemas;

export type SendCommunicationDto = z.output<typeof sendBody>;
export type ListCommunicationsQuery = z.output<typeof listQuery>;
