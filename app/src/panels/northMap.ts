// Geometry of the north alignment with a map: the outlines of the walls around their middle,
// and the turn that puts the north direction of the plan up.

import type { WallShape } from "../model";

/** Closed outline in cm, relative to the middle of all walls. */
export type Outline = [number, number][];

/** Outlines of the walls (left side, then the right side backwards) around their middle. */
export function planOutlines(shapes: WallShape[]): Outline[] {
  const outlines = shapes
    .map((s) => [...s.left, ...[...s.right].reverse()])
    .filter((o) => o.length >= 3);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of outlines) {
    for (const [x, y] of o) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return outlines.map((o) => o.map(([x, y]): [number, number] => [x - cx, y - cy]));
}

/** Meters per degree of latitude (and of longitude at the equator). */
const METERS_PER_DEGREE = 111_320;

/**
 * Position `east` and `south` meters away from `lat`/`lon` (degrees). Exact enough for the few
 * hundred meters a map around a home shows.
 */
export function offsetPosition(
  lat: number,
  lon: number,
  east: number,
  south: number,
): [number, number] {
  const cos = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return [lat - south / METERS_PER_DEGREE, lon + east / (METERS_PER_DEGREE * cos)];
}

/**
 * Whether the point (plan cm, relative to the middle of the walls, already turned back to the
 * plan) lies within the bounds of the outlines, with `margin` cm around them.
 */
export function insideOutlines(outlines: Outline[], x: number, y: number, margin = 0): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of outlines) {
    for (const [px, py] of o) {
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  }
  return x >= minX - margin && x <= maxX + margin && y >= minY - margin && y <= maxY + margin;
}

/**
 * Turn of plan coordinates (y down) for a north direction in radians (clockwise from the
 * top of the plan, as Sweet Home 3D's compass): afterwards north points up, as on a map.
 */
export function northRotation(north: number): (x: number, y: number) => [number, number] {
  const cos = Math.cos(-north);
  const sin = Math.sin(-north);
  return (x, y) => [x * cos - y * sin, x * sin + y * cos];
}
