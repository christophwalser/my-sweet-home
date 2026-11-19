// Moving elements in the 2D plan: preview of joined walls with the angles at
// their corners, magnetism that keeps a single wall moving straight (so the
// corners keep their angles), and furniture that docks to wall sides with its
// back like in Sweet Home 3D.

import {
  forEachPiece,
  type Home,
  type Piece,
  type Pt,
  type WallShape,
  wallAtLevel,
  wallPolygon,
} from "../model";
import { sameLevel } from "./drawPlan";
import { lengthText, pieceCorners, wallOutline } from "./handles";
import { pointInPolygon } from "./interaction";
import { roundTo } from "./moveStep";
import type { Segment } from "./snapping";

/** Corner between two walls during a move. */
export type Joint = {
  at: Pt;
  /** Unit directions from the corner along both walls */
  a: Pt;
  b: Pt;
  /** Angle between the walls in degrees (0..180) */
  deg: number;
};

export type MovePreview = {
  /** Outlines of moved and stretched walls */
  outlines: Pt[][];
  joints: Joint[];
};

export type WallGeom = { id: string; start: Pt; end: Pt; thickness: number; arc: number | null };

/** Wall geometry after moving `ids` by (dx, dy): selected walls move, joined ends follow. */
function movedWalls(home: Home, ids: Set<string>, dx: number, dy: number): Map<string, WallGeom> {
  const out = new Map<string, WallGeom>();
  for (const w of home.walls) {
    const a = w.attrs;
    const moved = ids.has(a.id);
    const startFollows = !moved && !!a.wall_at_start && ids.has(a.wall_at_start);
    const endFollows = !moved && !!a.wall_at_end && ids.has(a.wall_at_end);
    if (!moved && !startFollows && !endFollows) continue;
    const shift = (p: Pt, on: boolean): Pt => (on ? [p[0] + dx, p[1] + dy] : p);
    out.set(a.id, {
      id: a.id,
      start: shift([a.x_start, a.y_start], moved || startFollows),
      end: shift([a.x_end, a.y_end], moved || endFollows),
      thickness: a.thickness,
      arc: a.arc_extent,
    });
  }
  return out;
}

function unit(from: Pt, to: Pt): Pt {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  return [(to[0] - from[0]) / len, (to[1] - from[1]) / len];
}

/** Angle in degrees between two unit vectors. */
function angleBetween(a: Pt, b: Pt): number {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]));
  return (Math.acos(dot) * 180) / Math.PI;
}

/** Preview of a move: outlines of the affected walls and the angles at their corners. */
export function movePreview(
  home: Home,
  wallShapes: WallShape[],
  selection: string[],
  dx: number,
  dy: number,
): MovePreview {
  const ids = new Set(selection);
  const geoms = movedWalls(home, ids, dx, dy);
  const outlines: Pt[][] = [];
  for (const g of geoms.values()) {
    if (!ids.has(g.id)) outlines.push(wallOutline(g.start, g.end, g.thickness, g.arc));
  }
  const joints = wallJoints(home, geoms, new Set(geoms.keys()));
  // Doors and windows standing in a moved wall move with it (like edit_move)
  const movedPolygons = home.walls
    .map((w, i) => ({ w, poly: wallPolygon(wallShapes[i]) }))
    .filter(({ w }) => ids.has(w.attrs.id));
  if (movedPolygons.length > 0) {
    forEachPiece(home.furniture, (p) => {
      if (p.kind !== "DoorOrWindow" || (p.attrs.id && ids.has(p.attrs.id))) return;
      const a = p.attrs;
      const inside = movedPolygons.some(
        ({ w, poly }) => w.attrs.level === a.level && pointInPolygon([a.x, a.y], poly),
      );
      if (inside) {
        outlines.push(
          pieceCorners(
            a.x + dx,
            a.y + dy,
            a.width_in_plan ?? a.width,
            a.depth_in_plan ?? a.depth,
            a.angle ?? 0,
          ),
        );
      }
    });
  }
  return { outlines, joints: joints.filter((j) => j.deg < 179.5) };
}

/**
 * Corners between the walls `ids` and the walls joined to them, with their angles.
 * `geoms` overrides the geometry of walls being changed.
 */
