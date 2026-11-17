import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { created, noContent, ok } from '../../utils/response.js';
import type {
  activateUserSchemas,
  createUserSchemas,
  deactivateUserSchemas,
  getUserSchemas,
  listUsersSchemas,
  resetPasswordSchemas,
  updateUserSchemas,
} from './users.dto.js';
import * as usersService from './users.service.js';

export const roles = async (_req: Request, res: Response) => {
  ok(res, await usersService.roleSummary());
};

export const list = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof listUsersSchemas>(req);
  const { items, meta } = await usersService.listUsers(contextOf(req), query);
  ok(res, items, meta);
};

export const getById = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getUserSchemas>(req);
  ok(res, await usersService.getUser(contextOf(req), params.id));
};

export const create = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof createUserSchemas>(req);
  created(res, await usersService.createUser(contextOf(req), body));
};

export const update = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof updateUserSchemas>(req);
  ok(res, await usersService.updateUser(contextOf(req), params.id, body));
};

export const deactivate = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof deactivateUserSchemas>(req);
  ok(res, await usersService.deactivateUser(contextOf(req), params.id, body.reason));
};

export const activate = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof activateUserSchemas>(req);
  ok(res, await usersService.activateUser(contextOf(req), params.id));
};

export const resetPassword = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof resetPasswordSchemas>(req);
  await usersService.resetPassword(contextOf(req), params.id, body.temporaryPassword);
  noContent(res);
};
