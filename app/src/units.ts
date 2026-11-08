// Length units of the user interface. Homes, commands, the CLI and the MCP server always use
// centimeters; only what the user sees and types is converted.

import { formatNumber as num, t } from "./i18n";
import { usePreferences } from "./preferences";

export type LengthUnit = "cm" | "mm" | "m" | "inch";

export const UNITS: { unit: LengthUnit; label: string }[] = [
  { unit: "cm", label: t("Centimeter") },
  { unit: "mm", label: t("Millimeter") },
  { unit: "m", label: t("Meter") },
  { unit: "inch", label: t("Inch / foot") },
];

const CM_PER: Record<LengthUnit, number> = { cm: 1, mm: 0.1, m: 100, inch: 2.54 };
/** Decimals shown in input fields. */
const DECIMALS: Record<LengthUnit, number> = { cm: 1, mm: 0, m: 3, inch: 2 };

function currentUnit(): LengthUnit {
  return usePreferences.getState().unit;
}

/** The unit chosen in the preferences (re-renders the component when it changes). */
export function useUnit(): LengthUnit {
  return usePreferences((s) => s.unit);
}

/** Short symbol of a unit for input fields. */
export function unitSymbol(unit: LengthUnit = currentUnit()): string {
  return unit === "inch" ? "in" : unit;
}

/** A value of an input field (in the unit) as text in the format of the language. */
export function formatFieldValue(value: number, unit: LengthUnit = currentUnit()): string {
  return num(value, DECIMALS[unit]);
}

/** Value in the unit, rounded for input fields. */
export function toUnit(cm: number, unit: LengthUnit = currentUnit()): number {
  const f = 10 ** DECIMALS[unit];
  return Math.round((cm / CM_PER[unit]) * f) / f;
}

/** Centimeters of a value in the unit. */
export function fromUnit(value: number, unit: LengthUnit = currentUnit()): number {
  return value * CM_PER[unit];
}

/**
 * Parses a typed length in the unit; also accepts an explicit unit ("12 mm", "1.5m", "5'3\"",
 * "5 ft", "8 in"). Returns centimeters, or null for text that is no length.
 */
export function parseLength(text: string, unit: LengthUnit = currentUnit()): number | null {
  const t = text.trim().replace(",", ".").toLowerCase();
  if (!t) return null;
  // Feet and inches: 5'3", 5' 3, 5ft 3in
  const feet = /^(-?\d+(?:\.\d+)?)\s*(?:'|ft)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/.exec(t);
  if (feet) {
    const sign = feet[1].startsWith("-") ? -1 : 1;
    return (Number(feet[1]) * 12 + sign * Number(feet[2] ?? 0)) * CM_PER.inch;
  }
  const m = /^(-?\d+(?:\.\d+)?|-?\.\d+)\s*(mm|cm|m|in|"|inch)?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const explicit: Record<string, LengthUnit> = {
    mm: "mm",
    cm: "cm",
    m: "m",
    in: "inch",
    '"': "inch",
    inch: "inch",
  };
  return fromUnit(v, m[2] ? explicit[m[2]] : unit);
}

/** Feet and inches like 13'9" (inches rounded to 1/8). */
function feetInches(cm: number): string {
  const sign = cm < 0 ? "-" : "";
  const totalInches = Math.round((Math.abs(cm) / CM_PER.inch) * 8) / 8;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round((totalInches - feet * 12) * 8) / 8;
  return feet > 0 ? `${sign}${feet}'${num(inches, 3)}"` : `${sign}${num(inches, 3)}"`;
}

/** A length for display in the plan and in texts, e.g. "4.20 m", "42.5 cm" or 13'9". */
export function formatLength(cm: number, unit: LengthUnit = currentUnit()): string {
  switch (unit) {
    case "mm":
      return `${num(Math.round(cm * 10), 0)} mm`;
    case "m":
      return `${num(cm / 100, 2, 2)} m`;
    case "inch":
      return feetInches(cm);
    default:
      // Like Sweet Home 3D's centimeter unit: meters from 1 m on
      return Math.abs(cm) >= 100 ? `${num(cm / 100, 2, 2)} m` : `${num(cm, 1, 1)} cm`;
  }
}

/** A length with the precision of input fields, e.g. "316.3 cm", "3.163 m" or 10'4.5". */
export function formatPrecise(cm: number, unit: LengthUnit = currentUnit()): string {
  return unit === "inch"
    ? feetInches(cm)
    : `${num(toUnit(cm, unit), DECIMALS[unit])} ${unitSymbol(unit)}`;
}

/** An area given in cm² for display: m², or ft² with the inch unit. */
export function formatArea(cm2: number, unit: LengthUnit = currentUnit()): string {
  const a = Math.abs(cm2);
  return unit === "inch" ? `${num(a / (30.48 * 30.48), 1, 1)} ft²` : `${num(a / 10000, 2, 2)} m²`;
}

/** Distances between labeled ruler marks in cm for the unit, smallest first. */
export function rulerSteps(unit: LengthUnit = currentUnit()): number[] {
  if (unit === "inch") {
    return [1, 2, 6, 12, 24, 60, 120, 240, 600, 1200, 2400, 6000, 12000].map(
      (i) => i * CM_PER.inch,
    );
  }
  return [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
}

/** Label of a ruler mark at `cm`, without unit symbol (feet marks get '). */
export function rulerLabel(cm: number, unit: LengthUnit = currentUnit()): string {
  if (unit === "inch") {
    const inches = Math.round(cm / CM_PER.inch);
    return inches % 12 === 0 ? `${inches / 12}'` : `${inches}"`;
  }
  return num(cm / CM_PER[unit], 3);
}
