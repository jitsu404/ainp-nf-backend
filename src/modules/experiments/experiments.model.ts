import { Schema, type Types, model } from 'mongoose';

// An experiment is the PCU's protocol (the "technical programme"): design, common treatments and
// the parameters every centre records. It is assigned to centres; each centre runs it as a trial
// (modules/trials) with its own cropping systems and practices, and records data in sheets.

export const EXPERIMENT_DESIGNS = [
  'RCBD',
  'Factorial RBD',
  'Split plot',
  'Non-replicated',
  'Survey',
] as const;
export type ExperimentDesign = (typeof EXPERIMENT_DESIGNS)[number];

export const EXPERIMENT_STATUSES = ['Draft', 'Active', 'Closed'] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

/**
 * plot = recorded per treatment × replication (yield, plant height …);
 * treatment = recorded once per treatment (economics, system yield, soil after the cycle …).
 */
export const PARAMETER_LEVELS = ['plot', 'treatment'] as const;
export type ParameterLevel = (typeof PARAMETER_LEVELS)[number];

export interface Treatment {
  code: string;
  name: string;
  description?: string | null;
}

export interface ExperimentParameter {
  parameterId: Types.ObjectId;
  /** Grouping in forms and reports: "Growth & yield", "Soil after crop cycle", "Economics" … */
  section: string;
  level: ParameterLevel;
  required: boolean;
}

export interface Experiment {
  code: string;
  title: string;
  /** Code of a programme master item (P1–P4). */
  programmeCode: string;
  objectives: string[];
  design: ExperimentDesign;
  /** Replications for replicated designs; null for non-replicated trials and surveys. */
  replications: number | null;
  treatments: Treatment[];
  parameters: ExperimentParameter[];
  /** Season master codes in which data is recorded. */
  seasons: string[];
  startYear: string;
  status: ExperimentStatus;
  centreIds: Types.ObjectId[];
  /**
   * Set once any centre has recorded data. From then on the design, replications and existing
   * treatments/parameters are frozen (new ones can still be added), so recorded data stays valid.
   */
  dataLocked: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const treatmentSchema = new Schema<Treatment>(
  {
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000, default: null },
  },
  { _id: false },
);

const experimentParameterSchema = new Schema<ExperimentParameter>(
  {
    parameterId: { type: Schema.Types.ObjectId, ref: 'Parameter', required: true },
    section: { type: String, trim: true, maxlength: 80, default: 'Observations' },
    level: { type: String, enum: PARAMETER_LEVELS, default: 'plot' },
    required: { type: Boolean, default: false },
  },
  { _id: false },
);

const experimentSchema = new Schema<Experiment>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 30 },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    programmeCode: { type: String, required: true, uppercase: true, trim: true },
    objectives: { type: [String], default: [] },
    design: { type: String, enum: EXPERIMENT_DESIGNS, required: true },
    replications: { type: Number, min: 1, max: 20, default: null },
    treatments: { type: [treatmentSchema], default: [] },
    parameters: { type: [experimentParameterSchema], default: [] },
    seasons: { type: [String], default: [] },
    startYear: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    status: { type: String, enum: EXPERIMENT_STATUSES, default: 'Draft' },
    centreIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Centre' }], default: [] },
    dataLocked: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

experimentSchema.index({ programmeCode: 1, code: 1 });
experimentSchema.index({ centreIds: 1 });

export const ExperimentModel = model<Experiment>('Experiment', experimentSchema);
