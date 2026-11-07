// Magnetism of the 2D plan, modeled on Sweet Home 3D and extended with guides:
// 1. points (wall ends, wall side corners, room corners, the first point of the path),
// 2. a direction from the previous point: 15° steps, or parallel/perpendicular to
//    nearby walls; along that direction the point snaps to alignment guides
//    (same x or y as a reference point) and to wall or room lines,
// 3. without a previous point: lines (projection), alignment guides, whole cm.
// All coordinates in cm (y down).

import { forEachPiece, type Home, type Pt, type WallShape } from "../model";
import { sameLevel } from "./drawPlan";

export type Segment = [Pt, Pt];

export type SnapContext = {
  /** Snap radius in cm */
  radius: number;
  /** Point targets (highest priority) */
  points: Pt[];
  /** Segments the point can snap onto (wall axes or sides, room edges) */
  lines: Segment[];
  /** Reference points for horizontal and vertical alignment guides */
  refs: Pt[];
  /** Preferred directions (rad) besides the 15° steps, e.g. of nearby walls */
  directions: number[];
  /** Names of special points, shown when the cursor snaps to them (key: `pointKey`) */
  labels?: Map<string, string>;
  /** Shown when the point snaps onto one of `lines` */
  lineLabel?: string;
  /** Snap points of nearby elements, drawn as markers so the user sees where to click */
  hints?: { pt: Pt; label: string }[];
  /**
   * Directions (rad) of the walls meeting at the previous point (the joined wall or the
   * previous segment). Right angles and straight continuations to them win over all
   * other directions within `CORNER_TOLERANCE`; Alt disables magnetism.
   */
  corner?: number[];
};

/** Tolerance of the right-angle magnetism to the wall at the corner. */
const CORNER_TOLERANCE = (10 * Math.PI) / 180;

