// Magnetism of moved elements ("smart guides"): the edges and the middle of the moved
// selection snap to the edges and middles of nearby furniture and to wall faces, equal gaps to
// both neighbors attract, and a single piece shows its distances to the next wall or piece in
// every direction. All coordinates in cm (y down).

import {
  forEachPiece,
  type Home,
  type Piece,
  type Pt,
  pieceAtLevel,
  type WallShape,
  wallAtLevel,
} from "../model";
import { elementOutlines } from "./interaction";
import type { Segment } from "./snapping";

/** Axis-aligned box. */
export type Box = { x0: number; y0: number; x1: number; y1: number };

/** A line a moved edge can snap to: `v` on the axis, from `lo` to `hi` across it. */
type Line = { v: number; lo: number; hi: number; center: boolean; box: Box | null };

/** What a selection can snap to while it is moved (collected once per drag). */
export type MoveTargets = { xs: Line[]; ys: Line[]; boxes: Box[]; segments: Segment[] };

/** A measured distance: from `a` to `b`, with an optional text instead of the length. */
export type Gap = [Pt, Pt, string?];

export type MoveSnap = {
  offset: Pt;
  guides: Segment[];
  note: string | null;
  gaps: Gap[];
};

/** Only targets closer than this to the moved selection attract it (cm). */
const NEAR = 600;

