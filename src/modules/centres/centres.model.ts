import { Schema, type Types, model } from 'mongoose';
import { CENTRE_TYPES, type CentreType } from '../../config/constants.js';

export interface Centre {
  code: string;
  name: string;
  host: string;
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
    state: { type: String, required: true, trim: true, maxlength: 60 },
    type: { type: String, enum: CENTRE_TYPES, required: true, default: 'Network Centre' },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

centreSchema.index({ state: 1, name: 1 });

export const CentreModel = model<Centre>('Centre', centreSchema);
