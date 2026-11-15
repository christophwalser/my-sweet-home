// Hit testing for editing in the 2D plan (magnetism is in snapping.ts).
// All coordinates are plan coordinates in cm (y down).

import {
  forEachGroup,
  forEachPiece,
  type Home,
  type Piece,
  type Pt,
  pieceAtLevel,
  piecesWithTop,
  type WallShape,
  wallAtLevel,
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
 * All elements at `p`, the one a click selects first (doors and windows on top, then texts,
 * dimensions, furniture, walls, lines and rooms); Tab steps through them.
 */
export function hitTestAll(
  home: Home,
  wallShapes: WallShape[],
  levelId: string | null,
  p: Pt,
  tolerance: number,
): Hit[] {
  const out: Hit[] = [];
  const add = (hit: Hit) => {
    if (!out.some((h) => h.id === hit.id)) out.push(hit);
  };
  // Doors and windows are drawn on top of the walls, other furniture below; a piece
  // inside a group selects the whole group. A locked base plan leaves only movable
  // furniture selectable, like Sweet Home 3D.
  const locked = home.attrs.base_plan_locked === true;
  const pieces = piecesWithTop(home.furniture).filter(
    (e) => pieceAtLevel(home, e.piece, levelId) && e.topId && !(locked && isBasePlanPiece(e.piece)),
  );
  pieces.sort((a, b) => (b.piece.attrs.elevation ?? 0) - (a.piece.attrs.elevation ?? 0));
  for (const { piece, topId } of pieces) {
    if (piece.kind === "DoorOrWindow" && pieceContains(piece, p)) {
      add({ id: topId as string, kind: "piece" });
    }
  }
  // The compass is drawn on top of the plan (part of the base plan)
  const compass = home.compass?.attrs;
  if (!locked && compass && compass.visible !== false) {
    if (Math.hypot(p[0] - compass.x, p[1] - compass.y) <= compass.diameter / 2 + tolerance) {
      add({ id: "compass", kind: "compass" });
    }
  }
  if (locked) {
    for (const { piece, topId } of pieces) {
      if (pieceContains(piece, p)) add({ id: topId as string, kind: "piece" });
    }
    return out;
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
      add({ id: label.attrs.id, kind: "label" });
    }
  }
  for (const d of home.dimension_lines) {
    if (!sameLevel(d.attrs.level, levelId) || !d.attrs.id) continue;
    const { x_start: xs, y_start: ys, x_end: xe, y_end: ye, offset } = d.attrs;
    const len = Math.hypot(xe - xs, ye - ys) || 1;
    const nx = (-(ye - ys) / len) * offset;
    const ny = ((xe - xs) / len) * offset;
    if (distanceToSegment(p, [xs + nx, ys + ny], [xe + nx, ye + ny]) <= tolerance) {
      add({ id: d.attrs.id, kind: "dimension" });
    }
  }
  for (const { piece, topId } of pieces) {
    if (piece.kind !== "DoorOrWindow" && pieceContains(piece, p)) {
      add({ id: topId as string, kind: "piece" });
    }
  }
  for (let i = home.walls.length - 1; i >= 0; i--) {
    const w = home.walls[i];
    if (!wallAtLevel(home, w, levelId)) continue;
    const poly = wallPolygon(wallShapes[i]);
    if (pointInPolygon(p, poly)) add({ id: w.attrs.id, kind: "wall" });
    // Thin walls are hard to hit: also accept clicks close to the axis
    if (
      distanceToSegment(p, [w.attrs.x_start, w.attrs.y_start], [w.attrs.x_end, w.attrs.y_end]) <=
      tolerance
    ) {
      add({ id: w.attrs.id, kind: "wall" });
    }
  }
  for (const pl of home.polylines) {
    if (!sameLevel(pl.attrs.level, levelId) || !pl.attrs.id) continue;
    const pts = polylinePath(pl.points, pl.attrs.join_style, !!pl.attrs.closed_path);
    for (let i = 0; i + 1 < pts.length; i++) {
      if (distanceToSegment(p, pts[i], pts[i + 1]) <= tolerance)
        add({ id: pl.attrs.id, kind: "polyline" });
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
      add({ id: r.attrs.id, kind: "room" });
  }
  return out;
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
  return hitTestAll(home, wallShapes, levelId, p, tolerance)[0] ?? null;
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

/**
 * IDs of the elements a rubber band selects: those lying inside it, or with `crossing` (dragged
 * from right to left) also those it touches.
 */
export function elementsInRect(
  home: Home,
  levelId: string | null,
  a: Pt,
  b: Pt,
  crossing = false,
): string[] {
  const rect = rectSelection(a, b, crossing);
  const locked = home.attrs.base_plan_locked === true;
  const ids: string[] = [];
  // Pieces and groups (a group when all its pieces are selected)
  const groups = new Map<string, boolean>();
  for (const { piece, topId } of piecesWithTop(home.furniture)) {
    if (!pieceAtLevel(home, piece, levelId) || !topId) continue;
    if (locked && isBasePlanPiece(piece)) continue;
    const pa = piece.attrs;
    const isInside = crossing ? rect.polygon(pieceOutline(piece)) : rect.point([pa.x, pa.y]);
    if (topId === pa.id) {
      if (isInside) ids.push(topId);
    } else if (crossing) {
      // Crossing one piece of a group selects the group
      groups.set(topId, (groups.get(topId) ?? false) || isInside);
    } else {
      groups.set(topId, (groups.get(topId) ?? true) && isInside);
    }
  }
  for (const [id, all] of groups) if (all) ids.push(id);
  if (locked) return ids;
  for (const w of home.walls) {
    const a2 = w.attrs;
    if (
      wallAtLevel(home, w, levelId) &&
      rect.segment([a2.x_start, a2.y_start], [a2.x_end, a2.y_end])
    ) {
      ids.push(a2.id);
    }
  }
  for (const r of home.rooms) {
    if (
      sameLevel(r.attrs.level, levelId) &&
      r.attrs.id &&
      rect.polygon(r.points.map((p) => [p.x, p.y] as Pt))
    ) {
      ids.push(r.attrs.id);
    }
  }
  for (const pl of home.polylines) {
    if (
      sameLevel(pl.attrs.level, levelId) &&
      pl.attrs.id &&
      rect.path(pl.points.map((p) => [p.x, p.y] as Pt))
    ) {
      ids.push(pl.attrs.id);
    }
  }
  for (const l of home.labels) {
    if (sameLevel(l.attrs.level, levelId) && l.attrs.id && rect.point([l.attrs.x, l.attrs.y]))
      ids.push(l.attrs.id);
  }
  for (const d of home.dimension_lines) {
    const a2 = d.attrs;
    if (
      sameLevel(a2.level, levelId) &&
      a2.id &&
      rect.segment([a2.x_start, a2.y_start], [a2.x_end, a2.y_end])
    ) {
      ids.push(a2.id);
    }
  }
  return ids;
}

/** Corners of a piece in the plan. */
function pieceOutline(piece: Piece): Pt[] {
  const a = piece.attrs;
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

/**
 * Tests of a rubber band from `a` to `b`: a window selection takes what lies completely
 * inside, a crossing selection (dragged from right to left) also what it touches.
 */
export function rectSelection(a: Pt, b: Pt, crossing: boolean) {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const point = (p: Pt) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const corners: Pt[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  /** Whether the segment p–q touches the rectangle */
  const touches = (p: Pt, q: Pt) =>
    point(p) || point(q) || corners.some((c, i) => segmentsCross(p, q, c, corners[(i + 1) % 4]));
  const segment = (p: Pt, q: Pt) => (crossing ? touches(p, q) : point(p) && point(q));
  const path = (pts: Pt[]) =>
    crossing
      ? pts.some((p, i) => (i + 1 < pts.length ? touches(p, pts[i + 1]) : point(p)))
      : pts.length > 0 && pts.every(point);
  const polygon = (pts: Pt[]) =>
    crossing
      ? pts.some((p, i) => touches(p, pts[(i + 1) % pts.length])) ||
        (pts.length >= 3 && pointInPolygon([(x0 + x1) / 2, (y0 + y1) / 2], pts))
      : pts.length > 0 && pts.every(point);
  return { point, segment, path, polygon };
}

/** Whether the segments a–b and c–d cross or touch. */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  return (
    ((d1 <= 0 && d2 >= 0) || (d1 >= 0 && d2 <= 0)) &&
    ((d3 <= 0 && d4 >= 0) || (d3 >= 0 && d4 <= 0)) &&
    !(d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0)
  );
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
    if (!wallAtLevel(home, w, levelId) || a.arc_extent) continue;
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
