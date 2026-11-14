import { Schema, type Types, model } from 'mongoose';
import { CENTRE_TYPES, type CentreType } from '../../config/constants.js';

export interface Centre {
  code: string;
  name: string;
  /** Host institution, e.g. "Punjab Agricultural University, Ludhiana". */
  host: string;
  /** Host short name, e.g. "PAU". */
  hostShort?: string;
  /** Host type: SAU, ICAR, Deemed University, CAU …  */
  hostType?: string;
  city?: string;
  pincode?: string;
  /** Agro-climatic zone (Planning Commission), e.g. "Trans Gangetic Plains". */
  zone?: string;
  state: string;
  type: CentreType;
  isActive: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const centreSchema = new Schema<Centre>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 10 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    host: { type: String, required: true, trim: true, maxlength: 200 },
    hostShort: { type: String, trim: true, maxlength: 40 },
    hostType: { type: String, trim: true, maxlength: 40 },
    city: { type: String, trim: true, maxlength: 80 },
    pincode: { type: String, trim: true, match: /^\d{6}$/ },
    state: { type: String, required: true, trim: true, maxlength: 60 },
    zone: { type: String, trim: true, maxlength: 80 },
    type: { type: String, enum: CENTRE_TYPES, required: true, default: 'Network Centre' },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

centreSchema.index({ state: 1, name: 1 });

export const CentreModel = model<Centre>('Centre', centreSchema);