export function wallJoints(home: Home, geoms: Map<string, WallGeom>, ids: Set<string>): Joint[] {
  const joints: Joint[] = [];
  const seen = new Set<string>();
  const geomOf = (id: string): WallGeom | null => {
    const g = geoms.get(id);
    if (g) return g;
    const w = home.walls.find((x) => x.attrs.id === id);
    if (!w) return null;
    const a = w.attrs;
    return {
      id,
      start: [a.x_start, a.y_start],
      end: [a.x_end, a.y_end],
      thickness: a.thickness,
      arc: a.arc_extent,
    };
  };
  for (const id of ids) {
    const g = geomOf(id);
    const wall = home.walls.find((w) => w.attrs.id === id);
    if (!g || !wall) continue;
    for (const [joinedId, atStart] of [
      [wall.attrs.wall_at_start, true],
      [wall.attrs.wall_at_end, false],
    ] as [string | null, boolean][]) {
      if (!joinedId) continue;
      const key = [g.id, joinedId].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const other = geomOf(joinedId);
      if (!other) continue;
      const at = atStart ? g.start : g.end;
      const mine = atStart ? g.end : g.start;
      // The end of the other wall that touches this corner
      const otherFar =
        Math.hypot(other.start[0] - at[0], other.start[1] - at[1]) <
        Math.hypot(other.end[0] - at[0], other.end[1] - at[1])
          ? other.end
          : other.start;
      const a = unit(at, mine);
      const b = unit(at, otherFar);
      joints.push({ at, a, b, deg: angleBetween(a, b) });
    }
  }
  return joints;
}

/** Angles at the corners of the selected walls (shown while they are selected). */
export function selectionJoints(home: Home, selection: string[]): Joint[] {
  const ids = new Set(selection.filter((id) => home.walls.some((w) => w.attrs.id === id)));
  return ids.size > 0 ? wallJoints(home, new Map(), ids).filter((j) => j.deg < 179.5) : [];
}

/**
 * Angles at the corners of a wall whose ends change (handle drags): the wall itself and
 * the walls joined at a moved end, which follow.
 */
export function editedWallJoints(home: Home, id: string, start: Pt, end: Pt): Joint[] {
  const wall = home.walls.find((w) => w.attrs.id === id);
  if (!wall) return [];
  const a = wall.attrs;
  const geoms = new Map<string, WallGeom>();
  geoms.set(id, { id, start, end, thickness: a.thickness, arc: a.arc_extent });
  const ids = new Set([id]);
  for (const [joinedId, oldPt, newPt] of [
    [a.wall_at_start, [a.x_start, a.y_start], start],
    [a.wall_at_end, [a.x_end, a.y_end], end],
  ] as [string | null, Pt, Pt][]) {
    if (!joinedId || (oldPt[0] === newPt[0] && oldPt[1] === newPt[1])) continue;
    const j = home.walls.find((w) => w.attrs.id === joinedId);
    if (!j) continue;
    const ja = j.attrs;
    const s: Pt = [ja.x_start, ja.y_start];
    const e: Pt = [ja.x_end, ja.y_end];
    const startTouches = Math.hypot(s[0] - oldPt[0], s[1] - oldPt[1]) < 0.01;
    geoms.set(joinedId, {
      id: joinedId,
      start: startTouches ? newPt : s,
      end: startTouches ? e : newPt,
      thickness: ja.thickness,
      arc: ja.arc_extent,
    });
    ids.add(joinedId);
  }
  return wallJoints(home, geoms, ids).filter((j) => j.deg < 179.5);
}

/** Tolerance of the direction magnetism for moving a single wall. */
const STRAIGHT_TOLERANCE = Math.tan((15 * Math.PI) / 180);

/**
 * With magnetism, a single selected wall moves perpendicular to itself (keeps
 * the angles of its corners) or along itself when the drag is close to that
 * direction.
 */
export function constrainMove(home: Home, selection: string[], offset: Pt): Pt {
  if (selection.length !== 1) return offset;
  const w = home.walls.find((x) => x.attrs.id === selection[0]);
  if (!w) return offset;
  const a = w.attrs;
  const dir = unit([a.x_start, a.y_start], [a.x_end, a.y_end]);
  const along = offset[0] * dir[0] + offset[1] * dir[1];
  const across = offset[0] * -dir[1] + offset[1] * dir[0];
  if (Math.abs(along) <= STRAIGHT_TOLERANCE * Math.abs(across)) {
    return [Math.round(-dir[1] * across), Math.round(dir[0] * across)];
  }
  if (Math.abs(across) <= STRAIGHT_TOLERANCE * Math.abs(along)) {
    return [Math.round(dir[0] * along), Math.round(dir[1] * along)];
  }
  return offset;
}

