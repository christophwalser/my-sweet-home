// Geometry helpers for the two sides of a wall, shared by the 2D plan and the 3D view.
//
// A wall shape (computed by msh-geometry) has a left and a right side polyline,
// both running from the wall start to the wall end. Their end points lie on the
// mitered wall ends, so the line from a left end point to the matching right end
// point is the wall's end cap.

import type { Baseboard, Pt, Wall, WallShape } from "../model";

export type WallSide = "left" | "right";

/** Baseboard of a wall side, if any. */
export function baseboardOf(wall: Wall, side: WallSide): Baseboard | undefined {
  const role = side === "left" ? "leftSideBaseboard" : "rightSideBaseboard";
  return wall.baseboards?.find((b) => b.attrs.role === role);
}

/**
 * Plan polygon of a baseboard: the side polyline plus the same polyline moved
 * outward by `thickness`. The end points are moved along the wall end caps, so
 * baseboards of joined walls meet with a miter like the walls themselves.
 * Returns the polygon (side points forward, offset points backward) and the
 * offset polyline alone (the visible front edge, from wall start to end).
 */
export function baseboardPolygon(
  shape: WallShape,
  side: WallSide,
  thickness: number,
): { poly: Pt[]; outer: Pt[] } | null {
  const pts = side === "left" ? shape.left : shape.right;
  const other = side === "left" ? shape.right : shape.left;
  if (pts.length < 2 || other.length < 2) return null;

  // Unit normals of the segments, pointing away from the wall
  const normals: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    normals.push(len > 1e-9 ? [-(by - ay) / len, (bx - ax) / len] : [0, 0]);
  }
  const across: Pt = [pts[0][0] - other[0][0], pts[0][1] - other[0][1]];
  const first = normals.find((n) => n[0] !== 0 || n[1] !== 0);
  if (!first) return null;
  if (first[0] * across[0] + first[1] * across[1] < 0) {
    for (const n of normals) {
      n[0] = -n[0];
      n[1] = -n[1];
    }
  }

  const n = pts.length;
  const outer: Pt[] = pts.map((p, i) => {
    if (i === 0 || i === n - 1) {
      // Slide along the end cap until the point is `thickness` away from the side
      const normal = normals[i === 0 ? 0 : n - 2];
      const q = i === 0 ? other[0] : other[other.length - 1];
      const cx = p[0] - q[0];
      const cy = p[1] - q[1];
      const clen = Math.hypot(cx, cy);
      if (clen > 1e-9) {
        const dot = (cx * normal[0] + cy * normal[1]) / clen;
        if (dot > 0.3) {
          const s = thickness / dot;
          return [p[0] + (cx / clen) * s, p[1] + (cy / clen) * s];
        }
      }
      return [p[0] + normal[0] * thickness, p[1] + normal[1] * thickness];
    }
    // Interior vertex: miter between the two adjacent segment offsets
    const n0 = normals[i - 1];
    const n1 = normals[i];
    let mx = n0[0] + n1[0];
    let my = n0[1] + n1[1];
    const mlen = Math.hypot(mx, my);
    if (mlen < 1e-9) return [p[0] + n1[0] * thickness, p[1] + n1[1] * thickness];
    mx /= mlen;
    my /= mlen;
    const cos = Math.max(0.3, mx * n1[0] + my * n1[1]);
    return [p[0] + (mx * thickness) / cos, p[1] + (my * thickness) / cos];
  });
  return { poly: [...pts, ...[...outer].reverse()], outer };
}
