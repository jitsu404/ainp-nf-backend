import { Schema, type Types, model } from 'mongoose';
import {
  type Treatment,
  treatmentSchema,
  type SubPlotItem,
  subPlotItemSchema,
  type DisabledParameter,
  disabledParameterSchema,
} from '../experiments/experiments.model.js';

export type { DisabledParameter };

// A trial is one experiment as run at one centre. The PCU's protocol (experiment) fixes the design,
// treatments and parameters; the centre fills in what is local: its cropping systems, crops and
// varieties per season, the practice details of each treatment, dates and the person in charge.

export const TRIAL_STATUSES = ['Setup', 'Running', 'Completed'] as const;
export type TrialStatus = (typeof TRIAL_STATUSES)[number];

// The trial is also the record of the assignment: assigning a centre creates (or reactivates) its
// trial, unassigning withdraws it. A withdrawn trial keeps its data, read-only. Changed only by
// syncTrials(); experiment.centreIds is a cache of the active trials' centres.
export const ASSIGNMENT_STATUSES = ['Active', 'Withdrawn'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const SYSTEM_CROP_ROLES = ['main', 'intercrop'] as const;
export type SystemCropRole = (typeof SYSTEM_CROP_ROLES)[number];

/** How the centre grows one crop of a cropping system in a season (datasheet 2a). */
export interface SystemCrop {
  cropCode: string;
  role: SystemCropRole;
  variety?: string | null;
  /** Plant to plant spacing, cm. */
  plantSpacing?: number | null;
  /** Row to row spacing, cm. */
  rowSpacing?: number | null;
  /** This crop's rows in the row ratio: main 2, intercrop 1 → "2:1". */
  rowRatio?: number | null;
  /** Seed rate, kg/ha. */
  seedRate?: number | null;
}

/**
 * A cropping system from the masters as grown at this centre: the master fixes the season and
 * crops, the centre records each crop's variety, spacings, row ratio and seed rate, and the dates.
 * Entries saved before the master existed have no croppingSystemId and are ignored.
 */
export interface TrialCroppingSystem {
  croppingSystemId: Types.ObjectId;
  crops: SystemCrop[];
  sowingDate?: Date | null;
  harvestDate?: Date | null;
}

/** What a treatment means at this centre (datasheet 2a "Treatment details"). */
export interface TreatmentPractice {
  treatmentCode: string;
  seedDetails?: string | null;
  nutrientDetails?: string | null;
  protectionDetails?: string | null;
  otherDetails?: string | null;
}

export interface Trial {
  experimentId: Types.ObjectId;
  centreId: Types.ObjectId;
  /**
   * The centre's own crops for a season, where they differ from the experiment's (season code →
   * crop master item ids). A season not listed uses the experiment's crops. Read the result with
   * trialSeasonCrops(); the audit trail records every change.
   */
  seasonCrops: Map<string, Types.ObjectId[]>;
  croppingSystems: TrialCroppingSystem[];
  practices: TreatmentPractice[];
  treatments: Treatment[];
  mainPlotData: Treatment[];
  subPlotData: SubPlotItem[];
  subSubPlotData: Treatment[];
  factor1Data: Treatment[];
  factor2Data: Treatment[];
  factor3Data: Treatment[];
  disabledParameters: DisabledParameter[];
  locked: string[];
  inChargeUserId?: Types.ObjectId | null;
  layoutNotes?: string | null;
  status: TrialStatus;
  assignmentStatus: AssignmentStatus;
  assignedAt?: Date | null;
  assignedBy?: Types.ObjectId | null;
  withdrawnAt?: Date | null;
  withdrawnBy?: Types.ObjectId | null;
  withdrawReason?: string | null;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const systemCropSchema = new Schema<SystemCrop>(
  {
    cropCode: { type: String, required: true, uppercase: true },
    role: { type: String, enum: SYSTEM_CROP_ROLES, required: true },
    variety: { type: String, trim: true, maxlength: 100, default: null },
    plantSpacing: { type: Number, min: 0, default: null },
    rowSpacing: { type: Number, min: 0, default: null },
    rowRatio: { type: Number, min: 1, default: null },
    seedRate: { type: Number, min: 0, default: null },
  },
  { _id: false },
);

const trialCroppingSystemSchema = new Schema<TrialCroppingSystem>(
  {
    // Not required in the schema, so trials still holding pre-master entries can be saved.
    croppingSystemId: { type: Schema.Types.ObjectId, ref: 'CroppingSystem', default: null },
    crops: { type: [systemCropSchema], default: [] },
    sowingDate: { type: Date, default: null },
    harvestDate: { type: Date, default: null },
  },
  { _id: false },
);

const practiceSchema = new Schema<TreatmentPractice>(
  {
    treatmentCode: { type: String, required: true, uppercase: true },
    seedDetails: { type: String, trim: true, maxlength: 2000, default: null },
    nutrientDetails: { type: String, trim: true, maxlength: 2000, default: null },
    protectionDetails: { type: String, trim: true, maxlength: 2000, default: null },
    otherDetails: { type: String, trim: true, maxlength: 2000, default: null },
  },
  { _id: false },
);

const trialSchema = new Schema<Trial>(
  {
    experimentId: { type: Schema.Types.ObjectId, ref: 'Experiment', required: true },
    centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true },
    seasonCrops: {
      type: Map,
      of: [{ type: Schema.Types.ObjectId, ref: 'MasterItem' }],
      default: () => new Map(),
    },
    croppingSystems: { type: [trialCroppingSystemSchema], default: [] },
    practices: { type: [practiceSchema], default: [] },
    treatments: { type: [treatmentSchema], default: [] },
    mainPlotData: { type: [treatmentSchema], default: [] },
    subPlotData: { type: [subPlotItemSchema], default: [] },
    subSubPlotData: { type: [treatmentSchema], default: [] },
    factor1Data: { type: [treatmentSchema], default: [] },
    factor2Data: { type: [treatmentSchema], default: [] },
    factor3Data: { type: [treatmentSchema], default: [] },
    disabledParameters: { type: [disabledParameterSchema], default: [] },
    locked: { type: [String], default: [] },
    inChargeUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    layoutNotes: { type: String, trim: true, maxlength: 4000, default: null },
    status: { type: String, enum: TRIAL_STATUSES, default: 'Setup' },
    assignmentStatus: { type: String, enum: ASSIGNMENT_STATUSES, default: 'Active' },
    assignedAt: { type: Date, default: null },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    withdrawnAt: { type: Date, default: null },
    withdrawnBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    withdrawReason: { type: String, trim: true, maxlength: 500, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

trialSchema.index({ experimentId: 1, centreId: 1 }, { unique: true });
trialSchema.index({ centreId: 1, experimentId: 1 });

export const TrialModel = model<Trial>('Trial', trialSchema);
