// Terrain in 3D: a reference object marked as terrain replaces the flat ground under it, which
// would otherwise cut through the slope.

import { forEachPiece, type Home, type Pt, replacesGround } from "../model";

/** Corners of the footprint of each terrain object, clockwise in the plan. */
export function groundHoles(home: Home): Pt[][] {
  const holes: Pt[][] = [];
  const boxes: [number, number, number, number][] = [];
  forEachPiece(home.furniture, (p) => {
    if (!replacesGround(p)) return;
    const a = p.attrs;
    const w = (a.width_in_plan ?? a.width) / 2;
    const d = (a.depth_in_plan ?? a.depth) / 2;
    if (!(w > 0 && d > 0)) return;
    const c = Math.cos(a.angle ?? 0);
    const s = Math.sin(a.angle ?? 0);
    const ring: Pt[] = (
      [
        [-w, -d],
        [w, -d],
        [w, d],
        [-w, d],
      ] as Pt[]
    ).map(([x, y]) => [a.x + x * c - y * s, a.y + x * s + y * c]);
    const xs = ring.map((q) => q[0]);
    const ys = ring.map((q) => q[1]);
    const box: [number, number, number, number] = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ];
    // Holes that overlap cannot be cut out of one face: the first one stays
    const overlaps = boxes.some(
      (b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1],
    );
    if (overlaps) return;
    boxes.push(box);
    holes.push(ring);
  });
  return holes;
}

/** What `groundHoles` depends on, as a value that can be compared. */
export function groundHolesKey(home: Home): string {
  return JSON.stringify(
    groundHoles(home).map((ring) => ring.map((q) => q.map((v) => Math.round(v * 10) / 10))),
  );
}
