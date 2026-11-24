import { type ClientSession, trusted } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import type { RequestContext } from '../../utils/context.js';
import { fieldChanges, recordAudit, snapshot } from '../audit/audit.service.js';
import { CODE_SERIES, nextCode } from '../counters/counters.service.js';
import { activeMasterCodes, masterNames } from '../masters/masters.service.js';
import type {
  CreateCroppingSystemDto,
  ListCroppingSystemsQuery,
  UpdateCroppingSystemDto,
} from './croppingSystems.dto.js';
import { type CroppingSystem, CroppingSystemModel } from './croppingSystems.model.js';

const MODULE = 'croppingSystems';

type Crops = Pick<CroppingSystem, 'mainCropCode' | 'intercropCodes'>;

export const listCroppingSystems = (query: ListCroppingSystemsQuery) =>
  CroppingSystemModel.find(query.isActive === undefined ? {} : { isActive: query.isActive }).sort({
    code: 1,
  });

export const getCroppingSystem = async (id: string) => {
  const system = await CroppingSystemModel.findById(id);
  if (!system) throw AppError.notFound('CROPPING_SYSTEM_NOT_FOUND', 'Cropping system not found');
  return system;
};

/** For other modules: systems by id (inactive ones too), to check and show references. */
export const croppingSystemsByIds = async (ids: string[]) =>
  new Map(
    (await CroppingSystemModel.find({ _id: trusted({ $in: [...new Set(ids)] }) }).lean()).map((s) => [
      String(s._id),
      s as CroppingSystem & { _id: unknown },
    ]),
  );

/** "Rice + Soybean + Pigeonpea": the main crop, then its intercrops. */
export const systemNameOf = (s: Crops, cropNames: Map<string, string>) =>
  [s.mainCropCode, ...s.intercropCodes].map((c) => cropNames.get(c) ?? c).join(' + ');

/** The season and crops must be in the masters; crops already in the system may stay if deactivated. */
const checkMasters = async (seasonCode: string | undefined, crops: Crops, existing?: Crops) => {
  const [knownSeasons, activeCrops] = await Promise.all([
    activeMasterCodes('season'),
    activeMasterCodes('crop'),
  ]);
  if (seasonCode && !knownSeasons.has(seasonCode))
    throw AppError.badRequest('UNKNOWN_SEASON', `Unknown season ${seasonCode}`);
  const kept = new Set(existing ? [existing.mainCropCode, ...existing.intercropCodes] : []);
  const bad = [crops.mainCropCode, ...crops.intercropCodes].filter(
    (c) => !activeCrops.has(c) && !kept.has(c),
  );
  if (bad.length)
    throw AppError.badRequest('UNKNOWN_CROP', `Not active crops in the crops master: ${bad.join(', ')}`);
};

const codeTaken = (session: ClientSession) => async (code: string) =>
  Boolean(await CroppingSystemModel.exists({ code }).session(session));

export const createCroppingSystem = async (ctx: RequestContext, dto: CreateCroppingSystemDto) => {
  const crops = { mainCropCode: dto.mainCropCode, intercropCodes: dto.intercropCodes ?? [] };
  if (crops.intercropCodes.includes(crops.mainCropCode))
    throw AppError.badRequest('REPEATED_CROP', 'The main crop cannot also be an intercrop');
  await checkMasters(dto.seasonCode, crops);
  const name = dto.name || systemNameOf(crops, await masterNames('crop'));
  return withTransaction(async (session) => {
    const code = await nextCode(CODE_SERIES.croppingSystem, codeTaken(session), session);
    const [system] = await CroppingSystemModel.create(
      [{ ...dto, ...crops, name, code, createdBy: ctx.user.id, updatedBy: ctx.user.id }],
      { session },
    );
    if (!system) throw new Error('Cropping system was not created');
    await recordAudit(
      ctx,
      { action: `Added cropping system ${code}: ${name}`, module: MODULE, entityId: system.id },
      session,
    );
    return system;
  });
};

export const updateCroppingSystem = async (ctx: RequestContext, id: string, dto: UpdateCroppingSystemDto) => {
  const current = await getCroppingSystem(id);
  const crops = {
    mainCropCode: dto.mainCropCode ?? current.mainCropCode,
    intercropCodes: dto.intercropCodes ?? current.intercropCodes,
  };
  if (crops.intercropCodes.includes(crops.mainCropCode))
    throw AppError.badRequest('REPEATED_CROP', 'The main crop cannot also be an intercrop');
  await checkMasters(dto.seasonCode, crops, current);
  // A name made from the crops follows them; a typed one stays until it is changed or emptied.
  const names = await masterNames('crop');
  const wasMade = current.name === systemNameOf(current, names);
  const name =
    dto.name !== undefined
      ? dto.name || systemNameOf(crops, names)
      : wasMade
        ? systemNameOf(crops, names)
        : undefined;
  return withTransaction(async (session) => {
    const system = await CroppingSystemModel.findById(id).session(session);
    if (!system) throw AppError.notFound('CROPPING_SYSTEM_NOT_FOUND', 'Cropping system not found');
    const changes = { ...dto, ...(name ? { name } : {}) };
    const keys = Object.keys(changes);
    const before = snapshot(system, keys);
    system.set({ ...changes, updatedBy: ctx.user.id });
    await system.save({ session });
    await recordAudit(
      ctx,
      {
        action: `Updated cropping system ${system.code}`,
        module: MODULE,
        entityId: system.id,
        changes: fieldChanges(before, snapshot(system, keys)),
      },
      session,
    );
    return system;
  });
};
