import { Schema, type Types, model } from 'mongoose';

// An observation sheet is the unit of data entry and submission:
// one trial (experiment at a centre) × year × season (× cropping system or crop). The year is the
// one the season starts in: Kharif 2026 and Rabi 2026 (sown late 2026, harvested early 2027) are
// both 2026. Any year from the experiment's start year to its end year can be recorded.
// Its values live in `observations`, one row per plot × treatment × replication × parameter
// ("long format"), which keeps validation, analysis, consolidation and export simple.

export const SHEET_STATUSES = ['Draft', 'Submitted', 'Returned', 'Approved'] as const;
export type SheetStatus = (typeof SHEET_STATUSES)[number];
/** Statuses in which the centre may still change values. */
export const EDITABLE_STATUSES: readonly SheetStatus[] = ['Draft', 'Returned'];

export interface SheetHistoryEntry {
  status: SheetStatus;
  at: Date;
  byUserId: Types.ObjectId;
  byName: string;
  remark?: string | null;
}

export interface Sheet {
  trialId: Types.ObjectId;
  experimentId: Types.ObjectId;
  centreId: Types.ObjectId;
  /** Year the season starts in (2026), within the experiment's startYear … endYear. */
  year: number;
  seasonCode: string;
  croppingSystemCode: string | null;
  cropCode: string | null;
  status: SheetStatus;
  history: SheetHistoryEntry[];
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const historySchema = new Schema<SheetHistoryEntry>(
  {
    status: { type: String, enum: SHEET_STATUSES, required: true },
    at: { type: Date, required: true },
    byUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    byName: { type: String, required: true },
    remark: { type: String, trim: true, maxlength: 2000, default: null },
  },
  { _id: false },
);

const sheetSchema = new Schema<Sheet>(
  {
    trialId: { type: Schema.Types.ObjectId, ref: 'Trial', required: true },
    experimentId: { type: Schema.Types.ObjectId, ref: 'Experiment', required: true },
    centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true },
    year: { type: Number, required: true, min: 1900, max: 2100 },
    seasonCode: { type: String, required: true, uppercase: true },
    croppingSystemCode: { type: String, uppercase: true, default: null },
    cropCode: { type: String, uppercase: true, default: null },
    status: { type: String, enum: SHEET_STATUSES, default: 'Draft' },
    history: { type: [historySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

sheetSchema.index(
  { trialId: 1, year: 1, seasonCode: 1, croppingSystemCode: 1, cropCode: 1 },
  { unique: true, name: 'one_sheet_per_trial_season_year' },
);
sheetSchema.index({ experimentId: 1, year: 1, seasonCode: 1, status: 1 });
sheetSchema.index({ centreId: 1, status: 1 });

export const SheetModel = model<Sheet>('Sheet', sheetSchema);

export interface Observation {
  sheetId: Types.ObjectId;
  /** 1…mainPlotCount / 1…subPlotCount for split- and strip-plot designs; null for a single plot. */
  mainPlot: number | null;
  subPlot: number | null;
  treatmentCode: string;
  /** 1…r for plot-level parameters; null for treatment-level ones. */
  replication: number | null;
  parameterId: Types.ObjectId;
  valueNumber: number | null;
  /** Text, choice and date (ISO yyyy-mm-dd) values. */
  valueText: string | null;
  updatedBy?: Types.ObjectId;
  updatedAt: Date;
}

const observationSchema = new Schema<Observation>(
  {
    sheetId: { type: Schema.Types.ObjectId, ref: 'Sheet', required: true },
    mainPlot: { type: Number, min: 1, default: null },
    subPlot: { type: Number, min: 1, default: null },
    treatmentCode: { type: String, required: true, uppercase: true },
    replication: { type: Number, min: 1, default: null },
    parameterId: { type: Schema.Types.ObjectId, ref: 'Parameter', required: true },
    valueNumber: { type: Number, default: null },
    valueText: { type: String, maxlength: 2000, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

observationSchema.index(
  { sheetId: 1, mainPlot: 1, subPlot: 1, treatmentCode: 1, replication: 1, parameterId: 1 },
  { unique: true, name: 'one_value_per_plot_cell' },
);
observationSchema.index({ parameterId: 1 });

export const ObservationModel = model<Observation>('Observation', observationSchema);
