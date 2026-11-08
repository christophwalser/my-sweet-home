// Automatic dimensions of the selected wall or piece: shown in the plan while it is
// selected, and added as dimension lines with "Add dimensions" in the context menu.

import { forEachPiece, type Home, type Pt, type WallShape } from "../model";
import { pieceCorners } from "./handles";

/** A dimension in the terms of `dimension_add`: measured points and offset (cm). */
export type AutoDim = { start: Pt; end: Pt; offset: number };

/** Distance of the automatic dimensions from the measured element in cm. */
const OFFSET = 25;

/** Dimensions of a wall (both faces) or a piece (width at the back, depth at the right). */
export function autoDimensions(home: Home, wallShapes: WallShape[], id: string): AutoDim[] {
  const i = home.walls.findIndex((w) => w.attrs.id === id);
  if (i >= 0) {
    if (home.walls[i].attrs.arc_extent) return [];
    const { left, right } = wallShapes[i];
    if (left.length < 2 || right.length < 2) return [];
    // A dimension's offset points to the right of its direction: the left face gets a
    // negative offset, so both lie outside the wall
    return [
      { start: left[0], end: left[left.length - 1], offset: -OFFSET },
      { start: right[0], end: right[right.length - 1], offset: OFFSET },
    ];
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
