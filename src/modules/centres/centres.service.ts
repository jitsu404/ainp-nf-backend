import type { QueryFilter } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { type RequestContext, withScope } from '../../utils/context.js';
import { type PageMeta, pageMeta } from '../../utils/response.js';
import { skipFor } from '../../utils/validators.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import { activeMasterNames } from '../masters/masters.service.js';
import { type Centre, CentreModel } from './centres.model.js';
import type { CreateCentreDto, ListCentresQuery, UpdateCentreDto } from './centres.dto.js';

const MODULE = 'centres';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Centre users only ever see their own centre (matched on _id here, not centreId). */
const scoped = (ctx: RequestContext, filter: QueryFilter<Centre>): QueryFilter<Centre> =>
  withScope(ctx.user, filter, '_id');

export const listCentres = async (ctx: RequestContext, query: ListCentresQuery) => {
  const { page, limit, sort, search, state, type, isActive } = query;

  const where: QueryFilter<Centre> = {};
  if (state) where.state = state;
  if (type) where.type = type;
  if (isActive !== undefined) where.isActive = isActive;
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    where.$or = ['name', 'code', 'host', 'hostShort', 'city', 'state'].map((field) => ({ [field]: pattern }));
  }
  const filter = scoped(ctx, where);

  const [items, total] = await Promise.all([
    CentreModel.find(filter)
      .sort(sort ?? 'name')
      .skip(skipFor(page, limit))
      .limit(limit),
    CentreModel.countDocuments(filter),
  ]);
  const meta: PageMeta = pageMeta(page, limit, total);
  return { items, meta };
};

export const getCentre = async (ctx: RequestContext, id: string) => {
  // A centre user asking for another centre gets 404, not 403, so ids of other centres aren't revealed.
  const centre = await CentreModel.findOne(scoped(ctx, { _id: id }));
  if (!centre) throw AppError.notFound('CENTRE_NOT_FOUND', 'Centre not found');
  return centre;
};

/** The zone is stored by name and must be an active item of the agro-climatic zones master. */
const checkZone = async (zone: string | undefined): Promise<void> => {
  if (zone === undefined || zone === '') return;
  if (!(await activeMasterNames('zone')).has(zone)) {
    throw AppError.badRequest('UNKNOWN_ZONE', `"${zone}" is not in the agro-climatic zones list`);
  }
};

export const createCentre = async (ctx: RequestContext, dto: CreateCentreDto) => {
  await checkZone(dto.zone);
  return withTransaction(async (session) => {
    const [centre] = await CentreModel.create([{ ...dto, createdBy: ctx.user.id, updatedBy: ctx.user.id }], {
      session,
    });
    if (!centre) throw new Error('Centre was not created');
    await recordAudit(
      ctx,
      { action: `Created centre ${centre.code}`, module: MODULE, entityId: centre.id, centreId: centre.id },
      session,
    );
    return centre;
  });
};

export const updateCentre = async (ctx: RequestContext, id: string, dto: UpdateCentreDto) => {
  await checkZone(dto.zone ?? undefined);
  return withTransaction(async (session) => {
    const existing = await CentreModel.findOne(scoped(ctx, { _id: id })).session(session).lean();
    if (!existing) throw AppError.notFound('CENTRE_NOT_FOUND', 'Centre not found');
    const before = snapshot(existing, Object.keys(dto));
    const centre = await CentreModel.findOneAndUpdate(
      scoped(ctx, { _id: id }),
      { ...dto, updatedBy: ctx.user.id },
      { returnDocument: 'after', runValidators: true, session },
    );
    if (!centre) throw AppError.notFound('CENTRE_NOT_FOUND', 'Centre not found');
    await recordAudit(
      ctx,
      {
        action: `Updated centre ${centre.code}`,
        module: MODULE,
        entityId: centre.id,
        centreId: centre.id,
        changes: fieldChanges(before, snapshot(centre, Object.keys(dto))),
      },
      session,
    );
    return centre;
  });
};

/** For other modules that need to check a centre id (they must not import CentreModel). */
export const centreExists = async (id: string): Promise<boolean> =>
  (await CentreModel.exists({ _id: id })) !== null;
