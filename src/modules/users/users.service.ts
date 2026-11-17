import bcrypt from 'bcryptjs';
import { type ClientSession, type QueryFilter, trusted } from 'mongoose';
import {
  ASSIGNABLE_ROLES,
  CAPABILITY_LABELS,
  CAPABILITY_MODULES,
  ROLES,
  ROLE_IDS,
  type RoleId,
  canAssignRole,
} from '../../config/constants.js';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import type { RequestContext } from '../../utils/context.js';
import { pageMeta } from '../../utils/response.js';
import { skipFor } from '../../utils/validators.js';
import { recordAudit } from '../audit/audit.service.js';
import { centreExists } from '../centres/centres.service.js';
import { type User, UserModel } from './users.model.js';
import type { AssignCentrePiDto, CreateUserDto, ListUsersQuery, UpdateUserDto } from './users.dto.js';

export const BCRYPT_COST = 12;
const MODULE = 'users';

export const hashPassword = (password: string): Promise<string> => bcrypt.hash(password, BCRYPT_COST);

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Lookups used by auth ─────────────────────────────────────────────────────

/** Used by authenticate on every request, so a deactivated user loses access immediately. */
export const findActiveUserById = (id: string) => UserModel.findOne({ _id: id, isActive: true });

/** Used by login only: the one query that loads the password hash. */
export const findUserByEmailWithPassword = (email: string) =>
  UserModel.findOne({ email: email.toLowerCase() }).select('+passwordHash');

export const markLoggedIn = async (id: string): Promise<void> => {
  await UserModel.updateOne({ _id: id }, { lastLoginAt: new Date() });
};

/** The signed-in user changes their own password (also clears "must change password"). */
export const changeOwnPassword = async (
  ctx: RequestContext,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  const user = await UserModel.findById(ctx.user.id).select('+passwordHash');
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw AppError.badRequest('WRONG_PASSWORD', 'Your current password is incorrect');
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw AppError.badRequest('SAME_PASSWORD', 'Choose a password different from the current one');
  }
  await withTransaction(async (session) => {
    await UserModel.updateOne(
      { _id: user.id },
      {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
      { session },
    );
    await recordAudit(ctx, { action: 'Changed own password', module: MODULE, entityId: user.id }, session);
  });
};

// ── Permission helpers ───────────────────────────────────────────────────────

/** A role can manage (edit, deactivate, reset) exactly the roles it is allowed to create. */
const assertCanManage = (ctx: RequestContext, target: RoleId): void => {
  if (!canAssignRole(ctx.user.roleId, target)) {
    throw AppError.forbidden(
      'ROLE_NOT_ASSIGNABLE',
      `${ROLES[ctx.user.roleId].label} cannot manage ${ROLES[target].label} accounts`,
    );
  }
};

/** Loads a user the caller may manage. Others get 404, so their existence isn't revealed. */
const findManageableUser = async (ctx: RequestContext, id: string) => {
  const user = await UserModel.findOne({
    _id: id,
    roleId: trusted({ $in: ASSIGNABLE_ROLES[ctx.user.roleId] }),
  });
  if (!user) throw AppError.notFound('USER_NOT_FOUND', 'User not found');
  return user;
};

const assertNotSelf = (ctx: RequestContext, id: string, action: string): void => {
  if (ctx.user.id === id)
    throw AppError.badRequest('CANNOT_TARGET_SELF', `You cannot ${action} your own account`);
};

const activePiOf = (centreId: string, session?: ClientSession) =>
  UserModel.findOne({ centreId, roleId: 'pi', isActive: true }, null, { session });

// ── Queries ──────────────────────────────────────────────────────────────────

/** Lists only the accounts the caller can manage (PCU: Centre PIs; Super Admin: everyone). */
export const listUsers = async (ctx: RequestContext, query: ListUsersQuery) => {
  const { page, limit, sort, roleId, centreId, isActive, search } = query;
  const manageable = ASSIGNABLE_ROLES[ctx.user.roleId];

  const filter: QueryFilter<User> = { roleId: trusted({ $in: manageable }) };
  if (roleId) filter.roleId = manageable.includes(roleId) ? roleId : trusted({ $in: [] });
  if (centreId) filter.centreId = centreId;
  if (isActive !== undefined) filter.isActive = isActive;
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    filter.$or = ['name', 'email', 'designation', 'mobile', 'organization'].map((field) => ({
      [field]: pattern,
    }));
  }

  const [items, total] = await Promise.all([
    UserModel.find(filter)
      .sort(sort ?? 'name')
      .skip(skipFor(page, limit))
      .limit(limit),
    UserModel.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(page, limit, total) };
};

