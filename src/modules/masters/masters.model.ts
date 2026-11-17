import { Schema, type Types, model } from 'mongoose';
import { MASTER_TYPE_IDS, type MasterType } from './masters.types.js';

export interface MasterItem {
  type: MasterType;
  /** Stable identifier used by other records and imports (e.g. KHARIF, RE, P2). */
  code: string;
  name: string;
  group?: string | null;
  description?: string | null;
  sortOrder: number;
  isActive: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  linkedTo: Types.ObjectId | null;
  metaData?: Record<string, unknown> | null;
}

const masterItemSchema = new Schema<MasterItem>(
  {
    type: { type: String, enum: MASTER_TYPE_IDS, required: true },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 30 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    group: { type: String, trim: true, maxlength: 60, default: null },
    description: { type: String, trim: true, maxlength: 500, default: null },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    linkedTo: { type: Schema.Types.ObjectId, ref: 'MasterItem', default: null },
    metaData: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

masterItemSchema.index({ type: 1, code: 1 }, { unique: true });
masterItemSchema.index({ type: 1, sortOrder: 1, name: 1 });

export const MasterItemModel = model<MasterItem>('MasterItem', masterItemSchema);
