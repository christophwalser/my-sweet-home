// Hit testing for editing in the 2D plan (magnetism is in snapping.ts).
// All coordinates are plan coordinates in cm (y down).

import {
  forEachGroup,
  forEachPiece,
  type Home,
  type Piece,
  type Pt,
  piecesWithTop,
  type WallShape,
  wallPolygon,
} from "../model";
import { polylinePath } from "./curve";

/** Kind of element found by a hit test. */
export type HitKind = "piece" | "wall" | "room" | "label" | "dimension" | "polyline" | "compass";

export type Hit = { id: string; kind: HitKind };

function sameLevel(itemLevel: string | null, levelId: string | null): boolean {
  return levelId === null || itemLevel === levelId;
}

/**
 * Pieces that belong to the base plan (Sweet Home 3D's `isBasePlanItem`): doors, windows and
 * furniture that is not movable. A locked base plan keeps them from being selected.
 */
export function isBasePlanPiece(piece: Piece): boolean {
  return piece.kind === "DoorOrWindow" || piece.attrs.movable === false;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Point in the local coordinates of a piece (origin at its center, unrotated). */
function toPieceLocal(p: Pt, piece: Piece): Pt {
  const a = piece.attrs;
  const angle = -(a.angle ?? 0);
  const x = p[0] - a.x;
  const y = p[1] - a.y;
  return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
}

export function pieceContains(piece: Piece, p: Pt): boolean {
  const [lx, ly] = toPieceLocal(p, piece);
  const w = piece.attrs.width_in_plan ?? piece.attrs.width;
  const d = piece.attrs.depth_in_plan ?? piece.attrs.depth;
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= d / 2;
}

/**
 * Finds the topmost element at `p`. `tolerance` is the pick radius in cm
 * (a few pixels at the current zoom).
 */
export function hitTest(
  home: Home,
  wallShapes: WallShape[],
  levelId: string | null,
  p: Pt,
  tolerance: number,
): Hit | null {
  // Doors and windows are drawn on top of the walls, other furniture below; a piece
  // inside a group selects the whole group. A locked base plan leaves only movable
  // furniture selectable, like Sweet Home 3D.
  const locked = home.attrs.base_plan_locked === true;
  const pieces = piecesWithTop(home.furniture).filter(
    (e) => sameLevel(e.level, levelId) && e.topId && !(locked && isBasePlanPiece(e.piece)),
  );
  pieces.sort((a, b) => (b.piece.attrs.elevation ?? 0) - (a.piece.attrs.elevation ?? 0));
  for (const { piece, topId } of pieces) {
    if (piece.kind === "DoorOrWindow" && pieceContains(piece, p)) {
      return { id: topId as string, kind: "piece" };
    }
  }
  // The compass is drawn on top of the plan (part of the base plan)
  const compass = home.compass?.attrs;
  if (!locked && compass && compass.visible !== false) {
    if (Math.hypot(p[0] - compass.x, p[1] - compass.y) <= compass.diameter / 2 + tolerance) {
      return { id: "compass", kind: "compass" };
    }
  }
  if (locked) {
    for (const { piece, topId } of pieces) {
      if (pieceContains(piece, p)) return { id: topId as string, kind: "piece" };
    }
    return null;
  }
  for (const label of home.labels) {
    if (!sameLevel(label.attrs.level, levelId) || !label.attrs.id) continue;
    const size = label.text_style?.font_size ?? 18;
    const width = Math.max(...label.text.split("\n").map((l) => l.length)) * size * 0.55;
    const lines = label.text.split("\n").length;
    if (
      Math.abs(p[0] - label.attrs.x) <= width / 2 + tolerance &&
      p[1] <= label.attrs.y + tolerance &&
      p[1] >= label.attrs.y - size * 1.2 * lines - tolerance
    ) {
      return { id: label.attrs.id, kind: "label" };
    }
  }
  for (const d of home.dimension_lines) {
    if (!sameLevel(d.attrs.level, levelId) || !d.attrs.id) continue;
    const { x_start: xs, y_start: ys, x_end: xe, y_end: ye, offset } = d.attrs;
    const len = Math.hypot(xe - xs, ye - ys) || 1;
    const nx = (-(ye - ys) / len) * offset;
    const ny = ((xe - xs) / len) * offset;
    if (distanceToSegment(p, [xs + nx, ys + ny], [xe + nx, ye + ny]) <= tolerance) {
      return { id: d.attrs.id, kind: "dimension" };
    }
  }
  for (const { piece, topId } of pieces) {
    if (piece.kind !== "DoorOrWindow" && pieceContains(piece, p)) {
      return { id: topId as string, kind: "piece" };
    }
  }
  for (let i = home.walls.length - 1; i >= 0; i--) {
    const w = home.walls[i];
    if (!sameLevel(w.attrs.level, levelId)) continue;
    const poly = wallPolygon(wallShapes[i]);
    if (pointInPolygon(p, poly)) return { id: w.attrs.id, kind: "wall" };
    // Thin walls are hard to hit: also accept clicks close to the axis
    if (
      distanceToSegment(p, [w.attrs.x_start, w.attrs.y_start], [w.attrs.x_end, w.attrs.y_end]) <=
      tolerance
    ) {
      return { id: w.attrs.id, kind: "wall" };
    }
  }
  for (const pl of home.polylines) {
    if (!sameLevel(pl.attrs.level, levelId) || !pl.attrs.id) continue;
    const pts = polylinePath(pl.points, pl.attrs.join_style, !!pl.attrs.closed_path);
    for (let i = 0; i + 1 < pts.length; i++) {
      if (distanceToSegment(p, pts[i], pts[i + 1]) <= tolerance)
        return { id: pl.attrs.id, kind: "polyline" };
    }
  }
  for (let i = home.rooms.length - 1; i >= 0; i--) {
    const r = home.rooms[i];
    if (!sameLevel(r.attrs.level, levelId) || !r.attrs.id || r.points.length < 3) continue;
    if (
      pointInPolygon(
        p,
        r.points.map((pt) => [pt.x, pt.y] as Pt),
      )
    )
      return { id: r.attrs.id, kind: "room" };
  }
  return null;
}

/** Outlines (closed or open polylines) of an element, for selection highlights and drag previews. */
export function elementOutlines(
  home: Home,
  wallShapes: WallShape[],
  id: string,
): { pts: Pt[]; closed: boolean }[] {
  const out: { pts: Pt[]; closed: boolean }[] = [];
  forEachPiece(home.furniture, (p) => {
    if (p.attrs.id !== id) return;
    const a = p.attrs;
    const w = (a.width_in_plan ?? a.width) / 2;
    const d = (a.depth_in_plan ?? a.depth) / 2;
    const c = Math.cos(a.angle ?? 0);
    const s = Math.sin(a.angle ?? 0);
    const corners: Pt[] = [
      [-w, -d],
      [w, -d],
      [w, d],
      [-w, d],
    ];
    out.push({
      pts: corners.map(([x, y]) => [a.x + x * c - y * s, a.y + x * s + y * c]),
      closed: true,
    });
  });
  // A group: its rectangle, or the outlines of its pieces if it has none
  forEachGroup(home.furniture, (g) => {
    if (g.attrs.id !== id) return;
    const a = g.attrs;
    if (a.x != null && a.y != null && a.width != null && a.depth != null) {
      const cx = a.x;
      const cy = a.y;
      const w = a.width / 2;
      const d = a.depth / 2;
      const c = Math.cos(a.angle ?? 0);
      const s = Math.sin(a.angle ?? 0);
      const corners: Pt[] = [
        [-w, -d],
        [w, -d],
        [w, d],
        [-w, d],
      ];
      out.push({
        pts: corners.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]),
        closed: true,
      });
    } else {
      forEachPiece(g.items, (p) => {
        if (p.attrs.id) out.push(...elementOutlines(home, wallShapes, p.attrs.id));
      });
    }
  });
  home.walls.forEach((w, i) => {
    if (w.attrs.id === id) out.push({ pts: wallPolygon(wallShapes[i]), closed: true });
  });
  for (const r of home.rooms) {
    if (r.attrs.id === id) out.push({ pts: r.points.map((p) => [p.x, p.y]), closed: true });
  }
  const compass = home.compass?.attrs;
  if (id === "compass" && compass) {
    const r = compass.diameter / 2;
    const ring: Pt[] = [];
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      ring.push([compass.x + Math.cos(a) * r, compass.y + Math.sin(a) * r]);
    }
    out.push({ pts: ring, closed: true });
  }
  for (const pl of home.polylines) {
    if (pl.attrs.id === id)
      out.push({
        pts: polylinePath(pl.points, pl.attrs.join_style, !!pl.attrs.closed_path),
        closed: !!pl.attrs.closed_path && pl.attrs.join_style !== "CURVED",
      });
  }
  for (const l of home.labels) {
    if (l.attrs.id !== id) continue;
    const size = l.text_style?.font_size ?? 18;
    const width = Math.max(...l.text.split("\n").map((t) => t.length)) * size * 0.55;
    const height = size * 1.2 * l.text.split("\n").length;
    const { x, y } = l.attrs;
    out.push({
      pts: [
        [x - width / 2, y - height],
        [x + width / 2, y - height],
        [x + width / 2, y + size * 0.25],
        [x - width / 2, y + size * 0.25],
      ],
      closed: true,
    });
  }
  for (const d of home.dimension_lines) {
    if (d.attrs.id !== id) continue;
    const { x_start: xs, y_start: ys, x_end: xe, y_end: ye, offset } = d.attrs;
    const len = Math.hypot(xe - xs, ye - ys) || 1;
    const nx = (-(ye - ys) / len) * offset;
    const ny = ((xe - xs) / len) * offset;
    out.push({
      pts: [
        [xs, ys],
        [xs + nx, ys + ny],
        [xe + nx, ye + ny],
        [xe, ye],
      ],
      closed: false,
    });
  }
  return out;
}

