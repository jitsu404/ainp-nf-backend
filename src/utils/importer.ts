import { z, type ZodType } from 'zod';
import type { SheetRow } from './excel.js';

// Validates spreadsheet rows against a Zod row schema. Every problem is reported with its row
// number and field, so the preview can show exactly what to fix. Nothing is written here:
// services save only when there are no errors (imports are all-or-nothing).

export interface RowError {
  row: number;
  field?: string;
  message: string;
}

export interface ValidatedRows<T> {
  valid: { row: number; data: T }[];
  errors: RowError[];
}

export interface ImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  errors: RowError[];
}

export const validateRows = <S extends ZodType>(
  rows: SheetRow[],
  schema: S,
  /** Unique key per row (e.g. code); repeated keys within one file are errors. */
  keyOf?: (data: z.output<S>) => string,
): ValidatedRows<z.output<S>> => {
  const valid: { row: number; data: z.output<S> }[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();

  for (const { row, values } of rows) {
    // Empty cells are "not provided", not empty strings.
    const input = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== ''));
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const { fieldErrors, formErrors } = z.flattenError(parsed.error) as {
        fieldErrors: Record<string, string[] | undefined>;
        formErrors: string[];
      };
      for (const [field, messages] of Object.entries(fieldErrors)) {
        for (const message of messages ?? []) errors.push({ row, field, message });
      }
      for (const message of formErrors) errors.push({ row, message });
      continue;
    }
    if (keyOf) {
      const key = keyOf(parsed.data);
      const first = seen.get(key);
      if (first !== undefined) {
        errors.push({ row, message: `Duplicate of row ${first} (${key})` });
        continue;
      }
      seen.set(key, row);
    }
    valid.push({ row, data: parsed.data });
  }
  return { valid, errors };
};

/** Coerces spreadsheet cells: numbers stored as text, "yes"/"no" booleans, trimmed strings. */
export const cell = {
  text: () => z.preprocess((v) => (v === null || v === undefined ? undefined : String(v).trim()), z.string()),
  number: () =>
    z.preprocess(
      (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
      z.number({ error: 'Must be a number' }),
    ),
  bool: () =>
    z.preprocess(
      (v) => {
        if (typeof v === 'boolean') return v;
        const s = String(v ?? '')
          .trim()
          .toLowerCase();
        return ['yes', 'y', 'true', '1', 'active'].includes(s)
          ? true
          : ['no', 'n', 'false', '0', 'inactive'].includes(s)
            ? false
            : v;
      },
      z.boolean({ error: 'Use Yes or No' }),
    ),
};
