// Hit testing and snapping ("magnetism") for editing in the 2D plan.
// All coordinates are plan coordinates in cm (y down).

import {
  forEachPiece,
  type Home,
  type Piece,
  type Pt,
  type WallShape,
  wallPolygon,
} from "../model";

/** Kind of element found by a hit test. */
export type HitKind = "piece" | "wall" | "room" | "label" | "dimension" | "polyline";

export type Hit = { id: string; kind: HitKind };

function sameLevel(itemLevel: string | null, levelId: string | null): boolean {
  return levelId === null || itemLevel === levelId;
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
  // Doors and windows are drawn on top of the walls, other furniture below
  const pieces: Piece[] = [];
  forEachPiece(home.furniture, (piece) => {
    if (sameLevel(piece.attrs.level, levelId) && piece.attrs.id) pieces.push(piece);
  });
  pieces.sort((a, b) => (b.attrs.elevation ?? 0) - (a.attrs.elevation ?? 0));
  for (const piece of pieces) {
    if (piece.kind === "DoorOrWindow" && pieceContains(piece, p)) {
      return { id: piece.attrs.id as string, kind: "piece" };
    }
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
  for (const piece of pieces) {
    if (piece.kind !== "DoorOrWindow" && pieceContains(piece, p)) {
      return { id: piece.attrs.id as string, kind: "piece" };
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
    for (let i = 0; i + 1 < pl.points.length; i++) {
      const a = pl.points[i];
      const b = pl.points[i + 1];
      if (distanceToSegment(p, [a.x, a.y], [b.x, b.y]) <= tolerance)
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
  home.walls.forEach((w, i) => {
    if (w.attrs.id === id) out.push({ pts: wallPolygon(wallShapes[i]), closed: true });
  });
  for (const r of home.rooms) {
    if (r.attrs.id === id) out.push({ pts: r.points.map((p) => [p.x, p.y]), closed: true });
  }
  for (const pl of home.polylines) {
    if (pl.attrs.id === id)
      out.push({ pts: pl.points.map((p) => [p.x, p.y]), closed: !!pl.attrs.closed_path });
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
  const ids: string[] = [];
  forEachPiece(home.furniture, (p) => {
    if (sameLevel(p.attrs.level, levelId) && p.attrs.id && inside(p.attrs.x, p.attrs.y))
      ids.push(p.attrs.id);
  });
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

/** Wall end points on a level, used as snap targets. */
export function wallEndPoints(home: Home, levelId: string | null): Pt[] {
  const pts: Pt[] = [];
  for (const w of home.walls) {
    if (!sameLevel(w.attrs.level, levelId)) continue;
    pts.push([w.attrs.x_start, w.attrs.y_start], [w.attrs.x_end, w.attrs.y_end]);
  }
  return pts;
}

/** Corners of the wall sides (inner and outer outline), used as snap targets for rooms. */
export function wallSideCorners(home: Home, wallShapes: WallShape[], levelId: string | null): Pt[] {
  const pts: Pt[] = [];
  home.walls.forEach((w, i) => {
    if (!sameLevel(w.attrs.level, levelId)) return;
    const s = wallShapes[i];
    pts.push(s.left[0], s.left[s.left.length - 1], s.right[0], s.right[s.right.length - 1]);
  });
  return pts;
}

/**
 * Magnetism like Sweet Home 3D: snap to nearby points (wall ends, first point
 * of the path), otherwise keep the angle to the previous point in 15° steps and
 * round the length to whole centimeters.
 */
export function snapPoint(p: Pt, previous: Pt | null, targets: Pt[], radius: number): Pt {
  let best: Pt | null = null;
  let bestDist = radius;
  for (const t of targets) {
    const d = Math.hypot(t[0] - p[0], t[1] - p[1]);
    if (d <= bestDist) {
      best = t;
      bestDist = d;
    }
  }
  if (best) return [best[0], best[1]];
  if (!previous) return [Math.round(p[0]), Math.round(p[1])];
  const dx = p[0] - previous[0];
  const dy = p[1] - previous[1];
  const step = Math.PI / 12;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const length = Math.round(Math.hypot(dx, dy));
  return [previous[0] + Math.cos(angle) * length, previous[1] + Math.sin(angle) * length];
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
