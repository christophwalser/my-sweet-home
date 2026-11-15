// Precision of moves in the plan: the step a dragged offset is rounded to depends on the zoom,
// Shift locks a drag to one axis, and the arrow keys move by 1 mm, 1 cm or 10 cm.

import { forEachPiece, type Home, type Pt } from "../model";

/**
 * Direction (radians) a drag of `selection` is locked to with Shift: that of a single piece or
 * straight wall, else the plan axes (0).
 */
export function moveAxis(home: Home, selection: string[]): number {
  if (selection.length !== 1) return 0;
  const id = selection[0];
  const wall = home.walls.find((w) => w.attrs.id === id);
  if (wall) {
    const a = wall.attrs;
    return Math.atan2(a.y_end - a.y_start, a.x_end - a.x_start);
  }
  let angle = 0;
  forEachPiece(home.furniture, (p) => {
    if (p.attrs.id === id) angle = p.attrs.angle ?? 0;
  });
  return angle;
}

/** Steps a dragged offset can be rounded to, in cm. */
const STEPS = [0.1, 0.2, 0.5, 1];

/**
 * The step in cm a dragged offset is rounded to: the smallest of 1 mm, 2 mm, 5 mm and 1 cm
 * that is at least one screen pixel (`pixelCm`) long, so that zooming in gives finer moves.
 * Without magnetism offsets are only rounded to 0.01 cm.
 */
export function dragStep(pixelCm: number, magnetism: boolean): number {
  if (!magnetism) return 0.01;
  return STEPS.find((s) => s >= pixelCm) ?? 1;
}

/** Rounds `v` to a multiple of `step` without floating point noise (0.30000000000000004). */
export function roundTo(v: number, step: number): number {
  const r = Math.round(v / step) * step;
  return Math.round(r * 1000) / 1000;
}

/**
 * The offset locked to one axis (Shift while dragging): along or across `angle` (radians, the
 * plan axes for 0), whichever is closer to the dragged direction.
 */
export function lockAxis(offset: Pt, angle = 0): Pt {
  const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
  const along = offset[0] * ux + offset[1] * uy;
  const across = -offset[0] * uy + offset[1] * ux;
  return Math.abs(along) >= Math.abs(across)
    ? [along * ux, along * uy]
    : [-across * uy, across * ux];
}

/** Distance in cm the arrow keys move the selection: Alt 1 mm, Shift 10 cm, else 1 cm. */
export function nudgeStep(altKey: boolean, shiftKey: boolean): number {
  return altKey ? 0.1 : shiftKey ? 10 : 1;
}
