// Roofs in the plan. A roof is a piece of furniture with a generated model; what it was made
// from (`roof_add`, `roof_update`) is kept as JSON in a property of the piece. The plan shows
// a roof as its lines (eaves, verges, ridge, hips) instead of its view from above, which would
// hide the level under it.

import type { Piece, Pt, Texture } from "../model";

/** Piece property with what a roof was made from. */
export const ROOF_PROPERTY = "mySweetHome.roof";

export type RoofShape = "gable" | "hip" | "shed" | "flat" | "custom";
export type RoofEdge = "eave" | "gable";
export type RoofLineKind = "eave" | "verge" | "ridge" | "hip";

/** A texture of a roof; its image lies among the files of the model of the roof. */
export type RoofTexture = {
  name: string;
  catalogId?: string;
  /** Name of the image among the files of the model */
  file: string;
  /** Width and height of one tile of the image in cm */
  width: number;
  height: number;
};

/** What a roof was made from. Lengths in cm, points relative to the middle of the piece. */
export type RoofData = {
  shape: RoofShape;
  turn: number;
  /** Corners of the covered area */
  outline: Pt[];
  /** Kind of the edge from each corner to the next */
  edges: RoofEdge[];
  /** Pitch of the surfaces in degrees */
  pitch: number;
  overhang: number;
  thickness: number;
  color: string;
  gableColor: string;
  /** Texture of the roof covering, shown instead of its color */
  texture?: RoofTexture;
  /** Texture of the walls under the gables */
  gableTexture?: RoofTexture;
  /** Height of the lowest point above the top of the walls */
  lowest: number;
  /** Width and depth of the roof with its overhang, as it was made */
  size: [number, number];
  /** Lines seen from above: x and y of both ends and the kind */
  lines: [number, number, number, number, RoofLineKind][];
};

const parsed = new WeakMap<Piece, RoofData | null>();

/** The roof data of a piece, or null if it is not a roof. */
export function roofOf(piece: Piece): RoofData | null {
  const known = parsed.get(piece);
  if (known !== undefined) return known;
  let data: RoofData | null = null;
  const value = piece.properties?.find((pr) => pr.name === ROOF_PROPERTY)?.value;
  if (value) {
    try {
      const json = JSON.parse(value) as Partial<RoofData>;
      if (Array.isArray(json.outline) && Array.isArray(json.lines) && Array.isArray(json.size)) {
        data = json as RoofData;
      }
    } catch {
      // Not a roof we can read: an ordinary piece
    }
  }
  parsed.set(piece, data);
  return data;
}

export function isRoof(piece: Piece): boolean {
  return roofOf(piece) !== null;
}

/** A line of a roof in plan coordinates. */
export type RoofLine = { a: Pt; b: Pt; kind: RoofLineKind };

/**
 * The lines of a roof in the plan. They follow the piece: moved, turned, mirrored, and
 * stretched if another program resized it.
 */
export function roofLines(piece: Piece, data: RoofData): RoofLine[] {
  const a = piece.attrs;
  const sx = (data.size[0] > 0 ? a.width / data.size[0] : 1) * (a.model_mirrored ? -1 : 1);
  const sy = data.size[1] > 0 ? a.depth / data.size[1] : 1;
  const cos = Math.cos(a.angle ?? 0);
  const sin = Math.sin(a.angle ?? 0);
  const place = (x: number, y: number): Pt => [
    a.x + x * sx * cos - y * sy * sin,
    a.y + x * sx * sin + y * sy * cos,
  ];
  return data.lines.map(([x1, y1, x2, y2, kind]) => ({
    a: place(x1, y1),
    b: place(x2, y2),
    kind,
  }));
}

/** True if `p` lies on a line of the roof: a roof is picked by its lines, not by its area. */
export function roofHit(piece: Piece, data: RoofData, p: Pt, tolerance: number): boolean {
  return roofLines(piece, data).some(({ a, b }) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)) <= tolerance;
  });
}

/**
 * A texture of a roof as the texture fields of the properties show it: its image is a file
 * of the model of the piece.
 */
export function roofTexture(piece: Piece, texture: RoofTexture | undefined): Texture | null {
  const folder = piece.attrs.model?.split("/")[0];
  if (!texture || !folder) return null;
  return {
    role: null,
    name: texture.name,
    image: `${folder}/${texture.file}`,
    width: texture.width,
    height: texture.height,
    angle: null,
    scale: null,
    catalog_id: texture.catalogId ?? null,
  };
}

/** Width and depth of the area a roof covers, without its overhang. */
export function coveredSize(data: RoofData): [number, number] {
  const xs = data.outline.map((p) => p[0]);
  const ys = data.outline.map((p) => p[1]);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

/** Height of the top of the walls above the floor of the level, where the roof starts. */
export function roofBase(piece: Piece, data: RoofData): number {
  return (piece.attrs.elevation ?? 0) - data.lowest;
}

/**
 * The rectangle of a roof from three clicks: two corners along one side and a point on the
 * opposite side. With fewer points, what is known so far (for the preview).
 */
export function roofRectangle(points: Pt[]): Pt[] {
  const [a, b, c] = points;
  if (!a || !b) return points.slice(0, 1);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (!c || len < 1e-6) return [a, b];
  // Distance of the third point from the first side, across it
  const nx = -dy / len;
  const ny = dx / len;
  const d = (c[0] - a[0]) * nx + (c[1] - a[1]) * ny;
  return [a, b, [b[0] + nx * d, b[1] + ny * d], [a[0] + nx * d, a[1] + ny * d]];
}
