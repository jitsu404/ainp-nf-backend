import { Schema, type Types, model } from 'mongoose';

// The parameter library: every observation recorded anywhere refers to one of these, so
// "Grain yield (kg/ha)" means the same thing at every centre and can be consolidated.

export const PARAMETER_CATEGORIES = [
  'Growth',
  'Yield',
  'Quality',
  'Soil chemical',
  'Soil physical',
  'Soil biological',
  'Plant nutrient',
  'Pest & disease',
  'Weed',
  'Water',
  'Economics',
  'Input use',
  'Weather',
  'Other',
] as const;
export type ParameterCategory = (typeof PARAMETER_CATEGORIES)[number];

export const PARAMETER_DATA_TYPES = ['number', 'text', 'date', 'choice'] as const;
export type ParameterDataType = (typeof PARAMETER_DATA_TYPES)[number];

export interface Parameter {
  code: string;
  name: string;
  /** Code of a `unit` master item (e.g. KG_HA); null for unitless text. */
  unitCode: string | null;
  category: ParameterCategory;
  dataType: ParameterDataType;
  /** Number of decimals shown and kept (numbers only). */
  decimals: number;
  min: number | null;
  max: number | null;
  choices: string[];
  /** Measurement method / protocol (the deep-insights sheet gives one per parameter). */
  method: string | null;
  /**
   * Set for a calculated parameter (numbers only), e.g. "NET_RETURNS / COST_CULTIVATION".
   * Its values are computed from the other parameters of the same sheet and never entered.
   */
  formula: string | null;
  isActive: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const parameterSchema = new Schema<Parameter>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    unitCode: { type: String, uppercase: true, trim: true, default: null },
    category: { type: String, enum: PARAMETER_CATEGORIES, required: true },
    dataType: { type: String, enum: PARAMETER_DATA_TYPES, default: 'number' },
    decimals: { type: Number, min: 0, max: 6, default: 2 },
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    choices: { type: [String], default: [] },
    method: { type: String, trim: true, maxlength: 1000, default: null },
    formula: { type: String, trim: true, maxlength: 500, default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

parameterSchema.index({ category: 1, name: 1 });

export const ParameterModel = model<Parameter>('Parameter', parameterSchema);