export const getUser = (ctx: RequestContext, id: string) =>
  ctx.user.id === id ? getOwnProfile(id) : findManageableUser(ctx, id);

export const getOwnProfile = async (id: string) => {
  const user = await UserModel.findById(id);
  if (!user) throw AppError.notFound('USER_NOT_FOUND', 'User not found');
  return user;
};

/** Every Centre PI a centre has had: the active one first, then past PIs, newest first. */
/**
 * Every role with its scope, what it may do (grouped by module) and how many active accounts it
 * has. Read-only overview for the PCU and Super Admin; built from config/constants.ts, so it can't
 * drift from what the server enforces.
 */
export const roleSummary = async () => {
  const counts = await UserModel.aggregate<{ _id: RoleId; n: number }>([
    { $match: { isActive: true } },
    { $group: { _id: '$roleId', n: { $sum: 1 } } },
  ]);
  const activeUsers = new Map(counts.map((c) => [c._id, c.n]));
  return ROLE_IDS.map((id) => ({
    id,
    label: ROLES[id].label,
    scope: ROLES[id].scope,
    activeUsers: activeUsers.get(id) ?? 0,
    manages: ASSIGNABLE_ROLES[id].map((r) => ROLES[r].label),
    capabilities: ROLES[id].capabilities.map((cap) => ({
      id: cap,
      label: CAPABILITY_LABELS[cap],
      module: CAPABILITY_MODULES[cap.split('.')[0]!] ?? 'Other',
    })),
  }));
};

export const listCentrePis = (centreId: string) =>
  UserModel.find({ centreId, roleId: 'pi' }).sort({ isActive: -1, createdAt: -1 });

/** The active PI of each given centre, for showing on centre lists. */
export const activePisForCentres = async (centreIds: string[]) => {
  const pis = await UserModel.find({ centreId: trusted({ $in: centreIds }), roleId: 'pi', isActive: true });
  return new Map(pis.map((pi) => [String(pi.centreId), pi]));
};

// ── Changes ──────────────────────────────────────────────────────────────────

