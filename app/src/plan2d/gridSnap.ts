// Grid snap: drawn points and moved elements land on the grid lines of the plan where no
// object, angle or guide line catches them. Off by default (preference `snapGrid`).

import type { Home, Pt, WallShape } from "../model";
import { usePreferences } from "../preferences";
import { gridStep } from "./drawPlan";
import { selectionBox } from "./moveSnap";
import { roundTo } from "./moveStep";

/** Zoom of the plan in device pixels per cm, noted when it is drawn. */
let planScale = 1;

/** Notes the zoom of the plan: the grid that catches is the one that is drawn. */
export function setPlanScale(scale: number): void {
  if (scale > 0) planScale = scale;
}

/**
 * Distance of the grid lines that catch the pointer in cm, 0 while the grid snap is off. It
 * is the distance of the lines the plan draws at its zoom (see `gridStep`): with the
 * automatic distance it changes with the zoom.
 */
export function snapGridStep(
  prefs: { snapGrid: boolean; gridSpacing: number } = usePreferences.getState(),
  scale = planScale,
): number {
  return prefs.snapGrid ? gridStep(scale, prefs.gridSpacing) : 0;
}

/** The nearest grid line to a coordinate. */
export function toGrid(v: number, step: number): number {
  return step > 0 ? roundTo(v, step) : v;
}

/**
 * Length along a ray from `from` in direction `dir` (normalized) at which it crosses the grid
 * line nearest to the point `along` cm away: a segment drawn in a fixed direction ends on a
 * grid line, and on a grid point if it runs along one.
 */
export function gridAlong(from: Pt, dir: Pt, along: number, step: number): number {
  if (!(step > 0)) return along;
  let best = along;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const axis of [0, 1] as const) {
    if (Math.abs(dir[axis]) < 1e-6) continue;
    let line = toGrid(from[axis] + dir[axis] * along, step);
    let t = (line - from[axis]) / dir[axis];
    if (t <= 1e-6) {
      // The nearest line lies at or behind the start: the next one ahead
      line += Math.sign(dir[axis]) * step;
      t = (line - from[axis]) / dir[axis];
    }
    const d = Math.abs(t - along);
    if (d < bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Point of a selection that is put on the grid when it is moved: the start of the first
 * selected wall (walls are drawn by their points), else the upper left corner of the bounds
 * of the selection (furniture stands with its edges on the lines).
 */
export function gridAnchor(home: Home, wallShapes: WallShape[], selection: string[]): Pt | null {
  const wall = home.walls.find((w) => selection.includes(w.attrs.id));
  if (wall) return [wall.attrs.x_start, wall.attrs.y_start];
  const box = selectionBox(home, wallShapes, selection);
  return box ? [box.x0, box.y0] : null;
}

/**
 * The offset of a move with which `anchor` lands on the grid. A direction the selection does
 * not move in stays as it is (an axis lock, a wall moved across itself).
 */
export function gridOffset(anchor: Pt, offset: Pt, step: number): Pt {
  if (!(step > 0)) return offset;
  const on = (axis: 0 | 1) =>
    Math.abs(offset[axis]) < 1e-9
      ? offset[axis]
      : roundTo(toGrid(anchor[axis] + offset[axis], step) - anchor[axis], 0.001);
  return [on(0), on(1)];
}