/** Position of a piece docked to a wall side. */
export type Docked = { x: number; y: number; angleDeg: number; outline: Pt[] };

/**
 * Docks a piece moved to `center` to the closest wall side within `radius`: the
 * piece turns parallel to the wall with its back against it (like Sweet Home 3D).
 */
export function dockToWall(
  home: Home,
  wallShapes: WallShape[],
  levelId: string | null,
  piece: Piece,
  center: Pt,
  radius: number,
): Docked | null {
  const a = piece.attrs;
  if (piece.kind === "DoorOrWindow" || a.pitch || a.roll) return null;
  const w = a.width_in_plan ?? a.width;
  const d = a.depth_in_plan ?? a.depth;
  let best: Docked | null = null;
  let bestGap = radius;
  home.walls.forEach((wall, i) => {
    if (!wallAtLevel(home, wall, levelId)) return;
    const shape = wallShapes[i];
    for (const side of [shape.left, shape.right]) {
      for (let k = 0; k + 1 < side.length; k++) {
        const p0 = side[k];
        const p1 = side[k + 1];
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (len < 1) continue;
        const ux = (p1[0] - p0[0]) / len;
        const uy = (p1[1] - p0[1]) / len;
        const t = (center[0] - p0[0]) * ux + (center[1] - p0[1]) * uy;
        if (t < 0 || t > len) continue;
        const foot: Pt = [p0[0] + ux * t, p0[1] + uy * t];
        const dist = Math.hypot(center[0] - foot[0], center[1] - foot[1]);
        // Gap between the back of the piece and the wall side
        const gap = Math.abs(dist - d / 2);
        if (gap >= bestGap || dist < 1e-6) continue;
        // Unit vector from the piece towards the wall
        const nx = (foot[0] - center[0]) / dist;
        const ny = (foot[1] - center[1]) / dist;
        // Back of the piece is its local −y side: rotate([0, −1], angle) = (sin, −cos) = n
        const angle = Math.atan2(nx, -ny);
        const x = foot[0] - nx * (d / 2);
        const y = foot[1] - ny * (d / 2);
        let deg = ((((angle * 180) / Math.PI) % 360) + 360) % 360;
        deg = Math.round(deg * 100) / 100;
        bestGap = gap;
        best = {
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
          angleDeg: deg,
          outline: pieceCorners(x, y, w, d, angle),
        };
      }
    }
  });
  return best;
}

// ---------------------------------------------------------------- doors and windows in walls

/** A door or window in a wall: the wall axis and the free space around the piece. */
export type WallSlot = {
  wallIndex: number;
  /** Wall start and unit direction along the wall */
  start: Pt;
  u: Pt;
  thickness: number;
  /** Position of the piece center along the wall axis */
  t: number;
  /** Ends of the free space around the piece: wall corners (inner face) or other openings */
  prev: number;
  next: number;
  /** Angle that keeps the piece along the wall, on the side it opens to */
  angle: number;
};

/**
 * How a door or window sits in a wall of this thickness: its depth, and the shift of its wall
 * part from the wall axis towards its front.
 */
export type WallFit = { depth: number; shift: number; cutThrough: boolean };

/**
 * Fits a door or window into a wall (as `fit_in_wall` in msh-core). The part `wall_thickness`
 * of its depth is the wall: up to that thickness the depth follows the wall and the part lies
 * centered on it. In a thicker wall the piece keeps its real depth (`natural`, from the
 * catalog, else its current depth), so frame and handle are not stretched; it sits flush with
 * the side it opens to and the opening goes through the whole wall (a reveal).
 */
export function fitInWall(piece: Piece, thickness: number, natural?: number): WallFit {
  const a = piece.attrs;
  if (a.resizable === false || a.width_depth_deformable === false) {
    return { depth: a.depth, shift: 0, cutThrough: false };
  }
  const fraction = Math.max(a.wall_thickness ?? 1, 0.01);
  const depth = natural ?? a.depth;
  const part = depth * fraction;
  if (thickness > part + 0.5) return { depth, shift: (thickness - part) / 2, cutThrough: true };
  return { depth: thickness / fraction, shift: 0, cutThrough: false };
}

