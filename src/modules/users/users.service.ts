import bcrypt from 'bcryptjs';
import { type ClientSession, type HydratedDocument, type QueryFilter, Types, trusted } from 'mongoose';
import {
  ASSIGNABLE_ROLES,
  CAPABILITY_LABELS,
  CAPABILITY_MODULES,
  ROLES,
  ROLE_IDS,
  type RoleId,
  canAssignRole,
  centrePiEmail,
  experimentPiEmail,
} from '../../config/constants.js';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import type { RequestContext } from '../../utils/context.js';
import { pageMeta } from '../../utils/response.js';
import { skipFor } from '../../utils/validators.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import { centresByIds } from '../centres/centres.service.js';
import { type User, UserModel } from './users.model.js';
import type {
  AssignCentrePiDto,
  CreateExperimentPiDto,
  CreateUserDto,
  ListUsersQuery,
  PersonDto,
  ReplaceSeatHolderDto,
  UpdateUserDto,
} from './users.dto.js';

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

/**
 * Everyone who has led a centre, current holder first, then past ones by when they left.
 * Centre PIs are seats (one login, several holders over time); accounts from before seats
 * existed are one person each.
 */
export const listCentrePis = async (centreId: string) => {
  const accounts = await UserModel.find({ centreId, roleId: 'pi' });
  return accounts
    .flatMap((a) => seatHistory(a))
    .sort((x, y) => Number(y.isCurrent) - Number(x.isCurrent) || +(y.to ?? 0) - +(x.to ?? 0));
};

/** One entry per person who held the account: the current holder (if active) and past ones. */
export const seatHistory = (a: HydratedDocument<User>) => [
  {
    accountId: a.id as string,
    loginEmail: a.email,
    name: a.name,
    designation: a.designation ?? null,
    email: contactEmailOf(a),
    mobile: a.mobile ?? null,
    organization: a.organization ?? null,
    from: a.occupiedSince ?? a.createdAt,
    to: a.isActive ? null : (a.deactivatedAt ?? null),
    reason: a.isActive ? null : (a.deactivationReason ?? null),
    isCurrent: a.isActive,
  },
  ...a.pastOccupants.map((o) => ({
    accountId: a.id as string,
    loginEmail: a.email,
    name: o.name,
    designation: o.designation ?? null,
    email: o.contactEmail ?? null,
    mobile: o.mobile ?? null,
    organization: o.organization ?? null,
    from: o.from ?? null,
    to: o.to as Date | null,
    reason: o.reason as string | null,
    isCurrent: false,
  })),
];

/** What other modules show about a PI: the seat's login and its current holder. */
export const seatSummary = (u: HydratedDocument<User>) => ({
  id: u.id as string,
  loginEmail: u.email,
  seatNumber: u.seatNumber ?? null,
  name: u.name,
  // The parts too, so edit forms can be pre-filled.
  title: u.title ?? null,
  firstName: u.firstName ?? null,
  middleName: u.middleName ?? null,
  surname: u.surname ?? null,
  designation: u.designation ?? null,
  email: contactEmailOf(u),
  mobile: u.mobile ?? null,
  organization: u.organization ?? null,
  occupiedSince: u.occupiedSince ?? u.createdAt,
  lastLoginAt: u.lastLoginAt ?? null,
  isActive: u.isActive,
});

/** The holder's own email: `contactEmail` on seats, the login otherwise. */
export const contactEmailOf = (u: { email: string; contactEmail?: string | null }) =>
  u.contactEmail ?? u.email;

/** The active PI of each given centre, for showing on centre lists. */
export const activePisForCentres = async (centreIds: string[]) => {
  const pis = await UserModel.find({ centreId: trusted({ $in: centreIds }), roleId: 'pi', isActive: true });
  return new Map(pis.map((pi) => [String(pi.centreId), pi]));
};

// ── Changes ──────────────────────────────────────────────────────────────────

// ── Seats (PI accounts) ──────────────────────────────────────────────────────

/** A person's details as stored on a seat: their own email becomes `contactEmail`. */
const holderFields = (p: PersonDto) => ({
  title: p.title,
  firstName: p.firstName,
  middleName: p.middleName ?? null,
  surname: p.surname ?? null,
  designation: p.designation,
  contactEmail: p.email,
  mobile: p.mobile,
  organization: p.organization,
});

