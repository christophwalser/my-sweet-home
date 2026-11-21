// Stairs and floor openings in the plan. Both are pieces of furniture with a generated model
// and a cut-out in the floor above (`stair_add`, `opening_add`); what they were made from is
// kept as JSON in a property of the piece. The plan shows a stair as the edges of its treads
// with its walking line, and an opening as its dashed outline, crossed.

import { t } from "../i18n";
import type { Piece, Pt } from "../model";
import type { RoofTexture } from "./roof";

/** Piece property with what a stair was made from. */
export const STAIR_PROPERTY = "mySweetHome.stair";
/** Piece property with the outline of a floor opening. */
export const OPENING_PROPERTY = "mySweetHome.opening";

export type StairShape = "straight" | "l" | "u" | "spiral";
export type StairTurn = "left" | "right";
export type StairStyle = "solid" | "open";
export type StairRails = "none" | "left" | "right" | "both";

/** A check of DIN 18065 (or the headroom of a spiral stair) that a stair does not pass. */
export type StairWarning = {
  kind: "riser" | "tread" | "step_rule" | "headroom";
  value: number;
};

/** What a stair was made from. Lengths in cm, points relative to the middle of the piece. */
export type StairData = {
  shape: StairShape;
  turn: StairTurn;
  style: StairStyle;
  rails: StairRails;
  width: number;
  /** Height from the floor to the floor above */
  rise: number;
  risers: number;
  tread: number;
  firstFlight?: number;
  gap: number;
  diameter: number;
  column: number;
  thickness: number;
  color: string;
  frameColor: string;
  texture?: RoofTexture;
  /** Middle of the front edge of the first step */
  start: Pt;
  /** Treads of each flight */
  flights: number[];
  /** Width and depth as it was made */
  size: [number, number];
  /** Edges of the treads and landings: x and y of both ends */
  lines: [number, number, number, number][];
  /** Walking line from the bottom to the top */
  walk: Pt[];
  warnings: StairWarning[];
};

/** The outline of a floor opening, relative to the middle of the piece. */
export type OpeningData = { outline: Pt[] };

function parser<T>(property: string, valid: (json: Partial<T>) => boolean) {
  const parsed = new WeakMap<Piece, T | null>();
  return (piece: Piece): T | null => {
    const known = parsed.get(piece);
    if (known !== undefined) return known;
    let data: T | null = null;
    const value = piece.properties?.find((pr) => pr.name === property)?.value;
    if (value) {
      try {
        const json = JSON.parse(value) as Partial<T>;
        if (valid(json)) data = json as T;
      } catch {
        // Not data we can read: an ordinary piece
      }
    }
    parsed.set(piece, data);
    return data;
  };
}

/** The stair data of a piece, or null if it is not a stair made by `stair_add`. */
export const stairOf = parser<StairData>(
  STAIR_PROPERTY,
  (j) => Array.isArray(j.lines) && Array.isArray(j.walk) && Array.isArray(j.size),
);

/** The outline of a floor opening, or null if the piece is not one. */
export const openingOf = parser<OpeningData>(
  OPENING_PROPERTY,
  (j) => Array.isArray(j.outline) && j.outline.length >= 3,
);

export function isOpening(piece: Piece): boolean {
  return openingOf(piece) !== null;
}

/**
 * Places points given relative to the middle of a generated piece in the plan: moved, turned,
 * mirrored, and stretched if another program resized the piece.
 */
function placer(piece: Piece, made: [number, number]): (x: number, y: number) => Pt {
  const a = piece.attrs;
  const sx = (made[0] > 0 ? a.width / made[0] : 1) * (a.model_mirrored ? -1 : 1);
  const sy = made[1] > 0 ? a.depth / made[1] : 1;
  const cos = Math.cos(a.angle ?? 0);
  const sin = Math.sin(a.angle ?? 0);
  return (x, y) => [a.x + x * sx * cos - y * sy * sin, a.y + x * sx * sin + y * sy * cos];
}

/** The edges of the treads and the walking line of a stair in the plan. */
export function stairSymbol(piece: Piece, data: StairData): { lines: [Pt, Pt][]; walk: Pt[] } {
  const place = placer(piece, data.size);
  return {
    lines: data.lines.map(([x1, y1, x2, y2]) => [place(x1, y1), place(x2, y2)]),
    walk: data.walk.map(([x, y]) => place(x, y)),
  };
}

/** The outline of a floor opening in the plan. */
export function openingOutline(piece: Piece, data: OpeningData): Pt[] {
  const xs = data.outline.map((p) => p[0]);
  const ys = data.outline.map((p) => p[1]);
  const place = placer(piece, [
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  ]);
  return data.outline.map(([x, y]) => place(x, y));
}

/** Where a stair starts in the plan: the middle of the front edge of its first step. */
export function stairStart(piece: Piece, data: StairData): Pt {
  return placer(piece, data.size)(data.start[0], data.start[1]);
}

/** Height of one riser in cm. */
export function riserHeight(data: { rise: number; risers: number }): number {
  return data.rise / Math.max(1, data.risers);
}

/** What a failed check says. */
export function warningText(w: StairWarning): string {
  const value = String(Math.round(w.value * 10) / 10);
  switch (w.kind) {
    case "riser":
      return t("Riser {value} cm: outside 14–20 cm", { value });
    case "tread":
      return t("Tread {value} cm: outside 23–37 cm", { value });
    case "step_rule":
      return t("Step rule 2 × riser + tread = {value} cm: outside 59–65 cm", { value });
    case "headroom":
      return t("Headroom under the turn above only {value} cm (needs 200 cm)", { value });
  }
}

/**
 * Angle of a stair in degrees, clockwise from up in the plan, that climbs from `from`
 * towards `to`.
 */
export function climbAngle(from: Pt, to: Pt): number {
  return (Math.atan2(to[0] - from[0], from[1] - to[1]) * 180) / Math.PI;
}

/**
 * The outline of a stair seen from above (start at the origin, climbing towards -y) placed
 * at `from`, climbing towards `to`: the preview while the stair is placed.
 */
export function placedFootprint(footprint: Pt[], from: Pt, to: Pt): Pt[] {
  const angle = (climbAngle(from, to) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return footprint.map(([x, y]) => [from[0] + x * cos - y * sin, from[1] + x * sin + y * cos]);
}