export const createUser = async (ctx: RequestContext, dto: CreateUserDto) => {
  const { temporaryPassword, ...rest } = dto;
  const centreScoped = ROLES[dto.roleId].scope === 'centre';

  assertCanManage(ctx, dto.roleId);
  if (centreScoped && !dto.centreId) {
    throw AppError.badRequest('CENTRE_REQUIRED', `${ROLES[dto.roleId].label} must be linked to a centre`);
  }
  if (centreScoped && dto.centreId && !(await centreExists(dto.centreId))) {
    throw AppError.badRequest('CENTRE_NOT_FOUND', 'Centre not found');
  }
  if (dto.roleId === 'pi' && dto.centreId && (await activePiOf(dto.centreId))) {
    throw AppError.conflict(
      'CENTRE_HAS_PI',
      'This centre already has an active Centre PI. Use "Assign Centre PI" to replace them.',
    );
  }

  const passwordHash = await hashPassword(temporaryPassword);

  return withTransaction(async (session) => {
    const [user] = await UserModel.create(
      [
        {
          ...rest,
          // National roles are never tied to one centre.
          centreId: centreScoped ? dto.centreId : null,
          passwordHash,
          mustChangePassword: true,
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
        action: `Created ${ROLES[dto.roleId].label} account ${user.email}`,
        module: MODULE,
        entityId: user.id,
        centreId: user.centreId?.toString() ?? null,
      },
      session,
    );
    return user;
  });
};

export const updateUser = async (ctx: RequestContext, id: string, dto: UpdateUserDto) => {
  const existing = await findManageableUser(ctx, id);
  return withTransaction(async (session) => {
    // Load-and-save (not findOneAndUpdate) so the model rebuilds `name` from the name parts.
    const user = await UserModel.findById(existing.id).session(session);
    if (!user) throw AppError.notFound('USER_NOT_FOUND', 'User not found');
    user.set({ ...dto, updatedBy: ctx.user.id });
    await user.save({ session });
    await recordAudit(
      ctx,
      {
        action: `Updated ${user.email}`,
        module: MODULE,
        entityId: user.id,
        centreId: user.centreId?.toString() ?? null,
        changes: dto,
      },
      session,
    );
    return user;
  });
};

const deactivate = async (
  ctx: RequestContext,
  user: { id: string; email: string; centreId: unknown },
  reason: string,
  session: ClientSession,
) => {
  await UserModel.updateOne(
    { _id: user.id },
    {
      isActive: false,
      deactivatedAt: new Date(),
      deactivatedBy: ctx.user.id,
      deactivationReason: reason,
      updatedBy: ctx.user.id,
    },
    { session },
  );
  await recordAudit(
    ctx,
    {
      action: `Deactivated ${user.email}: ${reason}`,
      module: MODULE,
      entityId: user.id,
      centreId: user.centreId ? String(user.centreId) : null,
    },
    session,
  );
};

export const deactivateUser = async (ctx: RequestContext, id: string, reason: string) => {
  assertNotSelf(ctx, id, 'deactivate');
  const user = await findManageableUser(ctx, id);
  if (!user.isActive) throw AppError.conflict('ALREADY_INACTIVE', 'This account is already inactive');
  // No "last Super Admin" check needed: only a Super Admin can deactivate one, and never themselves,
  // so at least one always stays active.
  await withTransaction((session) => deactivate(ctx, user, reason, session));
  return getOwnProfile(id);
};

export const activateUser = async (ctx: RequestContext, id: string) => {
  const user = await findManageableUser(ctx, id);
  if (user.isActive) throw AppError.conflict('ALREADY_ACTIVE', 'This account is already active');
  if (user.roleId === 'pi' && user.centreId && (await activePiOf(String(user.centreId)))) {
    throw AppError.conflict(
      'CENTRE_HAS_PI',
      'This centre already has an active Centre PI. Deactivate or replace them first.',
    );
  }
  return withTransaction(async (session) => {
    const updated = await UserModel.findOneAndUpdate(
      { _id: id },
      {
        isActive: true,
        deactivatedAt: null,
        deactivatedBy: null,
        deactivationReason: null,
        updatedBy: ctx.user.id,
      },
      { returnDocument: 'after', session },
    );
    if (!updated) throw AppError.notFound('USER_NOT_FOUND', 'User not found');
    await recordAudit(
      ctx,
      {
        action: `Reactivated ${updated.email}`,
        module: MODULE,
        entityId: updated.id,
        centreId: updated.centreId?.toString() ?? null,
      },
      session,
    );
    return updated;
  });
};

export const resetPassword = async (ctx: RequestContext, id: string, temporaryPassword: string) => {
  assertNotSelf(ctx, id, 'reset the password of');
  const user = await findManageableUser(ctx, id);
  const passwordHash = await hashPassword(temporaryPassword);
  await withTransaction(async (session) => {
    await UserModel.updateOne(
      { _id: user.id },
      { passwordHash, mustChangePassword: true, passwordChangedAt: new Date(), updatedBy: ctx.user.id },
      { session },
    );
    await recordAudit(
      ctx,
      {
        action: `Reset password for ${user.email}`,
        module: MODULE,
        entityId: user.id,
        centreId: user.centreId?.toString() ?? null,
      },
      session,
    );
  });
};

/**
 * Makes `dto` the centre's PI. If the centre already has one, they are deactivated in the same
 * transaction (with the reason), so a centre is never left with zero or two active PIs and the
 * history of who led the centre is kept.
 */
export const assignCentrePi = async (ctx: RequestContext, centreId: string, dto: AssignCentrePiDto) => {
  assertCanManage(ctx, 'pi');
  if (!(await centreExists(centreId))) throw AppError.notFound('CENTRE_NOT_FOUND', 'Centre not found');

  const { temporaryPassword, reason, ...person } = dto;
  const passwordHash = await hashPassword(temporaryPassword);

  return withTransaction(async (session) => {
    const current = await activePiOf(centreId, session);
    if (current) {
      if (!reason) {
        throw AppError.badRequest('REASON_REQUIRED', 'Give a reason for replacing the current Centre PI');
      }
      await deactivate(ctx, current, `Replaced as Centre PI: ${reason}`, session);
    }

    const [pi] = await UserModel.create(
      [
        {
          ...person,
          roleId: 'pi',
          centreId,
          passwordHash,
          mustChangePassword: true,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        },
      ],
      { session },
    );
    if (!pi) throw new Error('Centre PI was not created');
    await recordAudit(
      ctx,
      {
        action: current
          ? `Assigned ${pi.email} as Centre PI, replacing ${current.email}`
          : `Assigned ${pi.email} as Centre PI`,
        module: MODULE,
        entityId: pi.id,
        centreId,
      },
      session,
    );
    return pi;
  });
};
