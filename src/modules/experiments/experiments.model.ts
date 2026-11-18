import { Schema, type Types, model } from 'mongoose';

// An experiment is the PCU's protocol (the "technical programme"): design, common treatments and
// the parameters every centre records. It is assigned to centres; each centre runs it as a trial
// (modules/trials) with its own cropping systems and practices, and records data in sheets.

// Designs used in AINP-NF, as named in the Annual Report 2025-26 (RBD = randomized complete block,
// split plot and strip plot in 7.2.x, farmer-participatory validation in 7.2.6, the geo-referenced
// characterization survey in 7.1.1). Keep in sync with client/src/config/constants.js.
export const EXPERIMENT_DESIGNS = [
  'RBD',
  'Split plot',
  'Strip plot',
  'Non-replicated',
  'Farmer participatory',
  'Survey',
] as const;
export type ExperimentDesign = (typeof EXPERIMENT_DESIGNS)[number];

/** Must have at least 2 replications. */
export const DESIGNS_NEEDING_REPLICATIONS: readonly ExperimentDesign[] = ['RBD', 'Split plot'];
/** Never replicated: data is one value per treatment. Strip plot may be either (both occur). */
export const DESIGNS_WITHOUT_REPLICATIONS: readonly ExperimentDesign[] = [
  'Non-replicated',
  'Farmer participatory',
  'Survey',
];
/** Designs the analysis service can run an ANOVA for; the others get treatment means only. */
export const DESIGNS_WITH_ANOVA: readonly ExperimentDesign[] = ['RBD'];

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

/**
 * ICAR metadata fields that are the same for every centre running the experiment (the PCU fills
 * them once). Centre-specific fields live in modules/metadata; null means "use the default".
 */
export interface ExperimentMetadata {
  smdName: string | null;
  instituteName: string | null;
  unitType: string | null;
  unitName: string | null;
  projectCode: string | null;
  fundingType: string | null;
  fundingSource: string | null;
  subject: string | null;
  keywords: string | null;
  dataCategory: string | null;
  dataType: string | null;
  methodology: string | null;
  dataScale: string | null;
  language: string | null;
}
export const EXPERIMENT_METADATA_KEYS = [
  'smdName',
  'instituteName',
  'unitType',
  'unitName',
  'projectCode',
  'fundingType',
  'fundingSource',
  'subject',
  'keywords',
  'dataCategory',
  'dataType',
  'methodology',
  'dataScale',
  'language',
] as const satisfies readonly (keyof ExperimentMetadata)[];

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
  /** The treatment others are compared with ("% vs reference"), e.g. the AI-NPOF package. */
  referenceTreatmentCode: string | null;
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
  metadata: ExperimentMetadata;
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

const experimentMetadataSchema = new Schema<ExperimentMetadata>(
  Object.fromEntries(
    EXPERIMENT_METADATA_KEYS.map((key) => [
      key,
      { type: String, trim: true, maxlength: key === 'methodology' ? 4000 : 500, default: null },
    ]),
  ),
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
    referenceTreatmentCode: { type: String, default: null },
    parameters: { type: [experimentParameterSchema], default: [] },
    seasons: { type: [String], default: [] },
    startYear: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    status: { type: String, enum: EXPERIMENT_STATUSES, default: 'Draft' },
    centreIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Centre' }], default: [] },
    dataLocked: { type: Boolean, default: false },
    metadata: { type: experimentMetadataSchema, default: () => ({}) },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

experimentSchema.index({ programmeCode: 1, code: 1 });
experimentSchema.index({ centreIds: 1 });

export const ExperimentModel = model<Experiment>('Experiment', experimentSchema);
