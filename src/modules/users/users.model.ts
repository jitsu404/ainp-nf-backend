import { Schema, type Types, model } from 'mongoose';
import { ROLE_IDS, ROLES, type RoleId } from '../../config/constants.js';
import { TITLES, type Title, composeName } from './users.names.js';

export interface User {
  /** Display name, always derived from the parts below ("Dr. Sujit Kumar"). Never set it directly. */
  name: string;
  title?: Title | null;
  firstName?: string;
  middleName?: string | null;
  surname?: string | null;
  email: string;
  passwordHash: string;
  roleId: RoleId;
  centreId: Types.ObjectId | null;
  designation?: string;
  mobile?: string;
  /** e.g. the host institution of the PI's centre, or ICAR-IIFSR for the PCU. */
  organization?: string;
  isActive: boolean;
  /** Set when someone else chose the password; the user must replace it before doing anything else. */
  mustChangePassword: boolean;
  lastLoginAt?: Date;
  passwordChangedAt?: Date;
  deactivatedAt?: Date | null;
  deactivatedBy?: Types.ObjectId | null;
  deactivationReason?: string | null;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<User>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    // The name parts and contact fields are required by the request DTOs. They're optional here only
    // so accounts created before they existed still load (see scripts/migrate-user-fields.ts).
    title: { type: String, enum: [...TITLES, null], default: null },
    firstName: { type: String, trim: true, maxlength: 60 },
    middleName: { type: String, trim: true, maxlength: 60, default: null },
    surname: { type: String, trim: true, maxlength: 60, default: null },
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
    mobile: { type: String, trim: true, maxlength: 20 },
    organization: { type: String, trim: true, maxlength: 200 },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    passwordChangedAt: { type: Date },
    // Users are never deleted: people leave or transfer, and their records and audit history stay.
    deactivatedAt: { type: Date, default: null },
    deactivatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deactivationReason: { type: String, trim: true, maxlength: 300, default: null },
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

// Keep the display name in step with its parts. Runs on create() and save(); services that change
// name parts must use save() (not updateOne/findOneAndUpdate) so this runs.
userSchema.pre('validate', function () {
  if (this.firstName) this.name = composeName(this);
});

userSchema.index({ centreId: 1, roleId: 1 });
// Each centre has exactly one active Centre PI. The service checks first for a clear message;
// this index is the safety net against two requests racing.
userSchema.index(
  { centreId: 1 },
  {
    unique: true,
    partialFilterExpression: { roleId: 'pi', isActive: true },
    name: 'one_active_pi_per_centre',
  },
);

export const UserModel = model<User>('User', userSchema);
