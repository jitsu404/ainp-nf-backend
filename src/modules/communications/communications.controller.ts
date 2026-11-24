import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { created, ok, pageMeta } from '../../utils/response.js';
import type {
  getCommunicationSchemas,
  listCommunicationsSchemas,
  listRepliesSchemas,
  markCommunicationSchemas,
  replyCommunicationSchemas,
  sendCommunicationSchemas,
} from './communications.dto.js';
import * as service from './communications.service.js';

export const list = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof listCommunicationsSchemas>(req);
  const { items, total } = await service.listCommunications(contextOf(req), query);
  ok(res, items, pageMeta(query.page, query.limit, total));
};

export const getById = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getCommunicationSchemas>(req);
  ok(res, await service.getCommunication(contextOf(req), params.id));
};

export const create = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof sendCommunicationSchemas>(req);
  const ctx = contextOf(req);
  const doc = await service.sendCommunication(ctx, body);
  created(res, await service.getCommunication(ctx, doc.id as string));
};

export const markRead = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof markCommunicationSchemas>(req);
  ok(res, await service.markRead(contextOf(req), params.id));
};

export const acknowledge = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof markCommunicationSchemas>(req);
  ok(res, await service.acknowledgeCommunication(contextOf(req), params.id));
};

export const replies = async (req: Request, res: Response) => {
  const { params, query } = getValidated<typeof listRepliesSchemas>(req);
  ok(res, await service.listReplies(contextOf(req), params.id, query.centreId));
};

export const reply = async (req: Request, res: Response) => {
  const { params, query, body } = getValidated<typeof replyCommunicationSchemas>(req);
  created(res, await service.replyToCommunication(contextOf(req), params.id, body.body, query.centreId));
};

export const unread = async (req: Request, res: Response) => {
  ok(res, await service.unreadCount(contextOf(req)));
};
