import { Router } from 'express';
import { apiDoc } from '../../docs/routeMeta.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './communications.controller.js';
import {
  getCommunicationSchemas,
  listCommunicationsSchemas,
  listRepliesSchemas,
  markCommunicationSchemas,
  replyCommunicationSchemas,
  sendCommunicationSchemas,
} from './communications.dto.js';

export const communicationsRouter = Router();

// Everyone with a mailbox: the PCU (comm.issue) and centres (comm.ack).
communicationsRouter.use(authenticate, authorize('comm.issue', 'comm.ack'));

communicationsRouter.get(
  '/unread-count',
  apiDoc({ name: 'Unread count', description: "Inbox items the caller's side hasn't opened yet." }),
  controller.unread,
);
communicationsRouter.get(
  '/',
  apiDoc({
    name: 'List communications',
    description:
      "`box=inbox` (received by the caller's side: the PCU, or the user's centre) or `box=sent`. Filters: type, status (unread / unacknowledged), search (subject, reference, text).",
  }),
  validate(listCommunicationsSchemas),
  controller.list,
);
communicationsRouter.post(
  '/',
  apiDoc({
    name: 'Send communication',
    description:
      'The PCU sends to all active centres (`toAllCentres`) or chosen ones (`centreIds`); a centre sends a Letter or Issue to the PCU. The reference number is generated (AINP-NF/COMM/2026/001).',
  }),
  validate(sendCommunicationSchemas),
  controller.create,
);
communicationsRouter.get(
  '/:id',
  apiDoc({
    name: 'Get communication',
    description:
      'The sender sees every recipient’s read / acknowledged status and reply count; a recipient sees its own.',
  }),
  validate(getCommunicationSchemas),
  controller.getById,
);
communicationsRouter.post(
  '/:id/read',
  apiDoc({ name: 'Mark communication read' }),
  validate(markCommunicationSchemas),
  controller.markRead,
);
communicationsRouter.post(
  '/:id/acknowledge',
  apiDoc({ name: 'Acknowledge communication' }),
  validate(markCommunicationSchemas),
  controller.acknowledge,
);
communicationsRouter.get(
  '/:id/replies',
  apiDoc({
    name: 'List replies',
    description: 'One thread per recipient. The sender passes `centreId` when there are several recipients.',
  }),
  validate(listRepliesSchemas),
  controller.replies,
);
communicationsRouter.post(
  '/:id/replies',
  apiDoc({ name: 'Reply to communication' }),
  validate(replyCommunicationSchemas),
  controller.reply,
);
