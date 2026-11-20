import { type Formula, evaluateFormula, parseFormula } from '../../utils/formula.js';

// Values of calculated parameters (e.g. net returns, B:C) for one sheet. Pure: no database access.
// They are computed whenever a sheet is read, never stored, so a corrected input or formula
// changes every result at once.
//
// Levels mix as you'd expect:
//  - a per-treatment formula that uses a per-plot input (yield) uses that treatment's mean over
//    the replications;
//  - a per-plot formula that uses a per-treatment input (price) uses the treatment's value.
// In split- and strip-plot designs every plot (main × sub) is computed on its own.

export interface ObsRow {
  /** Null for designs that are a single plot. */
  mainPlot: number | null;
  subPlot: number | null;
  treatmentCode: string;
  replication: number | null;
  parameterId: string;
  value: number | string | null;
}

export interface CalcProtocolParam {
  parameterId: string;
  code?: string | undefined;
  level: string;
  decimals: number;
  formula: string | null;
}

interface Protocol {
  replications: number | null;
  /** Every plot of the layout (experimentPlots). */
  plots: { mainPlot: number | null; subPlot: number | null }[];
  treatments: { code: string }[];
  parameters: CalcProtocolParam[];
}

const MAX_DEPTH = 20;

/** Ids of the protocol's calculated parameters (their stored values, if any, are ignored). */
export const calculatedIds = (protocol: Pick<Protocol, 'parameters'>): Set<string> =>
  new Set(protocol.parameters.filter((p) => p.formula).map((p) => p.parameterId));

/**
 * Computed rows for every calculated parameter of the protocol. `library` holds every calculated
 * parameter of the library by code, since a formula may use one that isn't in the protocol.
 */
export const computeCalculated = (
  protocol: Protocol,
  entered: ObsRow[],
  library: Map<string, { formula: Formula }>,
): ObsRow[] => {
  const byCode = new Map(protocol.parameters.filter((p) => p.code).map((p) => [p.code!, p]));
  const replicated = (p: CalcProtocolParam) => p.level === 'plot' && Boolean(protocol.replications);
  const calcIds = calculatedIds(protocol);

  const values = new Map<string, number>();
  const at = (id: string, plot: string, t: string, r: number | null) => `${id}|${plot}|${t}|${r}`;
  for (const row of entered) {
    if (typeof row.value === 'number' && !calcIds.has(row.parameterId)) {
      values.set(
        at(row.parameterId, `${row.mainPlot}.${row.subPlot}`, row.treatmentCode, row.replication),
        row.value,
      );
    }
  }
  const formulaOf = (code: string): Formula | null => {
    const own = byCode.get(code)?.formula;
    if (own) {
      try {
        return parseFormula(own);
      } catch {
        return null;
      }
    }
    return library.get(code)?.formula ?? null;
  };

  const valueAt = (code: string, plot: string, t: string, r: number | null, depth: number): number | null => {
    if (depth > MAX_DEPTH) return null;
    const formula = formulaOf(code);
    if (formula) return evaluateFormula(formula, (c) => valueAt(c, plot, t, r, depth + 1));
    const p = byCode.get(code);
    if (!p) return null;
    if (!replicated(p)) return values.get(at(p.parameterId, plot, t, null)) ?? null;
    if (r !== null) return values.get(at(p.parameterId, plot, t, r)) ?? null;
    // Per-plot input asked for at treatment level: the mean of the replications recorded.
    const xs: number[] = [];
    for (let rep = 1; rep <= (protocol.replications ?? 0); rep++) {
      const v = values.get(at(p.parameterId, plot, t, rep));
      if (v !== undefined) xs.push(v);
    }
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };

  const rows: ObsRow[] = [];
  for (const p of protocol.parameters) {
    if (!p.formula || !p.code) continue;
    const reps = replicated(p) ? Array.from({ length: protocol.replications ?? 0 }, (_, i) => i + 1) : [null];
    for (const { mainPlot, subPlot } of protocol.plots) {
      for (const t of protocol.treatments) {
        for (const r of reps) {
          const v = valueAt(p.code, `${mainPlot}.${subPlot}`, t.code, r, 0);
          if (v === null) continue;
          const factor = 10 ** p.decimals;
          rows.push({
            mainPlot,
            subPlot,
            treatmentCode: t.code,
            replication: r,
            parameterId: p.parameterId,
            value: Math.round(v * factor) / factor,
          });
        }
      }
    }
  }
  return rows;
};
