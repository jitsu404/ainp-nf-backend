import { describe, expect, it } from 'vitest';
import {
  type FactorKey,
  type FactorSpec,
  factorialAnalysis,
} from '../src/modules/sheets/sheets.factorial.js';

// The factorial / split-plot ANOVA (marginal totals) checked against sums of squares computed
// independently from deviations of means (Gomez & Gomez definitions), on made-up data.

type Row = { R: number; A: string; B: string; C?: string; y: number };

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const groupMeans = (rows: Row[], keys: (keyof Row)[]) => {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = keys.map((key) => r[key]).join('|');
    groups.set(k, [...(groups.get(k) ?? []), r.y]);
  }
  return new Map([...groups].map(([k, ys]) => [k, mean(ys)]));
};
/** n_cell × Σ over cells of (effect)², with the effect built from means by inclusion–exclusion. */
const devSS = (rows: Row[], keys: (keyof Row)[]) => {
  const gm = mean(rows.map((r) => r.y));
  const subsetsOf = (ks: (keyof Row)[]): (keyof Row)[][] =>
    ks.reduce<(keyof Row)[][]>((acc, k) => [...acc, ...acc.map((s) => [...s, k])], [[]]);
  const cells = groupMeans(rows, keys);
  const perCell = rows.length / cells.size;
  let total = 0;
  for (const [key] of cells) {
    const parts = key.split('|');
    const at = Object.fromEntries(keys.map((k, i) => [k, parts[i]]));
    let effect = 0;
    for (const s of subsetsOf(keys)) {
      const sign = (keys.length - s.length) % 2 === 0 ? 1 : -1;
      const m = s.length ? groupMeans(rows, s).get(s.map((k) => at[k as string]).join('|'))! : gm;
      effect += sign * m;
    }
    total += perCell * effect * effect;
  }
  return total;
};

const build = (rows: Row[], factors: FactorSpec[]) => {
  const values = new Map<string, Map<number | null, number>>();
  const treatments: { code: string; levels: Partial<Record<FactorKey, string>> }[] = [];
  for (const r of rows) {
    const code = [r.A, r.B, r.C].filter(Boolean).join('');
    if (!values.has(code)) {
      values.set(code, new Map());
      treatments.push({ code, levels: { A: r.A, B: r.B, ...(r.C ? { C: r.C } : {}) } });
    }
    values.get(code)!.set(r.R, r.y);
  }
  return { values, treatments, factors };
};
const spec = (key: FactorKey, label: string, codes: string[]): FactorSpec => ({
  key,
  label,
  levels: codes.map((code) => ({ code, name: null })),
});
const ssOf = (table: { source: string; ss: number }[], source: string) =>
  table.find((t) => t.source === source)!.ss;

// Deterministic, uneven made-up yields.
const yieldFor = (i: number) => 40 + ((i * 37) % 23) + ((i * 11) % 7) * 0.5;