/** IDs of all elements whose reference point lies inside the rectangle (rubber band). */
export function elementsInRect(home: Home, levelId: string | null, a: Pt, b: Pt): string[] {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const locked = home.attrs.base_plan_locked === true;
  const ids: string[] = [];
  // Pieces and groups (a group when all its pieces are inside)
  const groups = new Map<string, boolean>();
  for (const { piece, topId, level } of piecesWithTop(home.furniture)) {
    if (!sameLevel(level, levelId) || !topId) continue;
    if (locked && isBasePlanPiece(piece)) continue;
    const isInside = inside(piece.attrs.x, piece.attrs.y);
    if (topId === piece.attrs.id) {
      if (isInside) ids.push(topId);
    } else {
      groups.set(topId, (groups.get(topId) ?? true) && isInside);
    }
  }
  for (const [id, all] of groups) if (all) ids.push(id);
  if (locked) return ids;
  for (const w of home.walls) {
    const a2 = w.attrs;
    if (
      sameLevel(a2.level, levelId) &&
      inside(a2.x_start, a2.y_start) &&
      inside(a2.x_end, a2.y_end)
    ) {
      ids.push(a2.id);
    }
  }
  for (const r of home.rooms) {
    if (
      sameLevel(r.attrs.level, levelId) &&
      r.attrs.id &&
      r.points.every((p) => inside(p.x, p.y))
    ) {
      ids.push(r.attrs.id);
    }
  }
  for (const l of home.labels) {
    if (sameLevel(l.attrs.level, levelId) && l.attrs.id && inside(l.attrs.x, l.attrs.y))
      ids.push(l.attrs.id);
  }
  for (const d of home.dimension_lines) {
    const a2 = d.attrs;
    if (
      sameLevel(a2.level, levelId) &&
      a2.id &&
      inside(a2.x_start, a2.y_start) &&
      inside(a2.x_end, a2.y_end)
    ) {
      ids.push(a2.id);
    }
  }
  return ids;
}

/** Nearest wall to `p` within `maxDistance` cm, with the offset of the projection from the wall start. */
export function nearestWall(
  home: Home,
  levelId: string | null,
  p: Pt,
  maxDistance: number,
): { id: string; offset: number; distance: number } | null {
  let best: { id: string; offset: number; distance: number } | null = null;
  for (const w of home.walls) {
    const a = w.attrs;
    if (!sameLevel(a.level, levelId) || a.arc_extent) continue;
    const start: Pt = [a.x_start, a.y_start];
    const end: Pt = [a.x_end, a.y_end];
    const distance = distanceToSegment(p, start, end);
    if (distance > Math.max(maxDistance, a.thickness / 2 + 10)) continue;
    if (best && best.distance <= distance) continue;
    const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const t =
      len === 0
        ? 0
        : ((p[0] - start[0]) * (end[0] - start[0]) + (p[1] - start[1]) * (end[1] - start[1])) / len;
    best = { id: a.id, offset: Math.max(0, Math.min(len, t)), distance };
  }
  return best;
}
