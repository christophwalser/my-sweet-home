// How the dimensions of the home look (`dimension_style_set`), the dimension chain a dimension
// line belongs to (`dimension_chain_add`) and elevation marks (`elevation_mark_add`). Sweet Home
// 3D has none of them: they are kept as JSON in properties. Lengths are formatted as in exported
// files (`crates/msh-export/src/dimension.rs`).

import { formatNumber } from "../i18n";
import type { DimensionLine, Home, Label, Pt } from "../model";
import { formatLength } from "../units";
import type { AutoDim } from "./autoDims";

export const DIMENSION_STYLE_PROPERTY = "mySweetHome.dimensionStyle";
export const CHAIN_PROPERTY = "mySweetHome.dimensionChain";
export const ELEVATION_MARK_PROPERTY = "mySweetHome.elevationMark";

export type EndMark = "slash" | "arrow" | "dot" | "none";
export type DimensionUnit = "auto" | "mm" | "cm" | "m" | "din";

export type DimensionStyle = {
  mark: EndMark;
  unit: DimensionUnit;
  /** Decimals of mm, cm and m (missing: 0, 1 and 2) */
  decimals?: number;
  showUnit: boolean;
  comma: boolean;
  /** Text size in cm of dimensions without a text style of their own (missing: 18) */
  fontSize?: number;
};

export const DEFAULT_STYLE: DimensionStyle = {
  mark: "slash",
  unit: "auto",
  showUnit: true,
  comma: false,
};

type Properties = { name: string; value: string }[];

function read(properties: Properties | undefined, name: string): Record<string, unknown> | null {
  const value = properties?.find((p) => p.name === name)?.value;
  if (!value) return null;
  try {
    const json: unknown = JSON.parse(value);
    return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const styles = new WeakMap<Properties, DimensionStyle>();

/** Style of the dimensions of a home (the default one if it has none or an unreadable one). */
export function dimensionStyle(home: Home): DimensionStyle {
  if (!home.properties) return DEFAULT_STYLE;
  const known = styles.get(home.properties);
  if (known) return known;
  const json = read(home.properties, DIMENSION_STYLE_PROPERTY);
  const style = json ? { ...DEFAULT_STYLE, ...(json as Partial<DimensionStyle>) } : DEFAULT_STYLE;
  styles.set(home.properties, style);
  return style;
}

/** Whether the home has a style of its own. */
export function hasDimensionStyle(home: Home): boolean {
  return read(home.properties, DIMENSION_STYLE_PROPERTY) !== null;
}

/** Whether the language of the app writes a decimal comma. */
export function decimalComma(): boolean {
  return formatNumber(0.5, 1, 1).includes(",");
}

const RAISED = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
const DECIMALS = { mm: 0, cm: 1, m: 2 };
const PER_CM = { mm: 10, cm: 1, m: 0.01 };

/** A length in cm as the dimensions show it. */
export function formatDimension(cm: number, style: DimensionStyle): string {
  const { unit } = style;
  if (unit === "auto") return formatLength(cm);
  const separated = (text: string) => (style.comma ? text.replace(".", ",") : text);
  if (unit === "din") {
    const mm = Math.round(Math.abs(cm) * 10 + 1e-4);
    const whole = Math.floor(mm / 10);
    const text =
      whole >= 100
        ? separated(`${Math.floor(whole / 100)}.${String(whole % 100).padStart(2, "0")}`)
        : String(whole);
    return `${cm < 0 && mm > 0 ? "-" : ""}${text}${mm % 10 === 0 ? "" : RAISED[mm % 10]}`;
  }
  const decimals = Math.min(4, Math.max(0, style.decimals ?? DECIMALS[unit]));
  const scale = 10 ** decimals;
  const value = Math.round(cm * PER_CM[unit] * scale + 1e-4) / scale;
  const text = separated(value.toFixed(decimals));
  return style.showUnit ? `${text} ${unit}` : text;
}

/** The chain a dimension line belongs to. */
export type ChainData = {
  id: string;
  /** Wall it runs along; a chain of points has none */
  wall?: string;
  side: ChainSide;
  rows?: ChainRowKind[];
  distance: number;
  spacing: number;
};
export type ChainSide = "left" | "right";
export type ChainRowKind = "openings" | "walls" | "total";
export const CHAIN_ROWS: ChainRowKind[] = ["openings", "walls", "total"];

const chains = new WeakMap<DimensionLine, ChainData | null>();

export function chainOf(d: DimensionLine): ChainData | null {
  const known = chains.get(d);
  if (known !== undefined) return known;
  const json = read(d.properties, CHAIN_PROPERTY);
  const chain = json && typeof json.id === "string" ? (json as ChainData) : null;
  chains.set(d, chain);
  return chain;
}

/** IDs of the dimension lines of a chain. */
export function chainIds(home: Home, chain: string): string[] {
  return home.dimension_lines.flatMap((d) =>
    d.attrs.id && chainOf(d)?.id === chain ? [d.attrs.id] : [],
  );
}

/** The chain all selected elements belong to, or null. */
export function selectedChain(home: Home, selection: string[]): ChainData | null {
  let found: ChainData | null = null;
  for (const id of selection) {
    const d = home.dimension_lines.find((l) => l.attrs.id === id);
    const chain = d ? chainOf(d) : null;
    if (!chain || (found && found.id !== chain.id)) return null;
    found = chain;
  }
  return found;
}

/** The chain on one side of a wall, as `dimension_chain_calc` works it out. */
export type CalcSide = {
  /** Sign of the offsets of dimension lines on this side */
  sign: 1 | -1;
  rows: { kind: ChainRowKind; points: Pt[] }[];
};

/** Distances of new chains in cm (as in the command). */
export const CHAIN_SPACING = 45;
export const MIN_CHAIN_DISTANCE = 10;

/** The dimensions of a chain at a distance from its wall, for the preview. */
export function chainDims(side: CalcSide, distance: number, spacing = CHAIN_SPACING): AutoDim[] {
  return side.rows.flatMap((row, k) =>
    row.points.slice(1).map((end, i) => ({
      start: row.points[i],
      end,
      offset: side.sign * (distance + k * spacing),
    })),
  );
}

export type ElevationMark = { height: number; kind: "finished" | "raw" };

/** What an elevation mark shows, or null for another label. */
export function elevationMarkOf(l: Label): ElevationMark | null {
  const json = read(l.properties, ELEVATION_MARK_PROPERTY);
  if (!json || typeof json.height !== "number") return null;
  return { height: json.height, kind: json.kind === "raw" ? "raw" : "finished" };
}
