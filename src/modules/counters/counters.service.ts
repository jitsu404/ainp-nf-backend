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

/**
 * A generated code series: counter key, the code for a number, and the pattern that recognises
 * the series' own codes (to find the highest one already used).
 */
export interface CodeSeries {
  key: string;
  format: (n: number) => string;
  pattern: RegExp;
}

const series = (key: string, prefix: string): CodeSeries => ({
  key,
  format: (n) => `${prefix}${String(n).padStart(3, '0')}`,
  pattern: new RegExp(`^${prefix}(\\d+)$`),
});

/**
 * Crops CRP-001 …, units UNT-001 …, parameters PRM_001 … (formulas can't contain "-"), cropping
 * systems CSY-001 …, programmes P1, P2 … (no padding: they appear inside experiment codes).
 */
export const CODE_SERIES = {
  programme: { key: 'programme', format: (n: number) => `P${n}`, pattern: /^P(\d+)$/ },
  crop: series('crop', 'CRP-'),
  croppingSystem: series('croppingSystem', 'CSY-'),
  unit: series('unit', 'UNT-'),
  parameter: series('parameter', 'PRM_'),
} as const satisfies Record<string, CodeSeries>;

/**
 * The next free code of a series. Inside a transaction the counter's increment is rolled back with
 * it, so a failed create leaves no gap. A number whose code is already taken (`isTaken`) is skipped.
 */
export const nextCode = async (
  s: CodeSeries,
  isTaken: (code: string) => Promise<boolean>,
  session?: ClientSession,
): Promise<string> => {
  for (;;) {
    const code = s.format(await getNextSequence(s.key, session));
    if (!(await isTaken(code))) return code;
  }
};

/** The number in one of the series' own codes ("CRP-012" → 12), or null for any other code. */
export const codeNumber = (s: CodeSeries, code: string): number | null => {
  const m = s.pattern.exec(code);
  return m ? Number(m[1]) : null;
};

/** Raises a counter to at least `count` (never lowers it), e.g. after codes were assigned in bulk. */
export const raiseCounter = async (key: string, count: number, session?: ClientSession) => {
  await CounterModel.updateOne({ key }, { $max: { lastCount: count } }, { upsert: true, session });
};

/**
 * The next experiment code of a programme, numbered per programme: AINP-NF-P2-EXPT-001,
 * AINP-NF-P2-EXPT-002 … A number whose code is already taken (`isTaken`) is skipped.
 */
export const generateExperimentCode = async (
  programmeCode: string,
  isTaken: (code: string) => Promise<boolean>,
  session?: ClientSession,
): Promise<string> =>
  nextCode(
    {
      key: `experiment:${programmeCode}`,
      format: (n) => `AINP-NF-${programmeCode}-EXPT-${String(n).padStart(3, '0')}`,
      pattern: new RegExp(`^AINP-NF-${programmeCode}-EXPT-(\\d+)$`),
    },
    isTaken,
    session,
  );
