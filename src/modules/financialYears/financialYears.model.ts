import { Schema, type Types, model } from 'mongoose';

/** Indian financial year: 1 April – 31 March, coded "2026-27". */
export interface FinancialYear {
  code: string;
  startDate: Date;
  endDate: Date;
  /** Data entry (research sheets, expenditure) is allowed only in open years. */
  isOpen: boolean;
  /** The year screens default to. At most one is current. */
  isCurrent: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const financialYearSchema = new Schema<FinancialYear>(
  {
    code: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}$/ },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isOpen: { type: Boolean, default: true },
    isCurrent: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

financialYearSchema.index(
  { isCurrent: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true }, name: 'one_current_year' },
);

export const FinancialYearModel = model<FinancialYear>('FinancialYear', financialYearSchema);

/** "2026-27" → 1 Apr 2026 … 31 Mar 2027 (UTC). */
export const fyDates = (code: string): { startDate: Date; endDate: Date } => {
  const start = Number(code.slice(0, 4));
  return {
    startDate: new Date(Date.UTC(start, 3, 1)),
    endDate: new Date(Date.UTC(start + 1, 2, 31, 23, 59, 59)),
  };
};

/** The FY code a date falls in: 14 Nov 2026 → "2026-27". */
export const fyCodeFor = (date: Date): string => {
  const y = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