export function boxOf(pts: Pt[]): Box | null {
  if (pts.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

const moved = (b: Box, [dx, dy]: Pt): Box => ({
  x0: b.x0 + dx,
  y0: b.y0 + dy,
  x1: b.x1 + dx,
  y1: b.y1 + dy,
});

/** Box around the outlines of the selected elements. */
export function selectionBox(home: Home, wallShapes: WallShape[], selection: string[]): Box | null {
  return boxOf(
    selection.flatMap((id) => elementOutlines(home, wallShapes, id).flatMap((o) => o.pts)),
  );
}

/** The edges, middles and faces the selection can snap to on the level. */
export function moveTargets(
  home: Home,
  wallShapes: WallShape[],
  levelId: string | null,
  selection: string[],
): MoveTargets {
  const skip = new Set(selection);
  const xs: Line[] = [];
  const ys: Line[] = [];
  const boxes: Box[] = [];
  const segments: Segment[] = [];
  const addBox = (b: Box) => {
    boxes.push(b);
    xs.push({ v: b.x0, lo: b.y0, hi: b.y1, center: false, box: b });
    xs.push({ v: b.x1, lo: b.y0, hi: b.y1, center: false, box: b });
    xs.push({ v: (b.x0 + b.x1) / 2, lo: b.y0, hi: b.y1, center: true, box: b });
    ys.push({ v: b.y0, lo: b.x0, hi: b.x1, center: false, box: b });
    ys.push({ v: b.y1, lo: b.x0, hi: b.x1, center: false, box: b });
    ys.push({ v: (b.y0 + b.y1) / 2, lo: b.x0, hi: b.x1, center: true, box: b });
  };
  forEachPiece(home.furniture, (p) => {
    const a = p.attrs;
    if (!a.id || skip.has(a.id) || a.visible === false || !pieceAtLevel(home, p, levelId)) return;
    const pts = pieceOutline(p);
    const b = boxOf(pts);
    if (b) addBox(b);
    pts.forEach((q, i) => {
      segments.push([q, pts[(i + 1) % pts.length]]);
    });
  });
  home.walls.forEach((w, i) => {
    if (skip.has(w.attrs.id) || !wallAtLevel(home, w, levelId)) return;
    const shape = wallShapes[i];
    for (const side of [shape.left, shape.right]) {
      for (let k = 0; k + 1 < side.length; k++) {
        const [a, b] = [side[k], side[k + 1]];
        segments.push([a, b]);
        // Horizontal and vertical faces are lines to align with
        if (Math.abs(a[0] - b[0]) < 0.05) {
          xs.push({
            v: a[0],
            lo: Math.min(a[1], b[1]),
            hi: Math.max(a[1], b[1]),
            center: false,
            box: null,
          });
        } else if (Math.abs(a[1] - b[1]) < 0.05) {
          ys.push({
            v: a[1],
            lo: Math.min(a[0], b[0]),
            hi: Math.max(a[0], b[0]),
            center: false,
            box: null,
          });
        }
      }
    }
  });
  return { xs, ys, boxes, segments };
}

/** Corners of a piece in the plan. */
export function pieceOutline(p: Piece): Pt[] {
  const a = p.attrs;
  const w = (a.width_in_plan ?? a.width) / 2;
  const d = (a.depth_in_plan ?? a.depth) / 2;
  const c = Math.cos(a.angle ?? 0);
  const s = Math.sin(a.angle ?? 0);
  return [
    [-w, -d],
    [w, -d],
    [w, d],
    [-w, d],
  ].map(([x, y]) => [a.x + x * c - y * s, a.y + x * s + y * c] as Pt);
}

type AxisSnap = { delta: number; dist: number; guide: Segment; note: string; gaps: Gap[] };

/**
 * Best snap of the moved box `m` along one axis (x: its left/right edges and middle move onto
 * vertical lines): edges and middles of the targets, or equal gaps to both neighbors.
 */
function snapAxis(
  lines: Line[],
  boxes: Box[],
  m: Box,
  axis: "x" | "y",
  radius: number,
): AxisSnap | null {
  const lo = axis === "x" ? m.x0 : m.y0;
  const hi = axis === "x" ? m.x1 : m.y1;
  const mid = (lo + hi) / 2;
  const aLo = axis === "x" ? m.y0 : m.x0;
  const aHi = axis === "x" ? m.y1 : m.x1;
  const pt = (along: number, across: number): Pt =>
    axis === "x" ? [along, across] : [across, along];
  let best: AxisSnap | null = null;
  const consider = (delta: number, note: string, guide: Segment, gaps: Gap[] = []) => {
    const dist = Math.abs(delta);
    if (dist < radius && (!best || dist < best.dist)) best = { delta, dist, guide, note, gaps };
  };
  for (const l of lines) {
    // Only targets near the moved box across the axis
    if (l.lo > aHi + NEAR || l.hi < aLo - NEAR) continue;
    const span: [number, number] = [Math.min(l.lo, aLo), Math.max(l.hi, aHi)];
    const guide = (v: number): Segment => [pt(v, span[0]), pt(v, span[1])];
    if (l.center) {
      consider(l.v - mid, "center to center", guide(l.v));
    } else {
      // Side by side when the edges face each other (and at walls), otherwise in line
      const hiEdge = l.box !== null && l.v === (axis === "x" ? l.box.x1 : l.box.y1);
      const loEdge = l.box !== null && l.v === (axis === "x" ? l.box.x0 : l.box.y0);
      consider(l.v - lo, !l.box || hiEdge ? "edge to edge" : "in line", guide(l.v));
      consider(l.v - hi, !l.box || loEdge ? "edge to edge" : "in line", guide(l.v));
    }
  }
  // Equal gaps to the nearest neighbors on both sides (boxes overlapping across the axis)
  const across = (b: Box) => (axis === "x" ? [b.y0, b.y1] : [b.x0, b.x1]);
  const overlaps = (b: Box) => across(b)[0] < aHi && across(b)[1] > aLo;
  let before: Box | null = null;
  let after: Box | null = null;
  for (const b of boxes) {
    if (!overlaps(b)) continue;
    const bLo = axis === "x" ? b.x0 : b.y0;
    const bHi = axis === "x" ? b.x1 : b.y1;
    if (bHi <= lo + radius && (!before || bHi > (axis === "x" ? before.x1 : before.y1))) before = b;
    if (bLo >= hi - radius && (!after || bLo < (axis === "x" ? after.x0 : after.y0))) after = b;
  }
  if (before && after) {
    const end = axis === "x" ? (before as Box).x1 : (before as Box).y1;
    const start = axis === "x" ? (after as Box).x0 : (after as Box).y0;
    const gapBefore = lo - end;
    const gapAfter = start - hi;
    const delta = (gapAfter - gapBefore) / 2;
    const gap = gapBefore + delta;
    if (gap > 0.5) {
      const c =
        (Math.max(aLo, across(before)[0], across(after)[0]) +
          Math.min(aHi, across(before)[1], across(after)[1])) /
        2;
      const text = `= ${Math.round(gap * 10) / 10}`;
      consider(
        delta,
        "equal gaps",
        [pt(end, c), pt(end, c)],
        [
          [pt(end, c), pt(lo + delta, c), text],
          [pt(hi + delta, c), pt(start, c), text],
        ],
      );
    }
  }
  return best;
}

/**
 * Snaps the offset of a moved selection with the box `box` (before the move) to the targets:
 * edges and middles of nearby furniture, wall faces, equal gaps. The guides show what it
 * snapped to.
 */
export function snapMove(box: Box, targets: MoveTargets, offset: Pt, radius: number): MoveSnap {
  const m = moved(box, offset);
  const sx = snapAxis(targets.xs, targets.boxes, m, "x", radius);
  const sy = snapAxis(targets.ys, targets.boxes, m, "y", radius);
  const out: Pt = [offset[0] + (sx?.delta ?? 0), offset[1] + (sy?.delta ?? 0)];
  const notes = [sx?.note, sy?.note].filter((n): n is string => !!n);
  return {
    offset: out,
    guides: [sx, sy]
      .filter((s): s is AxisSnap => !!s && s.note !== "equal gaps")
      .map((s) => s.guide),
    note: notes.length > 0 ? [...new Set(notes)].join(" · ") : null,
    gaps: [...(sx?.gaps ?? []), ...(sy?.gaps ?? [])],
  };
}

/** Intersection distance of the ray from `o` in direction `d` with segment s, or null. */
function rayHit(o: Pt, d: Pt, [a, b]: Segment): number | null {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const den = d[0] * ey - d[1] * ex;
  if (Math.abs(den) < 1e-9) return null;
  const wx = a[0] - o[0];
  const wy = a[1] - o[1];
  const t = (wx * ey - wy * ex) / den;
  const u = (wx * d[1] - wy * d[0]) / den;
  return t >= -1e-6 && u >= -1e-6 && u <= 1 + 1e-6 ? t : null;
}

/** A distance of a piece to its neighbor in one direction. */
export type Distance = { a: Pt; b: Pt; dir: Pt; value: number };

/**
 * Distances from the sides of a piece (at `center`, turned by its angle) to the next wall face
 * or piece in its four directions, up to `max` cm.
 */
export function pieceDistances(
  piece: Piece,
  center: Pt,
  angle: number,
  segments: Segment[],
  max = 1000,
): Distance[] {
  const a = piece.attrs;
  const w = (a.width_in_plan ?? a.width) / 2;
  const d = (a.depth_in_plan ?? a.depth) / 2;
  const u: Pt = [Math.cos(angle), Math.sin(angle)];
  const v: Pt = [-Math.sin(angle), Math.cos(angle)];
  const out: Distance[] = [];
  for (const [dir, half] of [
    [u, w],
    [[-u[0], -u[1]], w],
    [v, d],
    [[-v[0], -v[1]], d],
  ] as [Pt, number][]) {
    const o: Pt = [center[0] + dir[0] * half, center[1] + dir[1] * half];
    let best = max;
    for (const s of segments) {
      const t = rayHit(o, dir, s);
      if (t !== null && t > 0.05 && t < best) best = t;
    }
    if (best < max) {
      out.push({ a: o, b: [o[0] + dir[0] * best, o[1] + dir[1] * best], dir, value: best });
    }
  }
  return out;
}
