import jStat from 'jstat';
import type { TreatmentMean } from './sheets.analysis.js';

// Factorial, split-plot and split-split-plot ANOVA for one parameter of one sheet. Pure: no
// database access.
//
// Treatments are combinations of factor levels (A × B, or A × B × C), laid out in r replications
// (blocks). Sums of squares come from marginal totals: for any set S of terms (R = replication,
// A, B, C), raw(S) = Σ over the cells of S of (cell total)² / (observations per cell) − CF.
// A factor or interaction's SS is raw(S) minus the SS of every lower-order term inside S.
//   Factorial in RBD:   R, A, B, A×B (, C, A×C, B×C, A×B×C), Error = Total − the rest,
//                       df (r−1)(abc−1)
//   Split plot:         R, A, Error (a) = R×A − R − A, B, A×B, Error (b) = Total − the rest
//   Split-split plot:   R, A, Error (a), B, A×B, Error (b) = R×A×B − R − A − Ea − B − A×B,
//                       C, A×C, B×C, A×B×C, Error (c) = Total − the rest
// In split designs the replications and A are tested against Error (a), the B terms against
// Error (b) and the C terms against Error (c) (Gomez & Gomez, Statistical Procedures for
// Agricultural Research, ch. 3–4). Complete, balanced data only.

export type FactorialKind = 'factorial' | 'split' | 'split-split';
export type FactorKey = 'A' | 'B' | 'C';

export interface FactorSpec {
  key: FactorKey;
  /** "Main plot", "Sub plot" … or "Factor A" … */
  label: string;
  levels: { code: string; name: string | null }[];
}

export interface FactorialRow {
  source: string;
  df: number;
  ss: number;
  ms: number | null;
  f: number | null;
  p: number | null;
}

export interface FactorialAnova {
  kind: FactorialKind;
  table: FactorialRow[];
  /** CV % for each error term ("Error", or "Error (a)" …). */
  cv: { error: string; value: number }[];
  /** Some factor or interaction differs significantly at 5 %. */
  significant: boolean;
  /** The mean of each level of each factor. */
  factorMeans: {
    key: FactorKey;
    label: string;
    levels: { code: string; name: string | null; mean: number }[];
  }[];
}

export interface FactorialResult {
  means: TreatmentMean[];
  grandMean: number | null;
  factorial: FactorialAnova | null;
  reason?: string;
}

const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Every non-empty subset of the factor keys, smallest first (A, B, AB …). */
const subsets = (keys: FactorKey[]): FactorKey[][] =>
  keys
    .reduce<FactorKey[][]>((acc, k) => [...acc, ...acc.map((s) => [...s, k])], [[]])
    .filter((s) => s.length)
    .sort((a, b) => a.length - b.length);

/**
 * @param values      values keyed by treatment code, then replication number
 * @param treatments  each treatment with the level it has of every factor
 * @param factors     the factors (A, B and, for split-split plot or a 3-factor factorial, C)
 */
