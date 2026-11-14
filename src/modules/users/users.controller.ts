import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { contextOf } from '../../utils/context.js';
import { created, ok } from '../../utils/response.js';
import type { createUserSchemas, getUserSchemas, listUsersSchemas } from './users.dto.js';
import * as usersService from './users.service.js';

export const list = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof listUsersSchemas>(req);
  const { items, meta } = await usersService.listUsers(query);
  ok(res, items, meta);
};

export const getById = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getUserSchemas>(req);
  ok(res, await usersService.getUser(params.id));
};

export const create = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof createUserSchemas>(req);
  created(res, await usersService.createUser(contextOf(req), body));
};
