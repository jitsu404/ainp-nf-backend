import { Schema, type Types, model } from 'mongoose';

export const EXPERIMENT_ASSIGNMENT_STATUSES = [
  'In progress',
  'completed',
  'inactive',
  'partial completed',
] as const;

export type ExperimentAssignmentStatus = (typeof EXPERIMENT_ASSIGNMENT_STATUSES)[number];

export interface AssignmentMetaData {
  code?: string | null;
  title?: string | null;
  smdName?: string | null;
  instituteName?: string | null;
  unitType?: string | null;
  unitName?: string | null;
  projectCode?: string | null;
  fundingType?: string | null;
  fundingSource?: string | null;
  subject?: string | null;
  keywords?: string | null;
  dataCategory?: string | null;
  dataType?: string | null;
  methodology?: string | null;
  dataScale?: string | null;
  language?: string | null;
}

export interface ExperimentAssignment {
  experiment: Types.ObjectId;
  centre: Types.ObjectId;
  status: ExperimentAssignmentStatus;
  seasons: Map<string, Types.ObjectId[]>;
  metaData: AssignmentMetaData;
  lastUpdatedBy?: Types.ObjectId | null;
  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const metaDataSchema = new Schema<AssignmentMetaData>(
  {
    code: { type: String, trim: true, default: null },
    title: { type: String, trim: true, default: null },
    smdName: { type: String, trim: true, default: null },
    instituteName: { type: String, trim: true, default: null },
    unitType: { type: String, trim: true, default: null },
    unitName: { type: String, trim: true, default: null },
    projectCode: { type: String, trim: true, default: null },
    fundingType: { type: String, trim: true, default: null },
    fundingSource: { type: String, trim: true, default: null },
    subject: { type: String, trim: true, default: null },
    keywords: { type: String, trim: true, default: null },
    dataCategory: { type: String, trim: true, default: null },
    dataType: { type: String, trim: true, default: null },
    methodology: { type: String, trim: true, default: null },
    dataScale: { type: String, trim: true, default: null },
    language: { type: String, trim: true, default: null },
  },
  { _id: false },
);

const experimentAssignmentSchema = new Schema<ExperimentAssignment>(
  {
    experiment: { type: Schema.Types.ObjectId, ref: 'Experiment', required: true },
    centre: { type: Schema.Types.ObjectId, ref: 'Centre', required: true },
    status: {
      type: String,
      enum: EXPERIMENT_ASSIGNMENT_STATUSES,
      default: 'In progress',
      required: true,
    },
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
    metaData: {
      type: metaDataSchema,
      default: () => ({
        code: null,
        title: null,
        smdName: null,
        instituteName: null,
        unitType: null,
        unitName: null,
        projectCode: null,
        fundingType: null,
        fundingSource: null,
        subject: null,
        keywords: null,
        dataCategory: null,
        dataType: null,
        methodology: null,
        dataScale: null,
        language: null,
      }),
    },
    lastUpdatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

experimentAssignmentSchema.index({ experiment: 1, centre: 1 }, { unique: true });
experimentAssignmentSchema.index({ centre: 1 });
experimentAssignmentSchema.index({ status: 1 });

export const ExperimentAssignmentModel = model<ExperimentAssignment>(
  'ExperimentAssignment',
  experimentAssignmentSchema,
);
