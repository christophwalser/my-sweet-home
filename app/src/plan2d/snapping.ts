// Magnetism of the 2D plan, modeled on Sweet Home 3D and extended with guides:
// 1. points (wall ends, wall side corners, room corners, the first point of the path),
// 2. a direction from the previous point, in stages: right angles to the wall at the
//    corner (±10°), multiples of 45° (±5°), parallel/perpendicular to nearby walls
//    (±4°), otherwise 5° steps (1° with Shift); along that direction the point snaps
//    to alignment guides
//    (same x or y as a reference point) and to wall or room lines,
// 3. without a previous point: lines (projection), alignment guides, whole cm.
// All coordinates in cm (y down).

import {
  forEachPiece,
  type Home,
  type Pt,
  pieceAtLevel,
  type WallShape,
  wallAtLevel,
} from "../model";
import { usePreferences } from "../preferences";
import { sameLevel } from "./drawPlan";
import { levelGuides } from "./guideData";

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
  /** Preferred directions (rad) besides the angle steps, e.g. of nearby walls */
  directions: number[];
  /** Names of special points, shown when the cursor snaps to them (key: `pointKey`) */
  labels?: Map<string, string>;
  /** Shown when the point snaps onto one of `lines` */
  lineLabel?: string;
  /** Labels of single lines instead of `lineLabel` (same index as `lines`), e.g. "on ruler" */
  lineLabels?: (string | undefined)[];
  /** Snap points of nearby elements, drawn as markers so the user sees where to click */
  hints?: { pt: Pt; label: string }[];
  /** Fine angle steps (1° instead of 5°), e.g. while Shift is pressed */
  fine?: boolean;
  /**
   * Directions (rad) of the walls meeting at the previous point (the joined wall or the
   * previous segment). Right angles and straight continuations to them win over all
   * other directions within `CORNER_TOLERANCE`; Alt disables magnetism.
   */
  corner?: number[];
  /** No angle magnetism: the direction follows the pointer (preference "Angles" off) */
  freeAngle?: boolean;
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

const DEG = Math.PI / 180;
/** Important directions (multiples of 45°) and how far they attract. */
const MAJOR_STEP = 45 * DEG;
const MAJOR_TOLERANCE_DEG = 5;
/** Fine steps between the important directions (Shift); the normal ones are a preference. */
const FINE_STEP_DEG = 1;
/** Directions of nearby walls win over the small steps within this tolerance. */
const WALL_DIRECTION_TOLERANCE = 4 * DEG;

/**
 * Staged angle magnetism in degrees: multiples of 45° attract within ±5°, other angles
 * snap to 5° steps. With `fine` (Shift) only plain 1° steps apply, so angles next to
 * 45° multiples can be set too.
 */
export function snapAngleDeg(deg: number, fine: boolean): number {
  if (!usePreferences.getState().snapAngles) return Math.round(deg * 10) / 10;
  if (fine) return Math.round(deg / FINE_STEP_DEG) * FINE_STEP_DEG;
  const major = Math.round(deg / 45) * 45;
  if (Math.abs(deg - major) < MAJOR_TOLERANCE_DEG) return major;
  const step = fine ? FINE_STEP_DEG : usePreferences.getState().angleStep;
  return Math.round(deg / step) * step;
}

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

/** Intersection of two segments (with a small tolerance at their ends), or null. */
function segmentIntersection([a, b]: Segment, [c, d]: Segment): Pt | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  // Tolerance of 0.5 cm along each segment
  const et = 0.5 / (Math.hypot(rx, ry) || 1);
  const eu = 0.5 / (Math.hypot(sx, sy) || 1);
  if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) return null;
  return [a[0] + t * rx, a[1] + t * ry];
}

