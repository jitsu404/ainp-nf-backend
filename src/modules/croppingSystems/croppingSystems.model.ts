import { Schema, type Types, model } from 'mongoose';

// A cropping system from the masters: one season, its main crop and any intercrops grown with it
// ("Rice + Soybean + Pigeonpea", Kharif). A rotation over several seasons is several systems. Any
// number of systems may share a season and main crop. The PCU keeps the list; experiments pick a
// system as a sub plot level (split / split-split plot) and each centre records its own varieties,
// spacings, row ratios and seed rates for the systems it grows (trial.croppingSystems).

export const MAX_INTERCROPS = 5;

export interface CroppingSystem {
  /** Generated: CSY-001 … */
  code: string;
  /** Typed, or made from the crops ("Rice + Soybean") when left empty. */
  name: string;
  description?: string | null;
  seasonCode: string;
  mainCropCode: string;
  intercropCodes: string[];
  isActive: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const croppingSystemSchema = new Schema<CroppingSystem>(
  {
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000, default: null },
    seasonCode: { type: String, required: true, uppercase: true, trim: true },
    mainCropCode: { type: String, required: true, uppercase: true, trim: true },
    intercropCodes: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= MAX_INTERCROPS,
        message: `At most ${MAX_INTERCROPS} intercrops`,
      },
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

croppingSystemSchema.index({ code: 1 }, { unique: true });
croppingSystemSchema.index({ seasonCode: 1, mainCropCode: 1 });

export const CroppingSystemModel = model<CroppingSystem>('CroppingSystem', croppingSystemSchema);
