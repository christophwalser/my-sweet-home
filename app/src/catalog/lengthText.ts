// Lengths of library items as text: the files hold centimeters with a decimal point, the editor
// shows and takes the unit of the preferences.

import { formatFieldValue, type LengthUnit, parseLength, toUnit } from "../units";

/** A value of a library file in the unit; what is no number stays as it is. */
export function lengthText(cm: string, unit: LengthUnit): string {
  const n = Number(cm);
  return cm.trim() === "" || !Number.isFinite(n) ? cm : formatFieldValue(toUnit(n, unit), unit);
}

/** A typed length (also with a unit of its own) as value of a library file; null: no length. */
export function lengthValue(text: string, unit: LengthUnit): string | null {
  if (text.trim() === "") return "";
  const cm = parseLength(text, unit);
  return cm === null ? null : String(Math.round(cm * 1e4) / 1e4);
}

/** Several values with spaces between them (heights of shelves) in the unit. */
export function lengthsText(cm: string, unit: LengthUnit): string {
  return cm
    .split(/\s+/)
    .filter(Boolean)
    .map((v) => lengthText(v, unit))
    .join(" ");
}

/** Several typed lengths, separated by spaces, semicolons or a comma with a space. */
export function lengthsValue(text: string, unit: LengthUnit): string | null {
  const values = text
    .split(/[;\s]+|,\s+/)
    .map((v) => v.replace(/,$/, ""))
    .filter(Boolean)
    .map((v) => lengthValue(v, unit));
  return values.includes(null) ? null : values.join(" ");
}
