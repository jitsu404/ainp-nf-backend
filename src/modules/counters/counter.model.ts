import { type ClientSession, Schema, model } from 'mongoose';

export interface Counter {
  key: string;
  lastCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const counterSchema = new Schema<Counter>(
  {
    key: { type: String, required: true, unique: true },
    lastCount: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

export const CounterModel = model<Counter>('Counter', counterSchema);

/**
 * Atomically increments and returns the next sequence number for a given counter key.
 */
export const getNextSequence = async (key: string, session?: ClientSession): Promise<number> => {
  const counter = await CounterModel.findOneAndUpdate(
    { key },
    { $inc: { lastCount: 1 } },
    { new: true, upsert: true, session },
  );
  return counter.lastCount;
};

/**
 * Generates an experiment code using the format: AINP-NF-EXPT-001
 */
export const generateExperimentCode = async (session?: ClientSession): Promise<string> => {
  const seq = await getNextSequence('experiment', session);
  return `AINP-NF-EXPT-${String(seq).padStart(3, '0')}`;
};
