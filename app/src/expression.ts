// Arithmetic in input fields: "240+11.5", "3m - 12cm", "(120-2*1.5)/2", and changes relative
// to the current value: "+5", "+-2.5", "*2", "/3". A plain leading minus ("-50") stays an
// absolute negative value, because coordinates can be negative.

import { type LengthUnit, parseLength } from "./units";

/** Converts a number typed with an optional unit suffix into the base unit of the field. */
type Literal = (value: number, suffix: string | null) => number | null;

type Token = { kind: "num"; value: number; suffix: string | null } | { kind: "op"; op: string };

/** Unit suffixes of lengths, longest first so that "mm" is not read as "m". */
const LENGTH_SUFFIX = /^(mm|cm|inch|in|ft|m|"|')/;

function tokenize(text: string, suffixes: RegExp): Token[] | null {
  const tokens: Token[] = [];
  let s = text.replace(/,/g, ".").toLowerCase();
  while (s.length > 0) {
    const space = /^\s+/.exec(s);
    if (space) {
      s = s.slice(space[0].length);
      continue;
    }
    const num = /^(\d+(?:\.\d*)?|\.\d+)/.exec(s);
    if (num) {
      s = s.slice(num[0].length).trimStart();
      const suffix = suffixes.exec(s);
      if (suffix) s = s.slice(suffix[0].length);
      tokens.push({ kind: "num", value: Number(num[0]), suffix: suffix ? suffix[0] : null });
      continue;
    }
    if ("+-*/()".includes(s[0])) {
      tokens.push({ kind: "op", op: s[0] });
      s = s.slice(1);
      continue;
    }
    return null;
  }
  return tokens;
}

/**
 * Evaluates `text` with the usual precedence. Operands of + and - are values of the field
 * (literals go through `literal`); factors and divisors after * and / are plain numbers.
 */
function evaluate(text: string, suffixes: RegExp, literal: Literal): number | null {
  const tokens = tokenize(text, suffixes);
  if (!tokens || tokens.length === 0) return null;
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (op: string) => {
    const t = peek();
    return t?.kind === "op" && t.op === op;
  };
  // Plain number: a literal without unit, or a parenthesized plain expression
  const scalar = (): number | null => {
    if (isOp("-")) {
      i++;
      const v = scalar();
      return v === null ? null : -v;
    }
    if (isOp("(")) {
      i++;
      const v = scalarSum();
      if (v === null || !isOp(")")) return null;
      i++;
      return v;
    }
    const t = peek();
    if (t?.kind !== "num" || t.suffix !== null) return null;
    i++;
    return t.value;
  };
  const scalarSum = (): number | null => {
    let v = scalarProduct();
    while (v !== null && (isOp("+") || isOp("-"))) {
      const minus = isOp("-");
      i++;
      const w = scalarProduct();
      if (w === null) return null;
      v = minus ? v - w : v + w;
    }
    return v;
  };
  const scalarProduct = (): number | null => {
    let v = scalar();
    while (v !== null && (isOp("*") || isOp("/"))) {
      const div = isOp("/");
      i++;
      const w = scalar();
      if (w === null || (div && w === 0)) return null;
      v = div ? v / w : v * w;
    }
    return v;
  };
  // Value of the field: a literal (with or without unit) or a parenthesized expression
  const factor = (): number | null => {
    if (isOp("+")) {
      i++;
      return factor();
    }
    if (isOp("-")) {
      i++;
      const v = factor();
      return v === null ? null : -v;
    }
    if (isOp("(")) {
      i++;
      const v = sum();
      if (v === null || !isOp(")")) return null;
      i++;
      return v;
    }
    const t = peek();
    if (t?.kind !== "num") return null;
    i++;
    let v = literal(t.value, t.suffix);
    // Feet followed by inches: 5'3"
    const next = peek();
    if (v !== null && t.suffix === "'" && next?.kind === "num" && next.suffix !== "'") {
      i++;
      const inches = literal(next.value, next.suffix ?? '"');
      v = inches === null ? null : v + inches;
    }
    return v;
  };
  const product = (): number | null => {
    let v = factor();
    while (v !== null && (isOp("*") || isOp("/"))) {
      const div = isOp("/");
      i++;
      const w = scalar();
      if (w === null || (div && w === 0)) return null;
      v = div ? v / w : v * w;
    }
    return v;
  };
  const sum = (): number | null => {
    let v = product();
    while (v !== null && (isOp("+") || isOp("-"))) {
      const minus = isOp("-");
      i++;
      const w = product();
      if (w === null) return null;
      v = minus ? v - w : v + w;
    }
    return v;
  };
  const v = sum();
  return v !== null && i === tokens.length && Number.isFinite(v) ? v : null;
}

/**
 * The typed text with a relative change applied to `current`: "+5" adds, "+-5" subtracts,
 * "*2" and "/2" scale. Returns the text unchanged when it is no relative change or there is no
 * current value.
 */
function withCurrent(text: string, current: number | null | undefined, unitText: string): string {
  const t = text.trim();
  if (current === null || current === undefined || !/^[+*/]/.test(t)) return t;
  return `(${unitText})${t}`;
}

/**
 * Parses a typed length in the field's unit, with arithmetic and relative changes to
 * `current` (in cm). Returns centimeters, or null for text that is no length.
 */
export function evalLength(text: string, unit: LengthUnit, current?: number | null): number | null {
  const plain = parseLength(text, unit);
  if (plain !== null) return plain;
  const literal: Literal = (value, suffix) => {
    if (suffix === null) return parseLength(String(value), unit);
    if (suffix === "'") return parseLength(`${value}'`, unit);
    if (suffix === '"') return parseLength(`${value}"`, unit);
    return parseLength(`${value}${suffix}`, unit);
  };
  const base = current === null || current === undefined ? null : `${current.toFixed(6)}cm`;
  return evaluate(withCurrent(text, current, base ?? ""), LENGTH_SUFFIX, literal);
}

/**
 * Parses a typed number (e.g. an angle in degrees) with arithmetic and relative changes to
 * `current`. A trailing "°" is allowed.
 */
export function evalNumber(text: string, current?: number | null): number | null {
  const t = text.replace(/°/g, "");
  return evaluate(
    withCurrent(t, current, current === null || current === undefined ? "" : current.toFixed(6)),
    /(?!)/,
    (value, suffix) => (suffix === null ? value : null),
  );
}