/** Moves the seat's current holder into its history (before a new one takes it). */
const archiveHolder = (ctx: RequestContext, seat: HydratedDocument<User>, reason: string) => {
  seat.pastOccupants.push({
    name: seat.name,
    title: seat.title ?? null,
    firstName: seat.firstName,
    middleName: seat.middleName ?? null,
    surname: seat.surname ?? null,
    designation: seat.designation,
    contactEmail: contactEmailOf(seat),
    mobile: seat.mobile,
    organization: seat.organization,
    from: seat.occupiedSince ?? seat.createdAt,
    to: new Date(),
    reason,
    replacedBy: new Types.ObjectId(ctx.user.id),
    replacedByName: ctx.user.name,
  });
};

/**
 * A new person takes the seat: the old holder goes into the history, the password is replaced
 * (which also ends the old holder's sessions) and the login stays the same.
 */
const giveSeatTo = async (
  ctx: RequestContext,
  seat: HydratedDocument<User>,
  person: PersonDto,
  password: string,
  reason: string,
  session: ClientSession,
) => {
  const previous = seat.name;
  archiveHolder(ctx, seat, reason);
  seat.set({
    ...holderFields(person),
    passwordHash: await hashPassword(password),
    passwordChangedAt: new Date(),
    mustChangePassword: false,
    occupiedSince: new Date(),
    // The new holder hasn't signed in yet; the old holder's last sign-in isn't theirs.
    lastLoginAt: null,
    isActive: true,
    deactivatedAt: null,
    deactivatedBy: null,
    deactivationReason: null,
    updatedBy: ctx.user.id,
  });
  await seat.save({ session });
  await recordAudit(
    ctx,
    {
      action: `${seat.email}: ${previous} replaced by ${seat.name} (${reason})`,
      module: MODULE,
      entityId: seat.id,
      centreId: seat.centreId?.toString() ?? null,
      changes: { holder: { from: previous, to: seat.name } },
    },
    session,
  );
  return seat;
};

/** Creates the next Experiment PI seat, pi<n>.npnf@…, held by the given person. */
export const createExperimentPi = async (ctx: RequestContext, dto: CreateExperimentPiDto) => {
  assertCanManage(ctx, 'epi');
  const { password, ...person } = dto;
  const passwordHash = await hashPassword(password);
  return withTransaction(async (session) => {
    const last = await UserModel.findOne({ seatKind: 'experiment' }, { seatNumber: 1 })
      .sort({ seatNumber: -1 })
      .session(session);
    const seatNumber = (last?.seatNumber ?? 0) + 1;
    const [seat] = await UserModel.create(
      [
        {
          ...holderFields(person),
          email: experimentPiEmail(seatNumber),
          roleId: 'epi',
          centreId: null,
          seatKind: 'experiment',
          seatNumber,
          occupiedSince: new Date(),
          passwordHash,
          mustChangePassword: false,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        },
      ],
      { session },
    );
    if (!seat) throw new Error('Experiment PI was not created');
    await recordAudit(
      ctx,
      { action: `Created Experiment PI ${seat.email} for ${seat.name}`, module: MODULE, entityId: seat.id },
      session,
    );
    return seat;
  });
};

/** A new person takes over an Experiment PI seat (same login, new password). */
export const replaceExperimentPi = async (ctx: RequestContext, id: string, dto: ReplaceSeatHolderDto) => {
  const seat = await findManageableUser(ctx, id);
  if (seat.seatKind !== 'experiment') throw AppError.notFound('USER_NOT_FOUND', 'Experiment PI not found');
  const { password, reason, ...person } = dto;
  return withTransaction(async (session) => {
    const doc = await UserModel.findById(id).session(session);
    if (!doc) throw AppError.notFound('USER_NOT_FOUND', 'Experiment PI not found');
    return giveSeatTo(ctx, doc, person, password, reason, session);
  });
};

/** Every Experiment PI seat, by number. */
export const listExperimentPis = (ctx: RequestContext) => {
  assertCanManage(ctx, 'epi');
  return UserModel.find({ seatKind: 'experiment' }).sort({ seatNumber: 1 });
};

/** One Experiment PI seat the caller may manage. */
export const getExperimentPi = async (ctx: RequestContext, id: string) => {
  const seat = await findManageableUser(ctx, id);
  if (seat.seatKind !== 'experiment') throw AppError.notFound('USER_NOT_FOUND', 'Experiment PI not found');
  return seat;
};

/** For the experiments module: a seat must be an active Experiment PI to be linked. */
export const findExperimentPi = async (id: string) => {
  const seat = await UserModel.findOne({ _id: id, roleId: 'epi', isActive: true });
  if (!seat) throw AppError.badRequest('UNKNOWN_EXPERIMENT_PI', 'Choose an active Experiment PI');
  return seat;
};

/** For other modules: users by id (PI summaries on experiments). */
export const usersByIds = async (ids: string[]) =>
  new Map((await UserModel.find({ _id: trusted({ $in: ids }) })).map((u) => [u.id as string, u]));