/** Key of a point in `SnapContext.labels`. */
export function pointKey(p: Pt): string {
  return `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
}

export type Snapped = {
  pt: Pt;
  /** Snapped onto a point or line (shown as a circle) */
  marker: Pt | null;
  /** Alignment guides to draw (dashed), from a reference point to the result */
  guides: Segment[];
  /** Explanation of a direction snap, e.g. "⊥ wall" */
  note: string | null;
};

const STEP = Math.PI / 12;
/** Directions of nearby walls win over the 15° steps within this tolerance. */
const WALL_DIRECTION_TOLERANCE = (4 * Math.PI) / 180;

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

/** Closest point of segment `s` to `p`. */
export function projectOnSegment(p: Pt, [a, b]: Segment): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return [a[0] + t * dx, a[1] + t * dy];
}

/** Intersection of the ray `origin + t·dir` (t ≥ 0) with segment `s`, or null. */
function raySegment(origin: Pt, dir: Pt, [a, b]: Segment): Pt | null {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const den = dir[0] * ey - dir[1] * ex;
  if (Math.abs(den) < 1e-9) return null;
  const wx = a[0] - origin[0];
  const wy = a[1] - origin[1];
  const t = (wx * ey - wy * ex) / den;
  const u = (wx * dir[1] - wy * dir[0]) / den;
  if (t < 0 || u < -1e-6 || u > 1 + 1e-6) return null;
  return [origin[0] + t * dir[0], origin[1] + t * dir[1]];
}

/** Snaps a drawing point. `previous` is the last point of the path (or the fixed end). */
export function snapDraw(p: Pt, previous: Pt | null, ctx: SnapContext): Snapped {
  const r = ctx.radius;
  // 1. Points
  let best: Pt | null = null;
  let bestDist = r;
  for (const t of ctx.points) {
    const d = dist(t, p);
    if (d <= bestDist && (!previous || dist(t, previous) > 1e-6)) {
      best = t;
      bestDist = d;
    }
  }
  if (best) {
    return {
      pt: [best[0], best[1]],
      marker: best,
      guides: [],
      note: ctx.labels?.get(pointKey(best)) ?? null,
    };
  }

  if (previous) {
    // 2. Direction from the previous point
    const raw = Math.atan2(p[1] - previous[1], p[0] - previous[0]);
    const length = dist(p, previous);
    let dirAngle = Math.round(raw / STEP) * STEP;
    let note: string | null = null;
    let bestWall = WALL_DIRECTION_TOLERANCE;
    // Right angles to the wall at the corner come first
    let bestCorner = CORNER_TOLERANCE;
    for (const d of ctx.corner ?? []) {
      for (let k = 0; k < 4; k++) {
        const a = d + (k * Math.PI) / 2;
        const diff = angleDiff(a, raw);
        if (diff < bestCorner) {
          bestCorner = diff;
          dirAngle = a;
          note = k % 2 === 1 ? "90° to wall" : "in line with wall";
          bestWall = -1;
        }
      }
    }
    for (const d of ctx.directions) {
      for (let k = 0; k < 4; k++) {
        const a = d + (k * Math.PI) / 2;
        const diff = angleDiff(a, raw);
        // Only directions that are not already a 15° step need a note
        if (diff < bestWall && angleDiff(a, dirAngle) > 1e-3) {
          bestWall = diff;
          dirAngle = a;
          note = k % 2 === 0 ? "∥ wall" : "⊥ wall";
        }
      }
    }
    const dir: Pt = [Math.cos(dirAngle), Math.sin(dirAngle)];
    const along = length * Math.cos(angleDiff(dirAngle, raw));
    const q: Pt = [previous[0] + dir[0] * along, previous[1] + dir[1] * along];

    // Along the direction: lines and alignment guides close to the projected point
    let snapped: Snapped | null = null;
    let snappedDist = r;
    for (const s of ctx.lines) {
      const hit = raySegment(previous, dir, s);
      if (hit && dist(hit, q) < snappedDist && dist(hit, previous) > 1) {
        snappedDist = dist(hit, q);
        snapped = { pt: hit, marker: hit, guides: [], note: note ?? ctx.lineLabel ?? null };
      }
    }
    for (const ref of ctx.refs) {
      if (Math.abs(dir[0]) > 1e-6 && Math.abs(ref[0] - previous[0]) > 1e-6) {
        const t = (ref[0] - previous[0]) / dir[0];
        const hit: Pt = [ref[0], previous[1] + dir[1] * t];
        if (t > 0 && dist(hit, q) < snappedDist) {
          snappedDist = dist(hit, q);
          snapped = { pt: hit, marker: null, guides: [[ref, hit]], note };
        }
      }
      if (Math.abs(dir[1]) > 1e-6 && Math.abs(ref[1] - previous[1]) > 1e-6) {
        const t = (ref[1] - previous[1]) / dir[1];
        const hit: Pt = [previous[0] + dir[0] * t, ref[1]];
        if (t > 0 && dist(hit, q) < snappedDist) {
          snappedDist = dist(hit, q);
          snapped = { pt: hit, marker: null, guides: [[ref, hit]], note };
        }
      }
    }
    if (snapped) return snapped;
    const rounded = Math.round(along);
    return {
      pt: [previous[0] + dir[0] * rounded, previous[1] + dir[1] * rounded],
      marker: null,
      guides: [],
      note,
    };
  }

  // 3. No previous point: lines, then alignment guides, then whole centimeters
  for (const s of ctx.lines) {
    const q = projectOnSegment(p, s);
    if (dist(q, p) < bestDist) {
      best = q;
      bestDist = dist(q, p);
    }
  }
  if (best) return { pt: best, marker: best, guides: [], note: ctx.lineLabel ?? null };
  let x = Math.round(p[0]);
  let y = Math.round(p[1]);
  const guides: Segment[] = [];
  let bx = r;
  let by = r;
  let refX: Pt | null = null;
  let refY: Pt | null = null;
  for (const ref of ctx.refs) {
    if (Math.abs(ref[0] - p[0]) < bx) {
      bx = Math.abs(ref[0] - p[0]);
      refX = ref;
    }
    if (Math.abs(ref[1] - p[1]) < by) {
      by = Math.abs(ref[1] - p[1]);
      refY = ref;
    }
  }
  if (refX) x = refX[0];
  if (refY) y = refY[1];
  if (refX) guides.push([refX, [x, y]]);
  if (refY) guides.push([refY, [x, y]]);
  return { pt: [x, y], marker: null, guides, note: null };
}

/** What the point being placed belongs to; decides which targets attract it. */
export type SnapPurpose = "wall" | "room" | "polyline" | "dimension";

/** Collects the snap targets for drawing or editing on a level. */
export function snapContext(
  purpose: SnapPurpose,
  home: Home,
  wallShapes: WallShape[],
  levelId: string | null,
  radius: number,
  options: {
    /** Points of the path being drawn (the first one closes it) */
    path?: Pt[];
    /** Element being edited: its own points are no targets */
    excludeId?: string;
    /** Point being moved: not a target */
    excludePoint?: Pt;
    /** Center of the area of interest, for the directions of nearby walls */
    near?: Pt;
    /** Thickness of the wall being drawn, for the points where it ends flush */
    thickness?: number;
    /** Previous point (fixed end): walls meeting there give right-angle magnetism */
    anchor?: Pt;
  } = {},
): SnapContext {
  const { path = [], excludeId, excludePoint, near, thickness, anchor } = options;
  const corner: number[] = [];
  const points: Pt[] = [];
  const labels = new Map<string, string>();
  const hints: { pt: Pt; label: string }[] = [];
  /** Adds a named point target; nearby ones are also shown as hints */
  /** Whether the hints of the current wall are shown (the cursor is close to it) */
  let showHints = false;
  const named = (pt: Pt, label: string) => {
    if (excludePoint && dist(pt, excludePoint) < 1e-6) return;
    points.push(pt);
    labels.set(pointKey(pt), label);
    if (showHints) hints.push({ pt, label });
  };
  const lines: Segment[] = [];
  const refs: Pt[] = [];
  const directions: number[] = [];
  const keep = (q: Pt) => !excludePoint || dist(q, excludePoint) > 1e-6;

  home.walls.forEach((w, i) => {
    const a = w.attrs;
    if (!sameLevel(a.level, levelId) || a.id === excludeId) return;
    const start: Pt = [a.x_start, a.y_start];
    const end: Pt = [a.x_end, a.y_end];
    const s = wallShapes[i];
    const corners: Pt[] = [
      s.left[0],
      s.left[s.left.length - 1],
      s.right[0],
      s.right[s.right.length - 1],
    ];
    if (purpose === "wall") {
      showHints = !!near && distanceToWall(near, start, end) < radius * 8;
      named(start, "wall end");
      named(end, "wall end");
      if (!a.arc_extent) {
        lines.push([start, end]);
        const len = dist(start, end);
        const ux = (end[0] - start[0]) / (len || 1);
        const uy = (end[1] - start[1]) / (len || 1);
        named([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], "wall middle");
        // A wall drawn across from here is flush with the end face of this wall
        const half = (thickness ?? 0) / 2;
        if (half > 0 && len > 2 * half + 1) {
          named([start[0] + ux * half, start[1] + uy * half], "flush with wall end");
          named([end[0] - ux * half, end[1] - uy * half], "flush with wall end");
        }
      }
    } else if (purpose === "room" || purpose === "dimension") {
      points.push(...corners.filter(keep));
      if (purpose === "dimension") points.push(...[start, end].filter(keep));
      for (const side of [s.left, s.right]) {
        for (let k = 0; k + 1 < side.length; k++) lines.push([side[k], side[k + 1]]);
      }
    }
    if (purpose !== "polyline") {
      refs.push(...[start, end].filter(keep));
      if (purpose === "room") refs.push(...corners.filter(keep));
      if (!a.arc_extent && (!near || distanceToWall(near, start, end) < 300)) {
        directions.push(Math.atan2(end[1] - start[1], end[0] - start[0]));
      }
    }
  });

  if (purpose !== "polyline") {
    for (const room of home.rooms) {
      if (!sameLevel(room.attrs.level, levelId) || room.attrs.id === excludeId) continue;
      const pts: Pt[] = room.points.map((q) => [q.x, q.y]);
      points.push(...pts.filter(keep));
      refs.push(...pts.filter(keep));
      if (purpose === "room" || purpose === "dimension") {
        for (let k = 0; k < pts.length; k++) lines.push([pts[k], pts[(k + 1) % pts.length]]);
      }
    }
  }
  if (purpose === "dimension") {
    forEachPiece(home.furniture, (p) => {
      if (sameLevel(p.attrs.level, levelId)) refs.push([p.attrs.x, p.attrs.y]);
    });
  }

  // Right-angle magnetism at the previous point: walls ending there and the previous segment
  if (anchor && purpose !== "polyline") {
    for (const w of home.walls) {
      const a = w.attrs;
      if (!sameLevel(a.level, levelId) || a.id === excludeId || a.arc_extent) continue;
      const s: Pt = [a.x_start, a.y_start];
      const e: Pt = [a.x_end, a.y_end];
      if (dist(s, anchor) < 0.01 || dist(e, anchor) < 0.01) {
        corner.push(Math.atan2(e[1] - s[1], e[0] - s[0]));
      }
    }
  }
  if (path.length >= 2) {
    const a = path[path.length - 2];
    const b = path[path.length - 1];
    corner.push(Math.atan2(b[1] - a[1], b[0] - a[0]));
  }

  // The path being drawn: its first point closes it, all its points align
  if (path.length > 0) {
    points.push(path[0]);
    if (path.length >= 2)
      labels.set(pointKey(path[0]), purpose === "room" ? "finish room" : "close");
  }
  refs.push(...path);
  // Avoid directions that are too many to be meaningful
  return {
    radius,
    points,
    lines,
    refs,
    directions: dedupeAngles(directions).slice(0, 8),
    labels,
    lineLabel: purpose === "wall" ? "on wall axis" : purpose === "polyline" ? undefined : "on edge",
    corner,
    hints,
  };
}

function distanceToWall(p: Pt, a: Pt, b: Pt): number {
  return dist(p, projectOnSegment(p, [a, b]));
}

/** Directions modulo 90° without duplicates; 15° steps are covered anyway. */
function dedupeAngles(angles: number[]): number[] {
  const out: number[] = [];
  for (const a of angles) {
    const m = ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    const isStep = Math.abs(m / STEP - Math.round(m / STEP)) < 1e-3;
    if (!isStep && !out.some((o) => angleDiff(o, m) < 1e-3)) out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------- wall geometry for previews

/** Points along the axis of a wall (an arc if `arcExtent` is set). */
export function wallAxis(start: Pt, end: Pt, arcExtent: number | null): Pt[] {
  if (!arcExtent || Math.abs(arcExtent) < 1e-4) return [start, end];
  const chord = dist(start, end);
  const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
  const d = chord / (2 * Math.tan(arcExtent / 2));
  const mx = (start[0] + end[0]) / 2;
  const my = (start[1] + end[1]) / 2;
  const cx = mx - Math.sin(angle) * d;
  const cy = my + Math.cos(angle) * d;
  const radius = Math.hypot(start[0] - cx, start[1] - cy);
  const a0 = Math.atan2(start[1] - cy, start[0] - cx);
  const n = Math.max(4, Math.ceil((Math.abs(arcExtent) / (Math.PI / 2)) * 8));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (arcExtent * i) / n;
    pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
  }
  return pts;
}

/** Outline of a polyline with the given half width (mitered joins, open ends). */
export function offsetOutline(pts: Pt[], half: number): Pt[] {
  if (pts.length < 2) return [];
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const n1 = normal(i > 0 ? prev : pts[i], i > 0 ? pts[i] : next);
    const n2 = normal(i + 1 < pts.length ? pts[i] : prev, i + 1 < pts.length ? next : pts[i]);
    let nx = n1[0] + n2[0];
    let ny = n1[1] + n2[1];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    // Miter length, limited for very sharp angles
    const cos = nx * n1[0] + ny * n1[1];
    const m = half / Math.max(cos, 0.2);
    left.push([pts[i][0] + nx * m, pts[i][1] + ny * m]);
    right.push([pts[i][0] - nx * m, pts[i][1] - ny * m]);
  }
  return [...left, ...right.reverse()];
}

/** Left normal (like the left side of a wall: (sin, −cos) of the direction). */
function normal(a: Pt, b: Pt): Pt {
  const len = dist(a, b) || 1;
  return [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
}
