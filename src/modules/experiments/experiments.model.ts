import { Schema, type Types, model } from 'mongoose';
import { ALL_TRIAL_FIELD_KEYS } from '../metadata/metadata.fields.js';

// An experiment is the PCU's protocol (the "technical programme"): design, common treatments and
// default parameters recorded across participating centres. It is assigned to centres; each centre
// runs it as a trial (modules/trials) with its own cropping systems and practices, and records data in sheets.

// Designs used in AINP-NF, as named in the Annual Report 2025-26 (RBD = randomized complete block,
// split plot and strip plot in 7.2.x, farmer-participatory validation in 7.2.6, the geo-referenced
// characterization survey in 7.1.1). Keep in sync with client/src/config/constants.js.
export const EXPERIMENT_DESIGNS = [
  'RBD',
  'Split plot',
  'Strip plot',
  'Split-split plot',
  'Factorial',
  'Non-replicated',
  'Farmer participatory',
  'Survey',
] as const;
export type ExperimentDesign = (typeof EXPERIMENT_DESIGNS)[number];

/** Must have at least 2 replications. */
export const DESIGNS_NEEDING_REPLICATIONS: readonly ExperimentDesign[] = [
  'RBD',
  'Split plot',
  'Split-split plot',
  'Factorial',
];
/** Never replicated: data is one value per treatment. Strip plot may be either (both occur). */
export const DESIGNS_WITHOUT_REPLICATIONS: readonly ExperimentDesign[] = [
  'Non-replicated',
  'Farmer participatory',
  'Survey',
];
/**
 * Designs laid out in plots: each main plot × sub plot is one plot, and every plot is a complete
 * RBD of the treatments × replications. Their mainPlotCount and subPlotCount must be ≥ 1 (other
 * designs keep 0, a single plot). Strip plot uses the same layout (horizontal × vertical strips).
 */
export const DESIGNS_WITH_PLOTS: readonly ExperimentDesign[] = [
  'Split plot',
  'Strip plot',
  'Split-split plot',
];
/** Largest number of main plots or sub plots, so the entry grid stays usable. */
export const MAX_PLOT_COUNT = 10;
/** Designs the analysis service can run an ANOVA for (per plot for split and strip plot). */
export const DESIGNS_WITH_ANOVA: readonly ExperimentDesign[] = [
  'RBD',
  'Split plot',
  'Strip plot',
  'Split-split plot',
  'Factorial',
];

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
  mainPlotCode?: string | null;
  subPlotCode?: string | null;
  subSubPlotCode?: string | null;
}

export interface ExperimentParameter {
  parameterId: Types.ObjectId;
  /** Grouping in forms and reports: "Growth & yield", "Soil after crop cycle", "Economics" … */
  section: string;
  level: ParameterLevel;
  required: boolean;
}

/**
 * ICAR metadata fields stored at the experiment level (defaults for every centre).
 * null or undefined means "use the default".
 */
export interface ExperimentMetadata {
  smdName?: string | null;
  instituteName?: string | null;
  unitType?: string | null;
  unitName?: string | null;
  projectTitle?: string | null;
  projectCode?: string | null;
  datasetTitle?: string | null;
  description?: string | null;
  piNames?: string | null;
  piDesignations?: string | null;
  piEmails?: string | null;
  coPis?: { name: string; designation?: string | null; email?: string | null }[];
  fundingType?: string | null;
  fundingSource?: string | null;
  subject?: string | null;
  keywords?: string | null;
  commodity?: string | null;
  completionDate?: Date | string | null;
  dataCategory?: string | null;
  design?: string | null;
  plotSize?: string | null;
  dataFormat?: string[];
  dataType?: string | null;
  methodology?: string | null;
  instruments?: string | null;
  dataScale?: string | null;
  language?: string | null;
  temporalExtent?: string | null;
  seasons?: string | null;
  spatialExtent?: string | null;
  availabilityLocation?: string | null;
  custodian?: string | null;
  embargoYears?: number | null;
  source?: string | null;
  relation?: string | null;
  citation?: string | null;
  attributes?: string | null;
  resource?: string | null;
}
export const EXPERIMENT_METADATA_KEYS = ALL_TRIAL_FIELD_KEYS;