/** Center of a door or window whose wall part lies `shift` in front of the wall axis at `t`. */
export function centerInWall(
  slot: WallSlot,
  piece: Piece,
  t: number,
  depth: number,
  shift = 0,
): Pt {
  const a = piece.attrs;
  const fraction = Math.max(a.wall_thickness ?? 1, 0.01);
  const k = -depth / 2 + ((a.wall_distance ?? 0) + fraction / 2) * depth - shift;
  const px = slot.start[0] + slot.u[0] * t;
  const py = slot.start[1] + slot.u[1] * t;
  return [px + Math.sin(slot.angle) * k, py - Math.cos(slot.angle) * k];
}

/** Shift of the wall part of a door or window from the axis of the wall in `slot`. */
export function shiftInWall(slot: WallSlot, piece: Piece): number {
  const a = piece.attrs;
  const fraction = Math.max(a.wall_thickness ?? 1, 0.01);
  const wallPart = -a.depth / 2 + ((a.wall_distance ?? 0) + fraction / 2) * a.depth;
  // Wall part center, signed across the wall towards the piece's front
  const wx = a.x - Math.sin(a.angle ?? 0) * wallPart - slot.start[0];
  const wy = a.y + Math.cos(a.angle ?? 0) * wallPart - slot.start[1];
  return wx * -Math.sin(slot.angle) + wy * Math.cos(slot.angle);
}

/** Wall a dragged door or window slides in, and the side it opens to (its angle). */
export type SlideState = { wallIndex: number; angle: number };

/**
 * The straight wall a door or window at `center` stands in (or is moved to, within
 * `capture` cm of its sides), with the free space around it. With `followSide` the piece
 * turns to open to the side of the wall it is pulled out of. `held` is where it slid a
 * moment ago: it stays in that wall and on that side a little longer, so a hand that wanders
 * while it drags along the wall does not make the piece flicker.
 */
