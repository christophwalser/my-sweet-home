// Dimensions already added for a wall or a piece ("Add dimensions of the piece" in the context
// menu), so the menu can offer to remove them instead.

import type { DimensionLine, Home, Pt } from "../model";
import type { AutoDim } from "./autoDims";

/** Distance in cm within which points count as the same (added values are rounded). */
const TOLERANCE = 0.5;

const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= TOLERANCE;

function onLevel(home: Home, d: DimensionLine, levelId: string | null): boolean {
  return home.levels.length === 0 || d.attrs.level === levelId;
}

/** Whether the dimension measures in the plan (not a height dimension). */
function isPlanDimension(d: DimensionLine): boolean {
  const a = d.attrs;
  return (a.elevation_start ?? 0) === (a.elevation_end ?? 0);
}

/**
 * IDs of the dimension lines of the level that measure the given dimensions (between the same
 * points, in either direction), or null if any of them is missing.
 */
export function existingDimensions(
  home: Home,
  levelId: string | null,
  dims: AutoDim[],
): string[] | null {
  if (dims.length === 0) return null;
  const ids: string[] = [];
  for (const dim of dims) {
    const found = home.dimension_lines.find((d) => {
      const a = d.attrs;
      if (!a.id || ids.includes(a.id) || !onLevel(home, d, levelId) || !isPlanDimension(d)) {
        return false;
      }
      const s: Pt = [a.x_start, a.y_start];
      const e: Pt = [a.x_end, a.y_end];
      return (near(s, dim.start) && near(e, dim.end)) || (near(s, dim.end) && near(e, dim.start));
    });
    if (!found?.attrs.id) return null;
    ids.push(found.attrs.id);
  }
  return ids;
}

/** ID of the height dimension of the level at `at` from `bottom` to `top`, if there is one. */
export function existingHeightDimension(
  home: Home,
  levelId: string | null,
  at: Pt,
  bottom: number,
  top: number,
): string | null {
  const found = home.dimension_lines.find((d) => {
    const a = d.attrs;
    return (
      !!a.id &&
      onLevel(home, d, levelId) &&
      near([a.x_start, a.y_start], at) &&
      near([a.x_end, a.y_end], at) &&
      Math.abs((a.elevation_start ?? 0) - bottom) <= TOLERANCE &&
      Math.abs((a.elevation_end ?? 0) - top) <= TOLERANCE
    );
  });
  return found?.attrs.id ?? null;
}
