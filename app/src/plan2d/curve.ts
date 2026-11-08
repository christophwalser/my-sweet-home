// Curved polylines (Sweet Home 3D's join style "CURVED"): a smooth curve through all
// points, as cubic Bézier segments of a Catmull-Rom spline.

import type { Pt } from "../model";

/** A cubic Bézier segment: two control points and the end point. */
export type Bezier = [Pt, Pt, Pt];

/** Bézier segments through `pts`, starting at `pts[0]`. */
export function curveSegments(pts: Pt[], closed: boolean): Bezier[] {
  const n = pts.length;
  if (n < 2) return [];
  const at = (i: number): Pt => {
    if (closed) return pts[((i % n) + n) % n];
    return pts[Math.max(0, Math.min(n - 1, i))];
  };
  const segments: Bezier[] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    segments.push([
      [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
      p2,
    ]);
  }
  return segments;
}

/** Points along the curve (for picking, outlines and the 3D view). */
export function sampleCurve(pts: Pt[], closed: boolean, perSegment = 12): Pt[] {
  if (pts.length < 2) return pts;
  const out: Pt[] = [pts[0]];
  let from = pts[0];
  for (const [c1, c2, to] of curveSegments(pts, closed)) {
    for (let k = 1; k <= perSegment; k++) {
      const t = k / perSegment;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      out.push([
        a * from[0] + b * c1[0] + c * c2[0] + d * to[0],
        a * from[1] + b * c1[1] + c * c2[1] + d * to[1],
      ]);
    }
    from = to;
  }
  return out;
}

/** The points a polyline is drawn through: sampled along the curve if it is curved. */
export function polylinePath(
  points: { x: number; y: number }[],
  joinStyle: string | null | undefined,
  closed: boolean,
): Pt[] {
  const pts: Pt[] = points.map((p) => [p.x, p.y]);
  return joinStyle === "CURVED" && pts.length > 2 ? sampleCurve(pts, closed) : pts;
}