describe('factorial and split-plot ANOVA', () => {
  it('factorial 2 × 3 in RBD: A, B, A×B and error match the deviation formulas', () => {
    const rows: Row[] = [];
    let i = 0;
    for (const R of [1, 2, 3])
      for (const A of ['A1', 'A2'])
        for (const B of ['B1', 'B2', 'B3']) rows.push({ R, A, B, y: yieldFor(i++) });
    const { values, treatments, factors } = build(rows, [
      spec('A', 'Factor A', ['A1', 'A2']),
      spec('B', 'Factor B', ['B1', 'B2', 'B3']),
    ]);
    const res = factorialAnalysis(values, treatments, factors, 3, 'factorial');
    const t = res.factorial!.table;
    expect(ssOf(t, 'Factor A')).toBeCloseTo(devSS(rows, ['A']), 3);
    expect(ssOf(t, 'Factor B')).toBeCloseTo(devSS(rows, ['B']), 3);
    expect(ssOf(t, 'Factor A × Factor B')).toBeCloseTo(devSS(rows, ['A', 'B']), 3);
    expect(ssOf(t, 'Replications')).toBeCloseTo(devSS(rows, ['R']), 3);
    const total = rows.reduce((s, r) => s + (r.y - mean(rows.map((x) => x.y))) ** 2, 0);
    expect(ssOf(t, 'Total')).toBeCloseTo(total, 3);
    expect(t.map((x) => [x.source, x.df])).toEqual([
      ['Replications', 2],
      ['Factor A', 1],
      ['Factor B', 2],
      ['Factor A × Factor B', 2],
      ['Error', 10],
      ['Total', 17],
    ]);
    // A's mean over all its plots.
    const a1 = mean(rows.filter((r) => r.A === 'A1').map((r) => r.y));
    expect(res.factorial!.factorMeans[0]!.levels[0]!.mean).toBeCloseTo(a1, 3);
  });

  it('split plot: error (a) is R × A, and A is tested against it', () => {
    const rows: Row[] = [];
    let i = 0;
    for (const R of [1, 2, 3])
      for (const A of ['M1', 'M2', 'M3'])
        for (const B of ['S1', 'S2']) rows.push({ R, A, B, y: yieldFor(i++ + 5) });
    const { values, treatments, factors } = build(rows, [
      spec('A', 'Main plot', ['M1', 'M2', 'M3']),
      spec('B', 'Sub plot', ['S1', 'S2']),
    ]);
    const t = factorialAnalysis(values, treatments, factors, 3, 'split').factorial!.table;
    const ea = devSS(rows, ['R', 'A']);
    expect(ssOf(t, 'Error (a)')).toBeCloseTo(ea, 3);
    expect(t.map((x) => [x.source, x.df])).toEqual([
      ['Replications', 2],
      ['Main plot', 2],
      ['Error (a)', 4],
      ['Sub plot', 1],
      ['Main plot × Sub plot', 2],
      ['Error (b)', 6],
      ['Total', 17],
    ]);
    const a = t.find((x) => x.source === 'Main plot')!;
    expect(a.f).toBeCloseTo(a.ms! / (ea / 4), 3);
  });

  it('split-split plot: three error terms, and the parts add up to the total', () => {
    const rows: Row[] = [];
    let i = 0;
    for (const R of [1, 2, 3])
      for (const A of ['M1', 'M2'])
        for (const B of ['S1', 'S2'])
          for (const C of ['SS1', 'SS2', 'SS3']) rows.push({ R, A, B, C, y: yieldFor(i++ + 2) });
    const { values, treatments, factors } = build(rows, [
      spec('A', 'Main plot', ['M1', 'M2']),
      spec('B', 'Sub plot', ['S1', 'S2']),
      spec('C', 'Sub-sub plot', ['SS1', 'SS2', 'SS3']),
    ]);
    const t = factorialAnalysis(values, treatments, factors, 3, 'split-split').factorial!.table;
    expect(ssOf(t, 'Error (a)')).toBeCloseTo(devSS(rows, ['R', 'A']), 3);
    expect(ssOf(t, 'Error (b)')).toBeCloseTo(devSS(rows, ['R', 'B']) + devSS(rows, ['R', 'A', 'B']), 3);
    expect(ssOf(t, 'Main plot × Sub plot × Sub-sub plot')).toBeCloseTo(devSS(rows, ['A', 'B', 'C']), 3);
    expect(t.map((x) => x.df)).toEqual([2, 1, 2, 1, 1, 4, 2, 2, 2, 2, 16, 35]);
    const parts = t.filter((x) => x.source !== 'Total').reduce((s, x) => s + x.ss, 0);
    expect(parts).toBeCloseTo(ssOf(t, 'Total'), 2);
  });

  it('explains why there is no ANOVA', () => {
    const values = new Map([['T1', new Map([[1, 5]])]]);
    const f = [spec('A', 'Factor A', ['A1', 'A2']), spec('B', 'Factor B', ['B1', 'B2'])];
    expect(
      factorialAnalysis(values, [{ code: 'T1', levels: { A: 'A1', B: 'B1' } }], f, 2, 'factorial').reason,
    ).toBe('Treatments are not one per combination of the factor levels');
    const full = ['A1', 'A2'].flatMap((a) =>
      ['B1', 'B2'].map((b) => ({ code: a + b, levels: { A: a, B: b } })),
    );
    expect(factorialAnalysis(new Map(), full, f, 2, 'factorial').reason).toBe(
      'Incomplete data: A1B1 R1 missing',
    );
  });
});