export const createUser = async (ctx: RequestContext, dto: CreateUserDto) => {
  const { temporaryPassword, ...rest } = dto;
  const { roleId, centreId, ...person } = rest;
  const centreScoped = ROLES[roleId].scope === 'centre';

  assertCanManage(ctx, roleId);
  // PI accounts are seats with generated logins.
  if (dto.roleId === 'epi') return createExperimentPi(ctx, { ...person, password: temporaryPassword });
  if (centreScoped && !dto.centreId) {
    throw AppError.badRequest('CENTRE_REQUIRED', `${ROLES[dto.roleId].label} must be linked to a centre`);
  }
  if (centreScoped && dto.centreId && !(await centresByIds([dto.centreId])).size) {
    throw AppError.badRequest('CENTRE_NOT_FOUND', 'Centre not found');
  }
  if (dto.roleId === 'pi' && dto.centreId) {
    if (await activePiOf(dto.centreId)) {
      throw AppError.conflict(
        'CENTRE_HAS_PI',
        'This centre already has an active Centre PI. Use "Assign Centre PI" to replace them.',
      );
    }
    return assignCentrePi(ctx, dto.centreId, { ...person, temporaryPassword });
  }

  const passwordHash = await hashPassword(temporaryPassword);

  return withTransaction(async (session) => {
    const [user] = await UserModel.create(
      [
        {
          ...person,
          roleId,
          // National roles are never tied to one centre.
          centreId: centreScoped ? centreId : null,
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
    // `name` is rebuilt from the parts, so record it too.
    // A seat's login never changes; the "email" sent is the holder's own (contactEmail).
    const { email, ...fields } = dto;
    const changes = user.seatKind && email !== undefined ? { ...fields, contactEmail: email } : dto;
    const keys = [...Object.keys(changes), 'name'];
    const before = snapshot(user, keys);
    user.set({ ...changes, updatedBy: ctx.user.id });
    await user.save({ session });
    await recordAudit(
      ctx,
      {
        action: `Updated ${user.email}`,
        module: MODULE,
        entityId: user.id,
        centreId: user.centreId?.toString() ?? null,
        changes: fieldChanges(before, snapshot(user, keys)),
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
      {
        passwordHash,
        // PI seats keep the password the PCU sets until the holder chooses to change it.
        mustChangePassword: !user.seatKind,
        passwordChangedAt: new Date(),
        updatedBy: ctx.user.id,
      },
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
 * Gives the centre's PI seat (<centre code>.pi.npnf@…) to the person in `dto`. If someone holds it
 * they move to the seat's history (a reason is required); a Centre PI account from before seats
 * existed is deactivated instead. Either way the centre never has zero or two active PIs.
 */
export const assignCentrePi = async (ctx: RequestContext, centreId: string, dto: AssignCentrePiDto) => {
  assertCanManage(ctx, 'pi');
  const centre = (await centresByIds([centreId])).get(centreId);
  if (!centre) throw AppError.notFound('CENTRE_NOT_FOUND', 'Centre not found');

  const { temporaryPassword: password, reason, ...person } = dto;

  return withTransaction(async (session) => {
    const current = await activePiOf(centreId, session);
    if (current && !reason) {
      throw AppError.badRequest('REASON_REQUIRED', 'Give a reason for replacing the current Centre PI');
    }
    if (current?.seatKind === 'centre') return giveSeatTo(ctx, current, person, password, reason!, session);
    if (current) await deactivate(ctx, current, `Replaced as Centre PI: ${reason}`, session);

    // A seat closed earlier (deactivated) is reopened for the new person.
    const closed = await UserModel.findOne({ centreId, roleId: 'pi', seatKind: 'centre' }).session(session);
    if (closed) return giveSeatTo(ctx, closed, person, password, reason ?? 'Seat reopened', session);

    const [seat] = await UserModel.create(
      [
        {
          ...holderFields(person),
          email: centrePiEmail(centre.code),
          roleId: 'pi',
          centreId,
          seatKind: 'centre',
          occupiedSince: new Date(),
          passwordHash: await hashPassword(password),
          mustChangePassword: false,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id,
        },
      ],
      { session },
    );
    if (!seat) throw new Error('Centre PI was not created');
    await recordAudit(
      ctx,
      {
        action: current
          ? `${seat.email} given to ${seat.name}, replacing ${current.email}`
          : `${seat.email} given to ${seat.name}`,
        module: MODULE,
        entityId: seat.id,
        centreId,
      },
      session,
    );
    return seat;
  });
};
