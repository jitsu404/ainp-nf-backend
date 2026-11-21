// Formulas for calculated parameters, e.g. "NET_RETURNS / COST_CULTIVATION".
//
// A deliberately small language, parsed and evaluated here (never with eval):
//   numbers, parameter codes (A–Z, 0–9, _), + - * /, unary minus, brackets, and IFEMPTY(x, fallback)
//   for optional inputs such as an intercrop that isn't grown everywhere.
// A missing input makes the result missing (null), as does division by zero.

export type Formula =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; code: string }
  | { kind: 'neg'; arg: Formula }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: Formula; right: Formula }
  | { kind: 'ifEmpty'; value: Formula; fallback: Formula };

export class FormulaError extends Error {}

const MAX_LENGTH = 500;

type Token = { type: 'num'; value: number } | { type: 'id'; value: string } | { type: 'op'; value: string };

const tokenize = (text: string): Token[] => {
  const tokens: Token[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z][A-Za-z0-9_]*)|([-+*/(),]))/y;
  let pos = 0;
  while (pos < text.length) {
    if (/^\s*$/.test(text.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) throw new FormulaError(`Unexpected character "${text.slice(pos).trim()[0]}"`);
    if (m[1] !== undefined) tokens.push({ type: 'num', value: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ type: 'id', value: m[2].toUpperCase() });
    else tokens.push({ type: 'op', value: m[3]! });
    pos = re.lastIndex;
  }
  return tokens;
};

/** Parses a formula; throws FormulaError with a readable message if it isn't valid. */
export const parseFormula = (text: string): Formula => {
  if (text.length > MAX_LENGTH) throw new FormulaError(`Formula is longer than ${MAX_LENGTH} characters`);
  const tokens = tokenize(text);
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (value: string) => peek()?.type === 'op' && peek()?.value === value;
  const expect = (value: string) => {
    if (!isOp(value)) throw new FormulaError(`Expected "${value}"`);
    i += 1;
  };

  // expression := term (('+' | '-') term)*   term := factor (('*' | '/') factor)*
  const expression = (): Formula => {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[i++] as Token).value as '+' | '-';
      left = { kind: 'bin', op, left, right: term() };
    }
    return left;
  };
  const term = (): Formula => {
    let left = factor();
    while (isOp('*') || isOp('/')) {
      const op = (tokens[i++] as Token).value as '*' | '/';
      left = { kind: 'bin', op, left, right: factor() };
    }
    return left;
  };
  const factor = (): Formula => {
    const t = peek();
    if (!t) throw new FormulaError('The formula ends too early');
    if (t.type === 'op' && t.value === '-') {
      i += 1;
      return { kind: 'neg', arg: factor() };
    }
    if (t.type === 'op' && t.value === '(') {
      i += 1;
      const inner = expression();
      expect(')');
      return inner;
    }
    if (t.type === 'num') {
      i += 1;
      return { kind: 'num', value: t.value };
    }
    if (t.type === 'id') {
      i += 1;
      if (isOp('(')) {
        if (t.value !== 'IFEMPTY')
          throw new FormulaError(`Unknown function ${t.value}; only IFEMPTY(value, fallback)`);
        i += 1;
        const value = expression();
        expect(',');
        const fallback = expression();
        expect(')');
        return { kind: 'ifEmpty', value, fallback };
      }
      return { kind: 'ref', code: t.value };
    }
    throw new FormulaError(`Unexpected "${t.value}"`);
  };

  if (!tokens.length) throw new FormulaError('The formula is empty');
  const result = expression();
  if (i < tokens.length) throw new FormulaError(`Unexpected "${(tokens[i] as Token).value}"`);
  return result;
};

/**
 * The formula text with parameter codes replaced (`rename` gives the new code, or undefined to keep
 * it). Spacing and everything else stay as written; IFEMPTY and numbers are never renamed. Used when
 * codes change in bulk (the generated-code migration, seeding default formulas).
 */
export const renameFormulaCodes = (text: string, rename: (code: string) => string | undefined): string =>
  text.replace(
    /(\d+(?:\.\d+)?)|([A-Za-z][A-Za-z0-9_]*)/g,
    (match, num: string | undefined, id: string | undefined) => {
      if (num !== undefined || id === undefined) return match;
      return rename(id.toUpperCase()) ?? match;
    },
  );

/** The parameter codes a formula uses. */
export const formulaCodes = (formula: Formula, into = new Set<string>()): Set<string> => {
  switch (formula.kind) {
    case 'ref':
      into.add(formula.code);
      break;
    case 'neg':
      formulaCodes(formula.arg, into);
      break;
    case 'bin':
      formulaCodes(formula.left, into);
      formulaCodes(formula.right, into);
      break;
    case 'ifEmpty':
      formulaCodes(formula.value, into);
      formulaCodes(formula.fallback, into);
      break;
  }
  return into;
};

/** Evaluates a formula; `valueOf(code)` gives an input (null when missing). */
export const evaluateFormula = (
  formula: Formula,
  valueOf: (code: string) => number | null,
): number | null => {
  const ev = (f: Formula): number | null => {
    switch (f.kind) {
      case 'num':
        return f.value;
      case 'ref': {
        const v = valueOf(f.code);
        return v === null || !Number.isFinite(v) ? null : v;
      }
      case 'neg': {
        const v = ev(f.arg);
        return v === null ? null : -v;
      }
      case 'ifEmpty':
        return ev(f.value) ?? ev(f.fallback);
      case 'bin': {
        const a = ev(f.left);
        const b = ev(f.right);
        if (a === null || b === null) return null;
        if (f.op === '/') return b === 0 ? null : a / b;
        return f.op === '+' ? a + b : f.op === '-' ? a - b : a * b;
      }
    }
  };
  const result = ev(formula);
  return result === null || !Number.isFinite(result) ? null : result;
};

/**
 * Finds a cycle among formulas (e.g. A uses B and B uses A). `uses(code)` returns the codes a
 * calculated parameter uses, or an empty set for an entered one. Returns the cycle or null.
 */
export const findCycle = (start: string, uses: (code: string) => Set<string>): string[] | null => {
  const path: string[] = [];
  const visit = (code: string): string[] | null => {
    const at = path.indexOf(code);
    if (at >= 0) return [...path.slice(at), code];
    path.push(code);
    for (const next of uses(code)) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    return null;
  };
  return visit(start);
};
