import { Schema, type Types, model } from 'mongoose';
import { AVAILABILITY_LOCATIONS, DATA_FORMATS } from './metadata.fields.js';

// A centre's part of the ICAR metadata for one trial (experiment × centre). The experiment itself
// is shared by every assigned centre and is never changed by a centre; common fields live on the
// experiment (PCU) and the rest are derived when the record is read (metadata.service).

export const METADATA_STATUSES = ['Draft', 'Submitted', 'Returned', 'Approved'] as const;
export type MetadataStatus = (typeof METADATA_STATUSES)[number];
export const EDITABLE_METADATA_STATUSES: readonly MetadataStatus[] = ['Draft', 'Returned'];

export interface CoPi {
  name: string;
  designation?: string | null;
  email?: string | null;
}

export interface MetadataHistoryEntry {
  status: MetadataStatus;
  at: Date;
  byUserId: Types.ObjectId;
  byName: string;
  remark?: string | null;
}

export interface TrialMetadata {
  trialId: Types.ObjectId;
  experimentId: Types.ObjectId;
  centreId: Types.ObjectId;

  // 1–6 Institutional & Project Information
  smdName?: string | null;
  instituteName?: string | null;
  unitType?: string | null;
  unitName?: string | null;
  projectTitle?: string | null;
  projectCode?: string | null;

  // 7–8 Dataset
  datasetTitle: string | null;
  description: string | null;

  // 9–11 & Co-PIs Personnel
  piNames?: string | null;
  piDesignations?: string | null;
  piEmails?: string | null;
  coPis: CoPi[];

  // 12–16 Funding & Domain
  fundingType?: string | null;
  fundingSource?: string | null;
  subject?: string | null;
  keywords?: string | null;
  commodity?: string | null;

  // 17 Completion Date
  completionDate: Date | null;

  // 18, 20 Design & Category
  dataCategory?: string | null;
  design?: string | null;

  // 21–27 Specifications, Formats & Methodology
  plotSize: string | null;
  dataFormat: string[];
  dataType?: string | null;
  methodology?: string | null;
  instruments: string | null;
  dataScale?: string | null;
  language?: string | null;

  // 28–32 Coverage, Location & Custodian
  temporalExtent?: string | null;
  seasons?: string | null;
  spatialExtent?: string | null;
  availabilityLocation: string | null;
  custodian?: string | null;

  // 33–36 Citations & Access
  embargoYears: number | null;
  source: string | null;
  relation: string | null;
  citation: string | null;

  // 37–38 Attributes & Resources
  attributes?: string | null;
  resource?: string | null;

  status: MetadataStatus;
  history: MetadataHistoryEntry[];
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const coPiSchema = new Schema<CoPi>(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    designation: { type: String, trim: true, maxlength: 150, default: null },
    email: { type: String, trim: true, lowercase: true, maxlength: 200, default: null },
  },
  { _id: false },
);

const historySchema = new Schema<MetadataHistoryEntry>(
  {
    status: { type: String, enum: METADATA_STATUSES, required: true },
    at: { type: Date, required: true },
    byUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    byName: { type: String, required: true },
    remark: { type: String, trim: true, maxlength: 2000, default: null },
  },
  { _id: false },
);

const text = (maxlength: number) => ({ type: String, trim: true, maxlength, default: null });

const trialMetadataSchema = new Schema<TrialMetadata>(
  {
    trialId: { type: Schema.Types.ObjectId, ref: 'Trial', required: true },
    experimentId: { type: Schema.Types.ObjectId, ref: 'Experiment', required: true },
    centreId: { type: Schema.Types.ObjectId, ref: 'Centre', required: true },

    // 1–6 Institutional & Project Information
    smdName: text(500),
    instituteName: text(500),
    unitType: text(200),
    unitName: text(500),
    projectTitle: text(500),
    projectCode: text(500),

    // 7–8 Dataset
    datasetTitle: text(300),
    description: text(2000),

    // 9–11 & Co-PIs Personnel
    piNames: text(500),
    piDesignations: text(500),
    piEmails: text(500),
    coPis: { type: [coPiSchema], default: [] },

    // 12–16 Funding & Domain
    fundingType: text(200),
    fundingSource: text(500),
    subject: text(500),
    keywords: text(500),
    commodity: text(500),

    // 17 Completion Date
    completionDate: { type: Date, default: null },

    // 18, 20 Design & Category
    dataCategory: text(200),
    design: text(500),

    // 21–27 Specifications, Formats & Methodology
    plotSize: text(200),
    dataFormat: { type: [{ type: String, enum: DATA_FORMATS }], default: [] },
    dataType: text(200),
    methodology: text(4000),
    instruments: text(2000),
    dataScale: text(200),
    language: text(200),

    // 28–32 Coverage, Location & Custodian
    temporalExtent: text(500),
    seasons: text(500),
    spatialExtent: text(500),
    availabilityLocation: { type: String, enum: [...AVAILABILITY_LOCATIONS, null], default: null },
    custodian: text(500),

    // 33–36 Citations & Access
    embargoYears: { type: Number, min: 0, max: 20, default: null },
    source: text(500),
    relation: text(1000),
    citation: text(2000),

    // 37–38 Attributes & Resources
    attributes: text(4000),
    resource: text(2000),

    status: { type: String, enum: METADATA_STATUSES, default: 'Draft' },
    history: { type: [historySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

trialMetadataSchema.index({ trialId: 1 }, { unique: true, name: 'one_metadata_per_trial' });
trialMetadataSchema.index({ experimentId: 1, status: 1 });

export const TrialMetadataModel = model<TrialMetadata>('TrialMetadata', trialMetadataSchema, 'trialmetadata');
