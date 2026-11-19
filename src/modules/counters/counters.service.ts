import type { ClientSession } from 'mongoose';
import { CounterModel } from './counters.model.js';

/** Atomically increments and returns the next number of a sequence (1 for a new key). */
export const getNextSequence = async (key: string, session?: ClientSession): Promise<number> => {
  const counter = await CounterModel.findOneAndUpdate(
    { key },
    { $inc: { lastCount: 1 } },
    { returnDocument: 'after', upsert: true, session },
  );
  if (!counter) throw new Error(`Counter ${key} was not created`);
  return counter.lastCount;
};

/** The next experiment code: AINP-NF-EXPT-001, AINP-NF-EXPT-002 … */
export const generateExperimentCode = async (session?: ClientSession): Promise<string> => {
  const seq = await getNextSequence('experiment', session);
  return `AINP-NF-EXPT-${String(seq).padStart(3, '0')}`;
};
