import mongoose from 'mongoose';

export type BudgetAllocationType = {
  centre: mongoose.Types.ObjectId;
  fy: mongoose.Types.ObjectId;
  isTotal: boolean;
  amount: number;
  budgetHead?: mongoose.Types.ObjectId | null | undefined;
  fundCategory?: mongoose.Types.ObjectId | null | undefined;
};

const budgetAllocationSchema = new mongoose.Schema<BudgetAllocationType>(
  {
    centre: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Centre',
      required: true,
    },
    fy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FinancialYear',
      required: true,
    },
    budgetHead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MasterItem',
      default: null,
    },
    fundCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MasterItem',
      default: null,
    },
    isTotal: {
      type: Boolean,
      default: false,
    },
    amount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

budgetAllocationSchema.index({ centre: 1, fy: 1, budgetHead: 1, fundCategory: 1, isTotal: 1 });
budgetAllocationSchema.index({ fy: 1, centre: 1 });

export const BudgetAllocationModel =
  (mongoose.models.BudgetAllocation as mongoose.Model<BudgetAllocationType>) ||
  mongoose.model<BudgetAllocationType>('BudgetAllocation', budgetAllocationSchema);

export default BudgetAllocationModel;
