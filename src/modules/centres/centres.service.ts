import type { QueryFilter } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { type RequestContext, withScope } from '../../utils/context.js';
import { type PageMeta, pageMeta } from '../../utils/response.js';
import { skipFor } from '../../utils/validators.js';
import { recordAudit } from '../audit/audit.service.js';
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
    where.$or = [{ name: pattern }, { code: pattern }, { host: pattern }];
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

export const createCentre = (ctx: RequestContext, dto: CreateCentreDto) =>
  withTransaction(async (session) => {
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

export const updateCentre = (ctx: RequestContext, id: string, dto: UpdateCentreDto) =>
  withTransaction(async (session) => {
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
        changes: dto,
      },
      session,
    );
    return centre;
  });

/** For other modules that need to check a centre id (they must not import CentreModel). */
export const centreExists = async (id: string): Promise<boolean> =>
  (await CentreModel.exists({ _id: id })) !== null;
