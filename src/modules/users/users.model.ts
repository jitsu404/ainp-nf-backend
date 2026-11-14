import { Schema, type Types, model } from 'mongoose';
import { ROLE_IDS, ROLES, type RoleId } from '../../config/constants.js';

export interface User {
  name: string;
  email: string;
  passwordHash: string;
  roleId: RoleId;
  centreId: Types.ObjectId | null;
  designation?: string;
  isActive: boolean;
  lastLoginAt?: Date;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<User>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 200 },
    // Never returned by queries unless explicitly selected with .select('+passwordHash').
    passwordHash: { type: String, required: true, select: false },
    roleId: { type: String, enum: ROLE_IDS, required: true },
    centreId: {
      type: Schema.Types.ObjectId,
      ref: 'Centre',
      default: null,
      // Centre-level roles must belong to a centre.
      required: function (this: User) {
        return ROLES[this.roleId]?.scope === 'centre';
      },
    },
    designation: { type: String, trim: true, maxlength: 120 },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret._id;
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

userSchema.index({ centreId: 1, roleId: 1 });

export const UserModel = model<User>('User', userSchema);