export interface Experiment {
  code: string;
  title: string;
  /** Code of a programme master item (P1–P4). */
  programmeCode: string;
  objectives: string[];
  design: ExperimentDesign;
  /** Replications for replicated designs; null for non-replicated trials and surveys. */
  replications: number | null;
  /** Main plots, sub plots, sub-sub plots (DESIGNS_WITH_PLOTS); 0 for designs that are a single plot. */
  mainPlotCount: number;
  subPlotCount: number;
  subSubPlotCount: number;
  treatments: Treatment[];
  mainPlotData: Treatment[];
  subPlotData: Treatment[];
  subSubPlotData: Treatment[];
  /** The treatment others are compared with ("% vs reference"), e.g. the AI-NPOF package. */
  referenceTreatmentCode: string | null;
  /** The parameters every centre records (the library entries with section, level, required). */
  defaultParameters: ExperimentParameter[];
  /**
   * Seasons in which data is recorded: season master code → master item ids for that season.
   * An empty map means any season.
   */
  seasons: Map<string, Types.ObjectId[]>;
  /** Calendar years the experiment runs (2026 covers financial year 2026-27). */
  startYear: number;
  startYearDate: Date;
  endYear: number;
  endYearDate: Date;
  status: ExperimentStatus;
  /** Centres running it; each gets a trial (trials.ensureTrials). Set by the PCU. */
  centreIds: Types.ObjectId[];
  /** The Experiment PI seat (users, role epi) that owns the definition; set by the PCU. */
  piUserId: Types.ObjectId | null;
  /**
   * Set once any centre has recorded data. From then on the design, replications and existing
   * treatments/defaultParameters are frozen (new ones can still be added), so recorded data stays valid.
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
    mainPlotCode: { type: String, trim: true, uppercase: true, maxlength: 20, default: null },
    subPlotCode: { type: String, trim: true, uppercase: true, maxlength: 20, default: null },
    subSubPlotCode: { type: String, trim: true, uppercase: true, maxlength: 20, default: null },
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

const metaText = (maxlength: number) => ({ type: String, trim: true, maxlength, default: null });

const experimentCoPiSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    designation: { type: String, trim: true, maxlength: 150, default: null },
    email: { type: String, trim: true, lowercase: true, maxlength: 200, default: null },
  },
  { _id: false },
);

const experimentMetadataSchema = new Schema<ExperimentMetadata>(
  {
    smdName: metaText(500),
    instituteName: metaText(500),
    unitType: metaText(200),
    unitName: metaText(500),
    projectTitle: metaText(500),
    projectCode: metaText(500),
    datasetTitle: metaText(300),
    description: metaText(2000),
    piNames: metaText(500),
    piDesignations: metaText(500),
    piEmails: metaText(500),
    coPis: { type: [experimentCoPiSchema], default: [] },
    fundingType: metaText(200),
    fundingSource: metaText(500),
    subject: metaText(500),
    keywords: metaText(500),
    commodity: metaText(500),
    completionDate: { type: Date, default: null },
    dataCategory: metaText(200),
    design: metaText(500),
    plotSize: metaText(200),
    dataFormat: { type: [String], default: [] },
    dataType: metaText(200),
    methodology: metaText(4000),
    instruments: metaText(2000),
    dataScale: metaText(200),
    language: metaText(200),
    temporalExtent: metaText(500),
    seasons: metaText(500),
    spatialExtent: metaText(500),
    availabilityLocation: metaText(200),
    custodian: metaText(500),
    embargoYears: { type: Number, min: 0, max: 20, default: null },
    source: metaText(500),
    relation: metaText(1000),
    citation: metaText(2000),
    attributes: metaText(4000),
    resource: metaText(2000),
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
    mainPlotCount: { type: Number, min: 0, max: MAX_PLOT_COUNT, default: 0 },
    subPlotCount: { type: Number, min: 0, max: MAX_PLOT_COUNT, default: 0 },
    subSubPlotCount: { type: Number, min: 0, max: MAX_PLOT_COUNT, default: 0 },
    treatments: { type: [treatmentSchema], default: [] },
    mainPlotData: { type: [treatmentSchema], default: [] },
    subPlotData: { type: [treatmentSchema], default: [] },
    subSubPlotData: { type: [treatmentSchema], default: [] },
    referenceTreatmentCode: { type: String, default: null },
    defaultParameters: { type: [experimentParameterSchema], default: [] },
    seasons: {
      type: Map,
      of: [
        {
          type: Schema.Types.ObjectId,
          ref: 'MasterItem',
        },
      ],
      default: () => new Map(),
    },
    startYear: { type: Number, required: true },
    startYearDate: { type: Date, required: true },
    endYear: { type: Number, required: true },
    endYearDate: { type: Date, required: true },
    status: { type: String, enum: EXPERIMENT_STATUSES, default: 'Draft' },
    centreIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Centre' }], default: [] },
    piUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    dataLocked: { type: Boolean, default: false },
    metadata: { type: experimentMetadataSchema, default: () => ({}) },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

experimentSchema.index({ programmeCode: 1, code: 1 });
experimentSchema.index({ startYear: 1, endYear: 1 });
experimentSchema.index({ centreIds: 1 });
// An Experiment PI seat leads one experiment at a time.
experimentSchema.index(
  { piUserId: 1 },
  {
    unique: true,
    partialFilterExpression: { piUserId: { $type: 'objectId' } },
    name: 'one_experiment_per_pi',
  },
);

export const ExperimentModel = model<Experiment>('Experiment', experimentSchema);