export function wallSlot(
  home: Home,
  wallShapes: WallShape[],
  levelId: string | null,
  piece: Piece,
  center: Pt,
  capture: number,
  followSide = false,
  held: SlideState | null = null,
): WallSlot | null {
  const a = piece.attrs;
  let best: WallSlot | null = null;
  let bestAcross = Number.POSITIVE_INFINITY;
  home.walls.forEach((wall, i) => {
    const w = wall.attrs;
    if (!wallAtLevel(home, wall, levelId) || w.arc_extent) return;
    const start: Pt = [w.x_start, w.y_start];
    const len = Math.hypot(w.x_end - w.x_start, w.y_end - w.y_start);
    if (len < 1) return;
    const u: Pt = [(w.x_end - w.x_start) / len, (w.y_end - w.y_start) / len];
    const rx = center[0] - start[0];
    const ry = center[1] - start[1];
    const t = rx * u[0] + ry * u[1];
    // The wall the piece slides in holds it twice as far and wins against a wall that is
    // only a little nearer (at a corner)
    const holds = held?.wallIndex === i;
    const reach = holds ? capture * 2 : capture;
    const distance = Math.abs(rx * -u[1] + ry * u[0]);
    const across = holds ? distance - capture / 2 : distance;
    if (t < 0 || t > len || distance > w.thickness / 2 + reach || across >= bestAcross) return;
    // Usable length: where both wall faces run (the inner face at corners)
    const shape = wallShapes[i];
    const range = (side: Pt[]) => {
      const ts = side.map((q) => (q[0] - start[0]) * u[0] + (q[1] - start[1]) * u[1]);
      return [Math.min(...ts), Math.max(...ts)];
    };
    const [l0, l1] = range(shape.left);
    const [r0, r1] = range(shape.right);
    let prev = Math.max(l0, r0);
    let next = Math.min(l1, r1);
    // Other doors and windows in this wall split the free space
    const poly = wallPolygon(shape);
    forEachPiece(home.furniture, (p) => {
      if (p.kind !== "DoorOrWindow" || p.attrs.id === a.id) return;
      if (!sameLevel(p.attrs.level, levelId)) return;
      if (!pointInPolygon([p.attrs.x, p.attrs.y], poly)) return;
      const tc = (p.attrs.x - start[0]) * u[0] + (p.attrs.y - start[1]) * u[1];
      const half = p.attrs.width / 2;
      if (tc < t) prev = Math.max(prev, tc + half);
      else next = Math.min(next, tc - half);
    });
    // Keep the side the piece opens to: the wall direction or the opposite one
    const wallAngle = Math.atan2(u[1], u[0]);
    const diff = Math.abs(
      (((((a.angle ?? 0) - wallAngle) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI,
    );
    // `diff` is the angle between the piece and the wall direction (0..π)
    let angle = diff > Math.PI / 2 ? wallAngle + Math.PI : wallAngle;
    if (followSide) {
      // While it slides the piece keeps the side it opens to. It turns (like in Sweet Home
      // 3D) only when it is pulled out of the wall on the other side: past the face of the
      // wall, not by the few centimeters a hand strays while dragging along the wall.
      // Positive towards the side the front (local +y) of a piece at `wallAngle` points to.
      if (holds && held) angle = held.angle;
      const side = rx * -u[1] + ry * u[0];
      if (Math.abs(side) > w.thickness / 2) angle = side > 0 ? wallAngle : wallAngle + Math.PI;
    }
    bestAcross = across;
    best = { wallIndex: i, start, u, thickness: w.thickness, t, prev, next, angle };
  });
  return best;
}

/** A door or window slid along a wall while it is dragged. */
export type Slid = Docked & {
  depth: number;
  guides: Segment[];
  /** Free spaces to the neighbors, drawn as measured distances */
  gaps: [Pt, Pt][];
  note: string | null;
  /** The opening goes through the whole wall (the piece is thinner than the wall) */
  cutThrough: boolean;
  /** Where it slides, handed to the next step of the drag (see `wallSlot`) */
  state: SlideState;
};

/** Distance across the walls up to which doors and windows of this level are lined up with. */
const ALIGN_RANGE = 800;

/**
 * Slides a dragged door or window along the wall it is moved to: it turns along the wall and
 * is fitted to the wall thickness (see `fitInWall`, `natural` is its catalog depth).
 *
 * With magnetism it snaps to the middle of the free space (within `snap`) and, within half
 * of that, into line with doors and windows that matter: the ones in the same wall line on
 * other levels (windows above each other) and the ones of parallel walls of this level up
 * to `ALIGN_RANGE` away. Everything else in the home is no target, so the positions between
 * stay reachable with the mouse. Between the targets the free space to the nearer neighbor
 * is a multiple of `step` (the reveal is a round number).
 *
 * In a wall thicker than the piece it also follows the hand across the wall: it stays where
 * it is while it is dragged along, and it catches the middle of the wall and both sides
 * (flush) within a small distance. Before, it could only sit flush with the side it opens
 * to, and jumped there with every move.
 */
export function slideInWall(
  home: Home,
  wallShapes: WallShape[],
  levelId: string | null,
  piece: Piece,
  center: Pt,
  capture: number,
  snap: number,
  magnetism: boolean,
  natural?: number,
  held: SlideState | null = null,
  step = 1,
): Slid | null {
  const slot = wallSlot(home, wallShapes, levelId, piece, center, capture, true, held);
  if (!slot) return null;
  const a = piece.attrs;
  const w = a.width;
  const { depth, shift: flush, cutThrough } = fitInWall(piece, slot.thickness, natural);
  const proj = (q: Pt) => (q[0] - slot.start[0]) * slot.u[0] + (q[1] - slot.start[1]) * slot.u[1];
  // Across the wall: where the hand holds the wall part of the piece, between the two
  // sides of the wall (`flush` is as far as it can go from the axis)
  let shift = flush;
  let acrossNote: string | null = null;
  if (cutThrough && flush > 0) {
    const held = { ...piece, attrs: { ...a, x: center[0], y: center[1], angle: slot.angle } };
    shift = Math.max(-flush, Math.min(flush, shiftInWall(slot, held)));
    if (magnetism) {
      const reach = Math.min(snap / 2, flush / 2);
      const target = [0, flush, -flush].find((v) => Math.abs(v - shift) < reach);
      shift = target ?? Math.max(-flush, Math.min(flush, roundTo(shift, step)));
    }
    acrossNote =
      Math.abs(shift) < 1e-6
        ? "middle of the wall"
        : Math.abs(Math.abs(shift) - flush) < 1e-6
          ? "flush with the wall"
          : null;
  }
  let t = slot.t;
  let note: string | null = null;
  let guideFrom: Pt | null = null;
  let guideAt: "center" | "start" | "end" = "center";
  if (magnetism) {
    let bestDist = Number.POSITIVE_INFINITY;
    const consider = (
      target: number,
      label: string,
      from: Pt | null,
      at: typeof guideAt,
      reach = snap / 2,
    ) => {
      const d = Math.abs(target - slot.t);
      if (d < reach && d < bestDist) {
        bestDist = d;
        t = target;
        note = label;
        guideFrom = from;
        guideAt = at;
      }
    };
    if (slot.next - slot.prev >= w) {
      consider((slot.prev + slot.next) / 2, "middle of the free space", null, "center", snap);
    }
    // In line with doors and windows of parallel walls
    const wallAngle = Math.atan2(slot.u[1], slot.u[0]);
    const acrossWall = (q: Pt) =>
      Math.abs((q[0] - slot.start[0]) * -slot.u[1] + (q[1] - slot.start[1]) * slot.u[0]);
    forEachPiece(home.furniture, (p) => {
      if (p.kind !== "DoorOrWindow" || p.attrs.id === a.id) return;
      const pa = p.attrs.angle ?? 0;
      const diff = (((pa - wallAngle) % Math.PI) + Math.PI) % Math.PI;
      if (Math.min(diff, Math.PI - diff) > 0.05) return;
      const c: Pt = [p.attrs.x, p.attrs.y];
      const half = p.attrs.width / 2;
      const ux = Math.cos(pa) * half;
      const uy = Math.sin(pa) * half;
      const tc = proj(c);
      // The edge nearer to the wall start first (the piece may be turned by 180°)
      const e1: Pt = [c[0] - ux, c[1] - uy];
      const e2: Pt = [c[0] + ux, c[1] + uy];
      const [lo, hi] = proj(e1) <= proj(e2) ? [e1, e2] : [e2, e1];
      const onOtherLevel = !sameLevel(p.attrs.level, levelId);
      // Of the other levels only what stands in the same wall line, of this level what is
      // not too far away
      const far = onOtherLevel ? slot.thickness / 2 + 30 : ALIGN_RANGE;
      if (acrossWall(c) > far) return;
      const where = onOtherLevel ? " (other level)" : "";
      consider(tc, `in line with ${p.attrs.name}${where}`, c, "center");
      consider(proj(lo) + w / 2, `edge in line with ${p.attrs.name}${where}`, lo, "start");
      consider(proj(hi) - w / 2, `edge in line with ${p.attrs.name}${where}`, hi, "end");
    });
    if (!note) {
      // The free space to the nearer neighbor in whole steps
      const before = t - w / 2 - slot.prev;
      const after = slot.next - (t + w / 2);
      t =
        before <= after
          ? slot.prev + w / 2 + roundTo(before, step)
          : slot.next - w / 2 - roundTo(after, step);
    }
  }
  const [x, y] = centerInWall(slot, piece, t, depth, shift);
  const guides: Segment[] = [];
  if (guideFrom) {
    const along = guideAt === "center" ? t : guideAt === "start" ? t - w / 2 : t + w / 2;
    const to: Pt = [slot.start[0] + slot.u[0] * along, slot.start[1] + slot.u[1] * along];
    guides.push([guideFrom, to]);
  }
  // Distances to the neighbors, beside the wall
  const n: Pt = [-slot.u[1], slot.u[0]];
  const off = slot.thickness / 2 + 25;
  const onAxis = (v: number): Pt => [
    slot.start[0] + slot.u[0] * v + n[0] * off,
    slot.start[1] + slot.u[1] * v + n[1] * off,
  ];
  const gaps: [Pt, Pt][] = [];
  if (t - w / 2 - slot.prev > 0.05) gaps.push([onAxis(slot.prev), onAxis(t - w / 2)]);
  if (slot.next - (t + w / 2) > 0.05) gaps.push([onAxis(t + w / 2), onAxis(slot.next)]);
  const angleDeg = Math.round((((((slot.angle * 180) / Math.PI) % 360) + 360) % 360) * 100) / 100;
  const left = Math.max(0, t - w / 2 - slot.prev);
  const right = Math.max(0, slot.next - (t + w / 2));
  const spaces = `${lengthText(left)} | ${lengthText(right)}`;
  const distances = acrossNote ? `${spaces} · ${acrossNote}` : spaces;
  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    angleDeg,
    outline: pieceCorners(x, y, w, depth, slot.angle),
    depth: Math.round(depth * 10) / 10,
    guides,
    gaps,
    note: note ? `${note} · ${distances}` : distances,
    cutThrough,
    state: { wallIndex: slot.wallIndex, angle: slot.angle },
  };
}
