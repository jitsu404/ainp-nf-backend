import { describe, expect, it } from 'vitest';
import {
  FormulaError,
  evaluateFormula,
  findCycle,
  formulaCodes,
  parseFormula,
  renameFormulaCodes,
} from '../src/utils/formula.js';

const run = (text: string, values: Record<string, number | null>) =>
  evaluateFormula(parseFormula(text), (code) => values[code] ?? null);

describe('formulas', () => {
  it('follows arithmetic precedence, brackets and unary minus', () => {
    expect(run('2 + 3 * 4', {})).toBe(14);
    expect(run('(2 + 3) * 4', {})).toBe(20);
    expect(run('-A + 10', { A: 4 })).toBe(6);
    expect(run('a / b', { A: 9, B: 3 })).toBe(3); // codes are case-insensitive
  });

  it('computes the NF economics the way the datasheets define them', () => {
    const values = {
      GRAIN_YIELD: 4000,
      SALE_PRICE_MAIN: 25,
      INTERCROP_YIELD: 500,
      SALE_PRICE_INTER: 60,
      COST_CULTIVATION: 52000,
    };
    const gross = run(
      'GRAIN_YIELD * SALE_PRICE_MAIN + IFEMPTY(INTERCROP_YIELD, 0) * IFEMPTY(SALE_PRICE_INTER, 0)',
      values,
    );
    expect(gross).toBe(130000);
    expect(run('(GRAIN_YIELD * SALE_PRICE_MAIN - COST_CULTIVATION) / COST_CULTIVATION', values)).toBeCloseTo(
      0.923,
      3,
    );
    // No intercrop: IFEMPTY treats it as 0 instead of making the result missing.
    expect(
      run('GRAIN_YIELD + IFEMPTY(INTERCROP_YIELD, 0) * IFEMPTY(SALE_PRICE_INTER, 0) / SALE_PRICE_MAIN', {
        GRAIN_YIELD: 4000,
        SALE_PRICE_MAIN: 25,
      }),
    ).toBe(4000);
  });

  it('gives no value when an input is missing or a division is by zero', () => {
    expect(run('A - B', { A: 5 })).toBeNull();
    expect(run('A / B', { A: 5, B: 0 })).toBeNull();
  });

  it('rejects invalid formulas with a readable message', () => {
    for (const bad of ['', 'A +', '(A', 'A ) ', 'SQRT(A)', 'A ^ 2', 'IFEMPTY(A)']) {
      expect(() => parseFormula(bad), bad).toThrow(FormulaError);
    }
  });

  it('lists the codes used and finds cycles', () => {
    expect([...formulaCodes(parseFormula('IFEMPTY(A, B) * C'))].sort()).toEqual(['A', 'B', 'C']);
    const uses: Record<string, string[]> = { A: ['B'], B: ['C'], C: ['A'], D: ['E'] };
    const graph = (code: string) => new Set(uses[code] ?? []);
    expect(findCycle('A', graph)).toEqual(['A', 'B', 'C', 'A']);
    expect(findCycle('D', graph)).toBeNull();
  });

  it('renames codes in a formula and leaves everything else as written', () => {
    const codes = new Map([
      ['GROSS_RETURNS', 'PRM_020'],
      ['COST_CULTIVATION', 'PRM_021'],
      ['INTERCROP_YIELD', 'PRM_005'],
    ]);
    expect(
      renameFormulaCodes(
        'GROSS_RETURNS - cost_cultivation * 1.5 + IFEMPTY(INTERCROP_YIELD, 0) / OTHER2',
        (c) => codes.get(c),
      ),
    ).toBe('PRM_020 - PRM_021 * 1.5 + IFEMPTY(PRM_005, 0) / OTHER2');
  });
});
