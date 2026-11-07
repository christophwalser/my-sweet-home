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
  wallPolygon,
} from "../model";
import { sameLevel } from "./drawPlan";
import { pieceCorners, wallOutline } from "./handles";
import { pointInPolygon } from "./interaction";

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

type WallGeom = { id: string; start: Pt; end: Pt; thickness: number; arc: number | null };

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
  for (const g of geoms.values()) {
    if (!ids.has(g.id)) outlines.push(wallOutline(g.start, g.end, g.thickness, g.arc));
    const wall = home.walls.find((w) => w.attrs.id === g.id);
    if (!wall) continue;
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
    if (!sameLevel(wall.attrs.level, levelId)) return;
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
