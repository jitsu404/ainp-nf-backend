import bcrypt from 'bcryptjs';
import type { QueryFilter } from 'mongoose';
import { ROLES, canAssignRole } from '../../config/constants.js';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import type { RequestContext } from '../../utils/context.js';
import { pageMeta } from '../../utils/response.js';
import { skipFor } from '../../utils/validators.js';
import { recordAudit } from '../audit/audit.service.js';
import { centreExists } from '../centres/centres.service.js';
import { type User, UserModel } from './users.model.js';
import type { CreateUserDto, ListUsersQuery } from './users.dto.js';

export const BCRYPT_COST = 12;

export const hashPassword = (password: string): Promise<string> => bcrypt.hash(password, BCRYPT_COST);

/** Used by authenticate on every request, so a deactivated user loses access immediately. */
export const findActiveUserById = (id: string) => UserModel.findOne({ _id: id, isActive: true });

/** Used by login only: the one query that loads the password hash. */
export const findUserByEmailWithPassword = (email: string) =>
  UserModel.findOne({ email: email.toLowerCase() }).select('+passwordHash');

export const markLoggedIn = async (id: string): Promise<void> => {
  await UserModel.updateOne({ _id: id }, { lastLoginAt: new Date() });
};

export const listUsers = async (query: ListUsersQuery) => {
  const { page, limit, sort, roleId, centreId, isActive } = query;
  const filter: QueryFilter<User> = {};
  if (roleId) filter.roleId = roleId;
  if (centreId) filter.centreId = centreId;
  if (isActive !== undefined) filter.isActive = isActive;

  const [items, total] = await Promise.all([
    UserModel.find(filter)
      .sort(sort ?? 'name')
      .skip(skipFor(page, limit))
      .limit(limit),
    UserModel.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(page, limit, total) };
};

export const getUser = async (id: string) => {
  const user = await UserModel.findById(id);
  if (!user) throw AppError.notFound('USER_NOT_FOUND', 'User not found');
  return user;
};

export const createUser = async (ctx: RequestContext, dto: CreateUserDto) => {
  const { password, ...rest } = dto;
  const centreScoped = ROLES[dto.roleId].scope === 'centre';

  // Stops anyone creating an account more powerful than allowed (e.g. an Administrator creating a
  // Project Coordinator or Super Administrator), and keeps PI / data-entry creation with the PCU.
  if (!canAssignRole(ctx.user.roleId, dto.roleId)) {
    throw AppError.forbidden(
      'ROLE_NOT_ASSIGNABLE',
      `${ROLES[ctx.user.roleId].label} cannot create ${ROLES[dto.roleId].label} accounts`,
    );
  }
  if (centreScoped && !dto.centreId) {
    throw AppError.badRequest('CENTRE_REQUIRED', `${ROLES[dto.roleId].label} must be linked to a centre`);
  }
  if (dto.centreId && !(await centreExists(dto.centreId))) {
    throw AppError.badRequest('CENTRE_NOT_FOUND', 'Centre not found');
  }

  const passwordHash = await hashPassword(password);

  return withTransaction(async (session) => {
    const [user] = await UserModel.create(
      [
        {
          ...rest,
          // National roles are never tied to one centre.
          centreId: centreScoped ? dto.centreId : null,
          passwordHash,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        },
      ],
      { session },
    );
    if (!user) throw new Error('User was not created');
    await recordAudit(
      ctx,
      {
        action: `Created user ${user.email} (${dto.roleId})`,
        module: 'users',
        entityId: user.id,
        centreId: user.centreId?.toString() ?? null,
      },
      session,
    );
    return user;
  });
};
