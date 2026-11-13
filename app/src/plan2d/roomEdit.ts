// Editing the outline of a room with its handles: right angles and alignments to the
// neighboring edges while a corner is dragged, a corner inserted in the middle of an edge,
// and an edge moved parallel.

import type { Pt } from "../model";
import type { Segment } from "./snapping";

export type CornerSnap = { pt: Pt; guides: Segment[]; note: string };

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

type Line = { through: Pt; dir: Pt; note: string };

/** Lines through the neighbor `n` on which the dragged corner makes a clean edge. */
function linesAt(n: Pt, other: Pt): Line[] {
  const out: Line[] = [];
  const len = dist(n, other);
  if (len > 1e-6) {
    const u: Pt = [(n[0] - other[0]) / len, (n[1] - other[1]) / len];
    out.push({ through: n, dir: [-u[1], u[0]], note: "90° to edge" });
    out.push({ through: n, dir: u, note: "in line with edge" });
  }
  for (const dir of [
    [1, 0],
    [0, 1],
  ] as Pt[]) {
    // An axis already covered by the edge directions adds nothing
    if (!out.some((l) => Math.abs(l.dir[0] * dir[1] - l.dir[1] * dir[0]) < 1e-6)) {
      out.push({ through: n, dir, note: dir[0] === 1 ? "horizontal" : "vertical" });
    }
  }
  return out;
}

function project(p: Pt, l: Line): Pt {
  const t = (p[0] - l.through[0]) * l.dir[0] + (p[1] - l.through[1]) * l.dir[1];
  return [l.through[0] + t * l.dir[0], l.through[1] + t * l.dir[1]];
}

function intersect(a: Line, b: Line): Pt | null {
  const den = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
  if (Math.abs(den) < 1e-9) return null;
  const wx = b.through[0] - a.through[0];
  const wy = b.through[1] - a.through[1];
  const t = (wx * b.dir[1] - wy * b.dir[0]) / den;
  return [a.through[0] + t * a.dir[0], a.through[1] + t * a.dir[1]];
}

/**
 * Snaps a dragged room corner `p` between its neighbors `prev` and `next` (whose other
 * neighbors are `prev2` and `next2`): right angles to the neighboring edges, straight
 * continuations and horizontal or vertical edges. Two of them at once where they cross.
 */
export function snapCorner(
  p: Pt,
  prev2: Pt,
  prev: Pt,
  next: Pt,
  next2: Pt,
  radius: number,
): CornerSnap | null {
  const before = linesAt(prev, prev2);
  const after = linesAt(next, next2);
  let best: CornerSnap | null = null;
  let bestDist = radius * 1.5;
  for (const a of before) {
    for (const b of after) {
      const x = intersect(a, b);
      if (x && dist(x, p) < bestDist && dist(x, prev) > 1 && dist(x, next) > 1) {
        bestDist = dist(x, p);
        best = {
          pt: x,
          guides: [
            [prev, x],
            [next, x],
          ],
          note: a.note === b.note ? a.note : `${a.note} · ${b.note}`,
        };
      }
    }
  }
  if (best) return best;
  bestDist = radius;
  for (const [l, n] of [
    ...before.map((l) => [l, prev] as const),
    ...after.map((l) => [l, next] as const),
  ]) {
    const q = project(p, l);
    if (dist(q, p) < bestDist && dist(q, n) > 1) {
      bestDist = dist(q, p);
      best = { pt: q, guides: [[n, q]], note: l.note };
    }
  }
  return best;
}

/** The points with a new corner `p` inserted after point `index` (on edge index → index+1). */
export function insertCorner(points: Pt[], index: number, p: Pt): Pt[] {
  return [...points.slice(0, index + 1), p, ...points.slice(index + 1)];
}

/**
 * The points with the edge from point `index` to the next one moved by `offset` along its left
 * normal (y down: (dy, -dx) of the edge direction).
 */
export function moveEdge(points: Pt[], index: number, offset: number): Pt[] {
  const n = points.length;
  const a = points[index];
  const b = points[(index + 1) % n];
  const len = dist(a, b) || 1;
  const nx = (b[1] - a[1]) / len;
  const ny = -(b[0] - a[0]) / len;
  return points.map((q, i) =>
    i === index || i === (index + 1) % n ? [q[0] + nx * offset, q[1] + ny * offset] : q,
  );
}

/** Signed distance of `p` from the edge a→b along its left normal. */
export function edgeOffset(a: Pt, b: Pt, p: Pt): number {
  const len = dist(a, b) || 1;
  return ((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / len;
}
