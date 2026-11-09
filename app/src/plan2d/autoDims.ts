// Automatic dimensions of the selected wall or piece: shown in the plan while it is
// selected, and added as dimension lines with "Add dimensions" in the context menu.

import { forEachPiece, type Home, type Pt, type WallShape } from "../model";
import { pieceCorners } from "./handles";

/** A dimension in the terms of `dimension_add`: measured points and offset (cm). */
export type AutoDim = { start: Pt; end: Pt; offset: number };

/** Distance of the automatic dimensions from the measured element in cm. */
const OFFSET = 25;

/**
 * Dimensions of a wall or a piece (width at the back, depth at the right).
 *
 * A wall gets a single dimension of its length between its end points (the axis), the same
 * length the properties panel shows and edits. It lies on the side away from the walls
 * joined to it, so at a corner it is outside.
 */
export function autoDimensions(home: Home, wallShapes: WallShape[], id: string): AutoDim[] {
  const i = home.walls.findIndex((w) => w.attrs.id === id);
  if (i >= 0) {
    const a = home.walls[i].attrs;
    if (a.arc_extent || !wallShapes[i]) return [];
    const start: Pt = [a.x_start, a.y_start];
    const end: Pt = [a.x_end, a.y_end];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return [];
    // An offset > 0 points along (-dy, dx), the side of the joined walls is the sign of
    // their far ends on that normal
    let side = 0;
    for (const joined of [a.wall_at_start, a.wall_at_end]) {
      const j = joined ? home.walls.find((w) => w.attrs.id === joined)?.attrs : undefined;
      if (!j) continue;
      for (const q of [
        [j.x_start, j.y_start],
        [j.x_end, j.y_end],
      ]) {
        side += ((q[0] - start[0]) * -dy + (q[1] - start[1]) * dx) / len;
      }
    }
    const offset = a.thickness / 2 + OFFSET;
    return [{ start, end, offset: side > 0 ? -offset : offset }];
  }
  let dims: AutoDim[] = [];
  forEachPiece(home.furniture, (p) => {
    if (p.attrs.id !== id) return;
    const a = p.attrs;
    const c = pieceCorners(
      a.x,
      a.y,
      a.width_in_plan ?? a.width,
      a.depth_in_plan ?? a.depth,
      a.angle ?? 0,
    );
    // Width along the back, depth along the right side, both outside the piece
    dims = [
      { start: c[0], end: c[1], offset: -OFFSET },
      { start: c[1], end: c[2], offset: -OFFSET },
    ];
  });
  return dims;
}

/** The drawn line of a dimension: the measured segment moved by its offset. */
export function dimensionLine(d: AutoDim): [Pt, Pt] {
  const dx = d.end[0] - d.start[0];
  const dy = d.end[1] - d.start[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * d.offset;
  const ny = (dx / len) * d.offset;
  return [
    [d.start[0] + nx, d.start[1] + ny],
    [d.end[0] + nx, d.end[1] + ny],
  ];
}