export function factorialAnalysis(
  values: Map<string, Map<number | null, number>>,
  treatments: { code: string; levels: Partial<Record<FactorKey, string | null>> }[],
  factors: FactorSpec[],
  replications: number | null,
  kind: FactorialKind,
): FactorialResult {
  const means: TreatmentMean[] = treatments.map(({ code }) => {
    const xs = [...(values.get(code)?.values() ?? [])];
    return { treatmentCode: code, n: xs.length, mean: xs.length ? round(sum(xs) / xs.length) : null };
  });
  const all = [...values.values()].flatMap((m) => [...m.values()]);
  const grandMean = all.length ? round(sum(all) / all.length) : null;
  const none = (reason: string): FactorialResult => ({ means, grandMean, factorial: null, reason });

  const r = replications ?? 0;
  if (r < 2) return none('Not a replicated design');
  const needed = kind === 'split-split' ? 3 : 2;
  if (factors.length < needed || factors.some((f) => f.levels.length < 2)) {
    return none('The factors and their levels (at least 2 each) are not set up in the protocol');
  }
  // Every combination of levels must be exactly one treatment.
  const combos = factors.reduce((count, f) => count * f.levels.length, 1);
  const seen = new Set<string>();
  for (const t of treatments) {
    const key = factors.map((f) => t.levels[f.key] ?? '').join('|');
    if (seen.has(key) || factors.some((f) => !f.levels.some((l) => l.code === t.levels[f.key]))) {
      return none('Treatments are not one per combination of the factor levels');
    }
    seen.add(key);
  }
  if (seen.size !== combos) return none('Treatments are not one per combination of the factor levels');

  type Obs = { R: string; y: number } & Partial<Record<FactorKey, string>>;
  const obs: Obs[] = [];
  for (const t of treatments) {
    for (let rep = 1; rep <= r; rep++) {
      const y = values.get(t.code)?.get(rep);
      if (y === undefined) return none(`Incomplete data: ${t.code} R${rep} missing`);
      const levels: Partial<Record<FactorKey, string>> = {};
      for (const f of factors) levels[f.key] = t.levels[f.key] ?? '';
      obs.push({ R: String(rep), y, ...levels });
    }
  }

  const n = obs.length;
  const G = sum(obs.map((o) => o.y));
  const CF = (G * G) / n;
  const ssTotal = sum(obs.map((o) => o.y * o.y)) - CF;
  const raw = (terms: ('R' | FactorKey)[]) => {
    const totals = new Map<string, number>();
    for (const o of obs) {
      const key = terms.map((t) => o[t]).join('|');
      totals.set(key, (totals.get(key) ?? 0) + o.y);
    }
    const perCell = n / totals.size;
    return sum([...totals.values()].map((x) => x * x)) / perCell - CF;
  };

  const keys = factors.map((f) => f.key);
  const termSS = new Map<string, number>();
  for (const s of subsets(keys)) {
    let ss = raw(s);
    for (const sub of subsets(s)) if (sub.length < s.length) ss -= termSS.get(sub.join(''))!;
    termSS.set(s.join(''), ss);
  }
  const levelsOf = (k: FactorKey) => factors.find((f) => f.key === k)!.levels.length;
  const dfOf = (term: string) => [...term].reduce((d, k) => d * (levelsOf(k as FactorKey) - 1), 1);
  const labelOf = (term: string) => [...term].map((k) => factors.find((f) => f.key === k)!.label).join(' × ');

  const ssRep = raw(['R']);
  const a = levelsOf('A');
  const b = levelsOf('B');
  const c = keys.includes('C') ? levelsOf('C') : 1;
  const factorSS = sum([...termSS.values()]);

  type Term = { source: string; ss: number; df: number; error?: string };
  const rows: Term[] = [];
  const errors: Record<string, { ss: number; df: number }> = {};
  const factorRow = (term: string, error: string) =>
    rows.push({ source: labelOf(term), ss: termSS.get(term)!, df: dfOf(term), error });

  if (kind === 'factorial') {
    rows.push({ source: 'Replications', ss: ssRep, df: r - 1, error: 'Error' });
    for (const s of subsets(keys)) factorRow(s.join(''), 'Error');
    errors.Error = { ss: ssTotal - ssRep - factorSS, df: (r - 1) * (a * b * c - 1) };
    rows.push({ source: 'Error', ...errors.Error });
  } else {
    const ea = raw(['R', 'A']) - ssRep - termSS.get('A')!;
    errors['Error (a)'] = { ss: ea, df: (r - 1) * (a - 1) };
    rows.push({ source: 'Replications', ss: ssRep, df: r - 1, error: 'Error (a)' });
    factorRow('A', 'Error (a)');
    rows.push({ source: 'Error (a)', ...errors['Error (a)'] });
    if (kind === 'split') {
      factorRow('B', 'Error (b)');
      factorRow('AB', 'Error (b)');
      errors['Error (b)'] = { ss: ssTotal - ssRep - ea - factorSS, df: a * (r - 1) * (b - 1) };
      rows.push({ source: 'Error (b)', ...errors['Error (b)'] });
    } else {
      const eb = raw(['R', 'A', 'B']) - ssRep - termSS.get('A')! - ea - termSS.get('B')! - termSS.get('AB')!;
      errors['Error (b)'] = { ss: eb, df: a * (r - 1) * (b - 1) };
      factorRow('B', 'Error (b)');
      factorRow('AB', 'Error (b)');
      rows.push({ source: 'Error (b)', ...errors['Error (b)'] });
      for (const term of ['C', 'AC', 'BC', 'ABC']) factorRow(term, 'Error (c)');
      errors['Error (c)'] = { ss: ssTotal - ssRep - ea - eb - factorSS, df: a * b * (r - 1) * (c - 1) };
      rows.push({ source: 'Error (c)', ...errors['Error (c)'] });
    }
  }
  if (Object.values(errors).some((e) => e.df <= 0)) {
    return none('Not enough replications or levels to estimate the error');
  }

  const msOf = (e: { ss: number; df: number }) => Math.max(0, e.ss) / e.df;
  let significant = false;
  const table: FactorialRow[] = rows.map((t) => {
    const ss = Math.max(0, t.ss);
    const ms = ss / t.df;
    const err = t.error ? errors[t.error] : undefined;
    if (!err) return { source: t.source, df: t.df, ss: round(ss), ms: round(ms), f: null, p: null };
    const mse = msOf(err);
    const f = mse > 0 ? ms / mse : null;
    const p = f === null ? null : 1 - jStat.centralF.cdf(f, t.df, err.df);
    if (p !== null && p < 0.05 && t.source !== 'Replications') significant = true;
    return {
      source: t.source,
      df: t.df,
      ss: round(ss),
      ms: round(ms),
      f: f === null ? null : round(f),
      p: p === null ? null : round(p),
    };
  });
  table.push({ source: 'Total', df: n - 1, ss: round(ssTotal), ms: null, f: null, p: null });

  const mean = G / n;
  return {
    means,
    grandMean,
    factorial: {
      kind,
      table,
      cv: Object.entries(errors).map(([error, e]) => ({
        error,
        value: round((Math.sqrt(msOf(e)) / mean) * 100, 2),
      })),
      significant,
      factorMeans: factors.map((f) => ({
        key: f.key,
        label: f.label,
        levels: f.levels.map((l) => {
          const ys = obs.filter((o) => o[f.key] === l.code).map((o) => o.y);
          return { code: l.code, name: l.name, mean: round(sum(ys) / ys.length) };
        }),
      })),
    },
  };
}
