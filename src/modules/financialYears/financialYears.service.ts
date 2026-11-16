import type { ClientSession } from 'mongoose';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import type { RequestContext } from '../../utils/context.js';
import { recordAudit } from '../audit/audit.service.js';
import type { CreateFyDto, UpdateFyDto } from './financialYears.dto.js';
import { FinancialYearModel, fyDates } from './financialYears.model.js';

const MODULE = 'financialYears';

export const listFinancialYears = () => FinancialYearModel.find().sort({ code: -1 });

/** For other modules: the year record, or 404. */
export const getFinancialYearByCode = async (code: string) => {
  const fy = await FinancialYearModel.findOne({ code });
  if (!fy) throw AppError.notFound('FY_NOT_FOUND', `Financial year ${code} is not set up`);
  return fy;
};

/** For other modules: blocks changes to data of a closed year. */
export const assertYearOpen = async (code: string): Promise<void> => {
  const fy = await getFinancialYearByCode(code);
  if (!fy.isOpen) throw AppError.conflict('FY_CLOSED', `Financial year ${code} is closed for data entry`);
};

const clearCurrent = (session: ClientSession) =>
  FinancialYearModel.updateMany({ isCurrent: true }, { isCurrent: false }, { session });

export const createFinancialYear = (ctx: RequestContext, dto: CreateFyDto) =>
  withTransaction(async (session) => {
    if (dto.isCurrent) await clearCurrent(session);
    const [fy] = await FinancialYearModel.create(
      [{ ...dto, ...fyDates(dto.code), createdBy: ctx.user.id, updatedBy: ctx.user.id }],
      { session },
    );
    if (!fy) throw new Error('Financial year was not created');
    await recordAudit(
      ctx,
      { action: `Added financial year ${fy.code}`, module: MODULE, entityId: fy.id },
      session,
    );
    return fy;
  });

export const updateFinancialYear = (ctx: RequestContext, id: string, dto: UpdateFyDto) =>
  withTransaction(async (session) => {
    const fy = await FinancialYearModel.findById(id).session(session);
    if (!fy) throw AppError.notFound('FY_NOT_FOUND', 'Financial year not found');
    if (dto.isCurrent) await clearCurrent(session);
    fy.set({ ...dto, updatedBy: ctx.user.id });
    await fy.save({ session });
    const what = [
      dto.isOpen !== undefined && (dto.isOpen ? 'opened' : 'closed'),
      dto.isCurrent && 'made current',
    ].filter(Boolean);
    await recordAudit(
      ctx,
      {
        action: `Financial year ${fy.code} ${what.join(' and ')}`,
        module: MODULE,
        entityId: fy.id,
        changes: dto,
      },
      session,
    );
    return fy;
  });
