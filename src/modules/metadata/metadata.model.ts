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
  datasetTitle: string | null;
  description: string | null;
  coPis: CoPi[];
  completionDate: Date | null;
  plotSize: string | null;
  dataFormat: string[];
  instruments: string | null;
  availabilityLocation: string | null;
  embargoYears: number | null;
  source: string | null;
  relation: string | null;
  citation: string | null;
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
    datasetTitle: text(300),
    description: text(2000),
    coPis: { type: [coPiSchema], default: [] },
    completionDate: { type: Date, default: null },
    plotSize: text(200),
    dataFormat: { type: [{ type: String, enum: DATA_FORMATS }], default: [] },
    instruments: text(2000),
    availabilityLocation: { type: String, enum: [...AVAILABILITY_LOCATIONS, null], default: null },
    embargoYears: { type: Number, min: 0, max: 20, default: null },
    source: text(500),
    relation: text(1000),
    citation: text(2000),
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
