import jStat from 'jstat';

// Statistics for one parameter of one sheet. Pure functions: no database access.
//
// RCBD ANOVA with replications as blocks:
//   CF = G² / (t·r)               SS total = ΣY² − CF
//   SS treatments = ΣTᵢ² / r − CF   SS replications = ΣRⱼ² / t − CF
//   SS error = SS total − SS treatments − SS replications,  df error = (t−1)(r−1)
//   F = MS treatments / MS error,  p from the F distribution
//   CV % = √MSE / grand mean × 100,  SEm± = √(MSE / r),  SEd± = √(2·MSE / r)
//   CD (5 %) = t(0.975, df error) × SEd, reported only when treatments differ significantly.
// DMRT and pooled (multi-year / multi-location) analysis are planned for the statistics service.

export interface TreatmentMean {
  treatmentCode: string;
  n: number;
  mean: number | null;
}

export interface AnovaRow {
  source: 'Replications' | 'Treatments' | 'Error' | 'Total';
  df: number;
  ss: number;
  ms: number | null;
  f: number | null;
  p: number | null;
}

export interface ParameterAnalysis {
  means: TreatmentMean[];
  grandMean: number | null;
  /** Present for complete replicated (RCBD) data; otherwise `reason` says why not. */
  anova: {
    table: AnovaRow[];
    cv: number;
    sem: number;
    sed: number;
    cd5: number | null;
    significant: boolean;
    /** DMRT (5 %) letters per treatment, when treatments differ; same letter = not different. */
    groups: Record<string, string> | null;
  } | null;
  reason?: string;
}

const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;

/**
 * Duncan's multiple range test. Two means differ when their gap is larger than
 * R_p = r_p × SEm, where p is how many means they span (in ranked order) and r_p is Duncan's
 * significant studentized range at protection level (1 − α)^(p − 1). Treatments sharing a letter
 * don't differ significantly; letters go from the highest mean (a) down.
 */
export function dmrtLetters(
  means: { treatmentCode: string; mean: number | null }[],
  sem: number,
  dfError: number,
  alpha = 0.05,
): Record<string, string> {
  const ranked = means
    .filter((m): m is { treatmentCode: string; mean: number } => m.mean !== null)
    .sort((a, b) => b.mean - a.mean);
  const range = (p: number) => jStat.tukey.inv((1 - alpha) ** (p - 1), p, dfError) * sem;
  // For each mean, the run of lower means it doesn't differ from.
  const runs: [number, number][] = [];
  for (let i = 0; i < ranked.length; i++) {
    let j = i;
    while (j + 1 < ranked.length && ranked[i]!.mean - ranked[j + 1]!.mean <= range(j + 2 - i)) j++;
    if (!runs.some(([a, b]) => a <= i && j <= b)) runs.push([i, j]);
  }
  const letters: Record<string, string> = {};
  ranked.forEach((m, k) => {
    letters[m.treatmentCode] = runs
      .map(([a, b], n) => (a <= k && k <= b ? String.fromCharCode(97 + n) : ''))
      .join('');
  });
  return letters;
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * @param values  numeric values keyed by treatment code, then replication number
 * @param treatmentCodes  all treatments of the experiment, in protocol order
 * @param replications  number of replications (null = non-replicated: means only)
 */
export function analyseParameter(
  values: Map<string, Map<number | null, number>>,
  treatmentCodes: string[],
  replications: number | null,
): ParameterAnalysis {
  const means: TreatmentMean[] = treatmentCodes.map((code) => {
    const xs = [...(values.get(code)?.values() ?? [])];
    return { treatmentCode: code, n: xs.length, mean: xs.length ? round(sum(xs) / xs.length) : null };
  });
  const all = [...values.values()].flatMap((m) => [...m.values()]);
  const grandMean = all.length ? round(sum(all) / all.length) : null;

  if (!replications || replications < 2)
    return { means, grandMean, anova: null, reason: 'Not a replicated design' };
  const t = treatmentCodes.length;
  const r = replications;
  if (t < 2) return { means, grandMean, anova: null, reason: 'Needs at least 2 treatments' };

  // Complete data only: every treatment × replication present.
  const grid: number[][] = [];
  for (const code of treatmentCodes) {
    const row: number[] = [];
    for (let rep = 1; rep <= r; rep++) {
      const v = values.get(code)?.get(rep);
      if (v === undefined) {
        return { means, grandMean, anova: null, reason: `Incomplete data: ${code} R${rep} missing` };
      }
      row.push(v);
    }
    grid.push(row);
  }

  const n = t * r;
  const G = sum(grid.flat());
  const CF = (G * G) / n;
  const ssTotal = sum(grid.flat().map((y) => y * y)) - CF;
  const ssTrt = sum(grid.map((row) => sum(row) ** 2)) / r - CF;
  const repTotals = Array.from({ length: r }, (_, j) => sum(grid.map((row) => row[j]!)));
  const ssRep = sum(repTotals.map((x) => x * x)) / t - CF;
  const ssErr = Math.max(0, ssTotal - ssTrt - ssRep);

  const dfTrt = t - 1;
  const dfRep = r - 1;
  const dfErr = dfTrt * dfRep;
  const msTrt = ssTrt / dfTrt;
  const msRep = ssRep / dfRep;
  const msErr = ssErr / dfErr;
  const mean = G / n;

  if (msErr === 0) {
    return { means, grandMean, anova: null, reason: 'No residual variation (error mean square is 0)' };
  }

  const fTrt = msTrt / msErr;
  const fRep = msRep / msErr;
  const pTrt = 1 - jStat.centralF.cdf(fTrt, dfTrt, dfErr);
  const pRep = 1 - jStat.centralF.cdf(fRep, dfRep, dfErr);
  const sem = Math.sqrt(msErr / r);
  const sed = Math.sqrt((2 * msErr) / r);
  const significant = pTrt < 0.05;

  return {
    means,
    grandMean,
    anova: {
      table: [
        {
          source: 'Replications',
          df: dfRep,
          ss: round(ssRep),
          ms: round(msRep),
          f: round(fRep),
          p: round(pRep),
        },
        {
          source: 'Treatments',
          df: dfTrt,
          ss: round(ssTrt),
          ms: round(msTrt),
          f: round(fTrt),
          p: round(pTrt),
        },
        { source: 'Error', df: dfErr, ss: round(ssErr), ms: round(msErr), f: null, p: null },
        { source: 'Total', df: n - 1, ss: round(ssTotal), ms: null, f: null, p: null },
      ],
      cv: round((Math.sqrt(msErr) / mean) * 100, 2),
      sem: round(sem),
      sed: round(sed),
      cd5: significant ? round(jStat.studentt.inv(0.975, dfErr) * sed) : null,
      groups: significant ? dmrtLetters(means, sem, dfErr) : null,
      significant,
    },
  };
}
