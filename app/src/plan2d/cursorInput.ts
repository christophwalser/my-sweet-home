// Values typed at the cursor while drawing (walls, lines, rooms, dimensions, measuring tool and
// rulers): a length, Tab to an angle, or a point as `@dx;dy` (relative to the last point) or
// `#x;y` (absolute). `length<angle` gives both in the length field.

import { evalLength, evalNumber } from "../expression";
import type { Pt } from "../model";
import type { LengthUnit } from "../units";

export type CursorInput = {
  /** Text of the length field (also `@dx;dy`, `#x;y` or `length<angle`) */
  length: string;
  /** Text of the angle field (degrees, clockwise from the x axis like the plan), null if unused */
  angle: string | null;
  /** Field the keys go to */
  field: "length" | "angle";
};

const LENGTH_CHARS = /^[-+*/() '"mcinft<;]$/;
const ANGLE_CHARS = /^[-+*/()]$/;

/** Whether the length field holds a point (`@dx;dy` or `#x;y`) instead of a length. */
const isPoint = (text: string) => /^[@#]/.test(text);

/**
 * The input after the key, or `undefined` when the key is not for the input (the caller handles
 * it). `null` ends the input (Backspace on an empty input).
 */
export function inputKey(input: CursorInput | null, key: string): CursorInput | null | undefined {
  if (key === "Tab") {
    const i = input ?? { length: "", angle: null, field: "length" };
    if (isPoint(i.length)) return i;
    return i.field === "length"
      ? { ...i, angle: i.angle ?? "", field: "angle" }
      : { ...i, field: "length" };
  }
  if (input === null) {
    if (/^[0-9]$/.test(key) || key === "(" || key === "@" || key === "#") {
      return { length: key, angle: null, field: "length" };
    }
    if (key === "." || key === ",") return { length: "0.", angle: null, field: "length" };
    return undefined;
  }
  const text = input.field === "length" ? input.length : (input.angle ?? "");
  const set = (next: string): CursorInput =>
    input.field === "length" ? { ...input, length: next } : { ...input, angle: next };
  if (key === "Backspace") {
    if (text.length > 0) return set(text.slice(0, -1));
    if (input.field === "angle") return { ...input, angle: null, field: "length" };
    return input.angle === null ? null : { ...input, field: "angle" };
  }
  if (/^[0-9.]$/.test(key)) return set(text + key);
  if (key === ",") {
    // A comma separates the coordinates of a point, otherwise it is the decimal mark
    return set(text + (input.field === "length" && isPoint(text) ? ";" : "."));
  }
  if (input.field === "length" && LENGTH_CHARS.test(key)) return set(text + key);
  if (input.field === "angle" && (ANGLE_CHARS.test(key) || key === "°")) return set(text + key);
  return undefined;
}

/**
 * The point the input gives, starting at `from`; the direction or length not typed comes from
 * the cursor at `toward`. Null while the input gives no point (e.g. incomplete arithmetic).
 */
export function inputPoint(
  input: CursorInput,
  from: Pt,
  toward: Pt | null,
  unit: LengthUnit,
): Pt | null {
  const text = input.length.trim();
  const round = (v: number) => Math.round(v * 100) / 100;
  if (isPoint(text)) {
    const parts = text.slice(1).split(";");
    if (parts.length !== 2) return null;
    const x = evalLength(parts[0], unit);
    const y = evalLength(parts[1], unit);
    if (x === null || y === null) return null;
    return text[0] === "@" ? [round(from[0] + x), round(from[1] + y)] : [round(x), round(y)];
  }
  let lengthText = text;
  let angleText = input.angle?.trim() ?? "";
  const lt = text.indexOf("<");
  if (lt >= 0) {
    lengthText = text.slice(0, lt).trim();
    angleText = text.slice(lt + 1).trim();
  }
  const dx = toward ? toward[0] - from[0] : 1;
  const dy = toward ? toward[1] - from[1] : 0;
  const cursorLength = Math.hypot(dx, dy);
  const length = lengthText ? evalLength(lengthText, unit) : cursorLength;
  if (length === null || !Number.isFinite(length) || length <= 0) return null;
  let dir: Pt = cursorLength > 1e-6 ? [dx / cursorLength, dy / cursorLength] : [1, 0];
  if (angleText) {
    const deg = evalNumber(angleText);
    if (deg === null) return null;
    const a = (deg * Math.PI) / 180;
    dir = [Math.cos(a), Math.sin(a)];
  }
  return [round(from[0] + dir[0] * length), round(from[1] + dir[1] * length)];
}

/**
 * Text shown at the cursor: the fields with the one being typed marked by a text cursor.
 * `labels` are the translated words for "Length", "Angle" and "Point".
 */
export function inputText(
  input: CursorInput,
  unitSymbol: string,
  labels: { length: string; angle: string; point: string },
): string {
  const mark = (field: CursorInput["field"]) => (input.field === field ? "▏" : "");
  if (isPoint(input.length)) return `${labels.point}: ${input.length}${mark("length")}`;
  const length = `${labels.length}: ${input.length}${mark("length")} ${unitSymbol}`;
  if (input.angle === null) return length;
  return `${length} · ${labels.angle}: ${input.angle}${mark("angle")}°`;
}
