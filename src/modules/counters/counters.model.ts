import { Schema, model } from 'mongoose';

// Named sequences (e.g. 'experiment' → 1, 2, 3 …) for human-readable codes. One document per key;
// only counters.service.ts changes them, with an atomic $inc, so two requests never get the same number.

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