/** Note shown when a point snaps onto line `i` of the context. */
function lineNote(ctx: SnapContext, i: number): string | null {
  return ctx.lineLabels?.[i] ?? ctx.lineLabel ?? null;
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
    const free = !!ctx.freeAngle;
    let dirAngle = free ? raw : snapAngleDeg(raw / DEG, !!ctx.fine) * DEG;
    let note: string | null = null;
    // A wall direction wins over a 45° multiple only if it is closer
    const onMajor =
      Math.abs(raw / MAJOR_STEP - Math.round(raw / MAJOR_STEP)) * 45 < MAJOR_TOLERANCE_DEG;
    let bestWall = free
      ? -1
      : onMajor
        ? Math.min(WALL_DIRECTION_TOLERANCE, angleDiff(dirAngle, raw))
        : WALL_DIRECTION_TOLERANCE;
    const corner = ctx.corner ?? [];
    if (ctx.fine && !free) {
      // Shift: only 1° steps, counted from the wall at the corner if there is one, so the
      // corner angle is a whole degree; no other stage may override them
      bestWall = -1;
      if (corner.length > 0) {
        const base = corner[0];
        const rel = Math.round((raw - base) / (FINE_STEP_DEG * DEG)) * FINE_STEP_DEG;
        dirAngle = base + rel * DEG;
        note = "1° steps to wall";
      } else {
        note = "1° steps";
      }
    }
    // Right angles to the wall at the corner come first (not with Shift)
    let bestCorner = ctx.fine || free ? -1 : CORNER_TOLERANCE;
    for (const d of corner) {
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
        // Only directions that differ from the snapped step need a note
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
    ctx.lines.forEach((s, i) => {
      const hit = raySegment(previous, dir, s);
      if (hit && dist(hit, q) < snappedDist && dist(hit, previous) > 1) {
        snappedDist = dist(hit, q);
        snapped = { pt: hit, marker: hit, guides: [], note: note ?? lineNote(ctx, i) };
      }
    });
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
  let bestLine = -1;
  ctx.lines.forEach((s, i) => {
    const q = projectOnSegment(p, s);
    if (dist(q, p) < bestDist) {
      best = q;
      bestDist = dist(q, p);
      bestLine = i;
    }
  });
  if (best) return { pt: best, marker: best, guides: [], note: lineNote(ctx, bestLine) };
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
    /** Fine angle steps (Shift) */
    fine?: boolean;
  } = {},
): SnapContext {
  const { path = [], excludeId, excludePoint, near, thickness, anchor, fine } = options;
  const corner: number[] = [];
  const nearSides: { seg: Segment; wall: number }[] = [];
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
  /** Labels of single lines (the others get the purpose's label) */
  const lineLabelOf = new Map<Segment, string>();
  const refs: Pt[] = [];
  const directions: number[] = [];
  const keep = (q: Pt) => !excludePoint || dist(q, excludePoint) > 1e-6;

  home.walls.forEach((w, i) => {
    const a = w.attrs;
    if (!wallAtLevel(home, w, levelId) || a.id === excludeId) return;
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
      if (showHints && !a.arc_extent) {
        // The faces of nearby walls: a wall can end on them and start at their corners
        for (const side of [s.left, s.right]) {
          const face: Segment = [side[0], side[side.length - 1]];
          lines.push(face);
          lineLabelOf.set(face, "on wall face");
        }
        for (const c of corners.filter(keep)) named(c, "wall corner");
      }
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
      // Corners of the wall sides (outer and inner faces); dimensions and measurements
      // name them, so the user sees that the point lies on the face, not on the axis
      for (const c of corners.filter(keep)) {
        points.push(c);
        if (purpose === "dimension") labels.set(pointKey(c), "wall corner");
      }
      // Sides near the cursor: their crossings with other walls' sides are corners too
      for (const side of [s.left, s.right]) {
        for (let k = 0; k + 1 < side.length; k++) {
          const seg: Segment = [side[k], side[k + 1]];
          if (near && dist(near, projectOnSegment(near, seg)) < radius * 6) {
            nearSides.push({ seg, wall: i });
          }
        }
      }
      for (const side of [s.left, s.right]) {
        for (let k = 0; k + 1 < side.length; k++) lines.push([side[k], side[k + 1]]);
      }
    }
    if (anchor && !a.arc_extent && purpose !== "polyline" && near) {
      // Foot of the perpendicular from the previous point on the axis and the faces
      if (distanceToWall(near, start, end) < radius * 8) {
        const segs: Segment[] = [
          [s.left[0], s.left[s.left.length - 1]],
          [s.right[0], s.right[s.right.length - 1]],
        ];
        if (purpose === "wall") segs.push([start, end]);
        for (const seg of segs) {
          const foot = perpendicularFoot(anchor, seg);
          if (foot && dist(foot, anchor) > 1) named(foot, "perpendicular");
        }
      }
    }
    if (purpose !== "polyline") {
      // Dimensions and measurements align with the wall faces, never with the axis
      // (the axis ends lie in the middle of the wall, where an outer length can't be read)
      if (purpose !== "dimension") refs.push(...[start, end].filter(keep));
      if (purpose === "room" || purpose === "dimension") refs.push(...corners.filter(keep));
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
    // Corners of furniture: points to measure from and guides to align with
    forEachPiece(home.furniture, (p) => {
      const a = p.attrs;
      if (!pieceAtLevel(home, p, levelId) || a.visible === false) return;
      refs.push([a.x, a.y]);
      const w = (a.width_in_plan ?? a.width) / 2;
      const d = (a.depth_in_plan ?? a.depth) / 2;
      const c = Math.cos(a.angle ?? 0);
      const s = Math.sin(a.angle ?? 0);
      for (const [lx, ly] of [
        [-w, -d],
        [w, -d],
        [w, d],
        [-w, d],
      ]) {
        const q: Pt = [a.x + lx * c - ly * s, a.y + lx * s + ly * c];
        if (!keep(q)) continue;
        points.push(q);
        refs.push(q);
        labels.set(pointKey(q), `corner of ${a.name}`);
      }
    });
  }

  // Corners where sides of different walls cross (e.g. the inner corner of two walls
  // that overlap instead of being joined)
  for (let a = 0; a < nearSides.length; a++) {
    for (let b = a + 1; b < nearSides.length; b++) {
      if (nearSides[a].wall === nearSides[b].wall) continue;
      const x = segmentIntersection(nearSides[a].seg, nearSides[b].seg);
      if (x && keep(x)) {
        points.push(x);
        labels.set(pointKey(x), "wall corner");
      }
    }
  }

  // Right-angle magnetism at the previous point: walls ending there and the previous segment
  if (anchor && purpose !== "polyline") {
    for (const w of home.walls) {
      const a = w.attrs;
      if (!wallAtLevel(home, w, levelId) || a.id === excludeId || a.arc_extent) continue;
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

  // Preference "Objects" off: no points and lines of walls, rooms and furniture
  const settings = usePreferences.getState();
  if (!settings.snapObjects) {
    points.length = 0;
    lines.length = 0;
    refs.length = 0;
    hints.length = 0;
    directions.length = 0;
    labels.clear();
  }

  // The path being drawn: its first point closes it, all its points align
  if (path.length > 0) {
    points.push(path[0]);
    if (path.length >= 2)
      labels.set(pointKey(path[0]), purpose === "room" ? "finish room" : "close");
  }
  refs.push(...path);

  // Ruler guides: their ends, middles and crossings, the lines themselves and their directions
  const lineLabels: (string | undefined)[] = lines.map((l) => lineLabelOf.get(l));
  if (settings.snapToRulers) {
    const rulers: Segment[] = levelGuides(home, levelId)
      .filter((g) => g.id !== excludeId)
      .map((g) => [
        [g.x_start, g.y_start],
        [g.x_end, g.y_end],
      ]);
    const others = [...lines];
    rulers.forEach((s, i) => {
      const [a, b] = s;
      if (dist(a, b) < 1) return;
      named(a, "ruler end");
      named(b, "ruler end");
      named([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], "ruler middle");
      refs.push(...[a, b].filter(keep));
      directions.push(Math.atan2(b[1] - a[1], b[0] - a[0]));
      for (const o of [...others, ...rulers.slice(i + 1)]) {
        const x = segmentIntersection(s, o);
        if (x && keep(x)) {
          points.push(x);
          labels.set(pointKey(x), "ruler crossing");
        }
      }
      lines.push(s);
      lineLabels.push("on ruler");
    });
  }
  // Avoid directions that are too many to be meaningful
  return {
    radius,
    points,
    lines,
    lineLabels,
    refs,
    directions: dedupeAngles(directions).slice(0, 8),
    labels,
    lineLabel: purpose === "wall" ? "on wall axis" : purpose === "polyline" ? undefined : "on edge",
    corner,
    fine,
    hints,
    freeAngle: !settings.snapAngles,
  };
}

/** Foot of the perpendicular from `p` on segment `s`, or null if it lies beside the segment. */
export function perpendicularFoot(p: Pt, [a, b]: Segment): Pt | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return null;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  if (t <= 0.001 || t >= 0.999) return null;
  return [a[0] + t * dx, a[1] + t * dy];
}

function distanceToWall(p: Pt, a: Pt, b: Pt): number {
  return dist(p, projectOnSegment(p, [a, b]));
}

/** Directions modulo 90° without duplicates; multiples of 45° are covered anyway. */
function dedupeAngles(angles: number[]): number[] {
  const out: number[] = [];
  for (const a of angles) {
    const m = ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    const isStep = Math.abs(m / MAJOR_STEP - Math.round(m / MAJOR_STEP)) < 1e-3;
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
