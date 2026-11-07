// Drag handles ("indicators") of a single selected element in the 2D plan:
// wall ends, room and polyline points, dimension line ends, and resize and
// rotation handles of furniture. Each handle turns a pointer position into a
// preview outline and the registry command that applies the change.

import { forEachPiece, type Home, type Piece, type Pt, type WallShape } from "../model";
import { sameLevel } from "./drawPlan";
import { snapPoint, wallSideCorners } from "./interaction";

export type HandleKind =
  | "wall-start"
  | "wall-end"
  | "room-point"
  | "polyline-point"
  | "dimension-start"
  | "dimension-end"
  | "piece-resize"
  | "piece-rotate";

export type Handle = {
  id: string;
  kind: HandleKind;
  /** Point index for room and polyline points */
  index: number;
  /** Position in plan coordinates (cm) */
  pos: Pt;
};

export type HandleDrag = {
  /** Outline of the element after the change */
  preview: { pts: Pt[]; closed: boolean }[];
  /** Point the cursor snapped to, if any */
  snap: Pt | null;
  /** Short text shown next to the cursor (length, size or angle) */
  info: string;
  command: string;
  params: Record<string, unknown>;
};

/** Rotation step of furniture with magnetism (degrees). */
const ROTATION_STEP_DEG = 15;

function findPiece(home: Home, id: string): Piece | null {
  let found: Piece | null = null;
  forEachPiece(home.furniture, (p) => {
    if (p.attrs.id === id) found = p;
  });
  return found;
}

/** Furniture whose plan footprint is its model box (not tilted), so it can be resized. */
function isResizable(p: Piece): boolean {
  return p.attrs.resizable !== false && !p.attrs.pitch && !p.attrs.roll;
}

function rotate([x, y]: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
}

function pieceCorners(cx: number, cy: number, w: number, d: number, angle: number): Pt[] {
  const local: Pt[] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
  return local.map((p) => {
    const [x, y] = rotate(p, angle);
    return [cx + x, cy + y];
  });
}

/** Handles of the element with the given ID. */
export function elementHandles(home: Home, id: string): Handle[] {
  const wall = home.walls.find((w) => w.attrs.id === id);
  if (wall) {
    const a = wall.attrs;
    return [
      { id, kind: "wall-start", index: 0, pos: [a.x_start, a.y_start] },
      { id, kind: "wall-end", index: 0, pos: [a.x_end, a.y_end] },
    ];
  }
  const room = home.rooms.find((r) => r.attrs.id === id);
  if (room) {
    return room.points.map((p, index) => ({ id, kind: "room-point", index, pos: [p.x, p.y] }));
  }
  const polyline = home.polylines.find((p) => p.attrs.id === id);
  if (polyline) {
    return polyline.points.map((p, index) => ({
      id,
      kind: "polyline-point",
      index,
      pos: [p.x, p.y],
    }));
  }
  const dim = home.dimension_lines.find((d) => d.attrs.id === id);
  if (dim) {
    const a = dim.attrs;
    return [
      { id, kind: "dimension-start", index: 0, pos: [a.x_start, a.y_start] },
      { id, kind: "dimension-end", index: 0, pos: [a.x_end, a.y_end] },
    ];
  }
  const piece = findPiece(home, id);
  if (piece) {
    const a = piece.attrs;
    const w = a.width_in_plan ?? a.width;
    const d = a.depth_in_plan ?? a.depth;
    const corners = pieceCorners(a.x, a.y, w, d, a.angle ?? 0);
    const handles: Handle[] = [{ id, kind: "piece-rotate", index: 0, pos: corners[0] }];
    if (isResizable(piece)) handles.push({ id, kind: "piece-resize", index: 0, pos: corners[2] });
    return handles;
  }
  return [];
}

/** Handle under the pointer, within `radius` cm. */
export function handleAt(handles: Handle[], p: Pt, radius: number): Handle | null {
  let best: Handle | null = null;
  let bestDist = radius;
  for (const h of handles) {
    const d = Math.hypot(h.pos[0] - p[0], h.pos[1] - p[1]);
    if (d <= bestDist) {
      best = h;
      bestDist = d;
    }
  }
  return best;
}

function lengthText(cm: number): string {
  return cm >= 100 ? `${(cm / 100).toFixed(2)} m` : `${cm.toFixed(0)} cm`;
}

const samePoint = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3;

/**
 * Computes the change for dragging `handle` to `p`. `snapRadius` is the magnetism
 * radius in cm; `magnetism` is false while Alt is pressed.
 */
export function dragHandle(
  home: Home,
  wallShapes: WallShape[],
  levelId: string | null,
  handle: Handle,
  p: Pt,
  snapRadius: number,
  magnetism: boolean,
): HandleDrag | null {
  const { id } = handle;
  const snapTo = (point: Pt, previous: Pt | null, targets: Pt[]): { pt: Pt; snap: Pt | null } => {
    if (!magnetism) return { pt: point, snap: null };
    const pt = snapPoint(point, previous, targets, snapRadius);
    return { pt, snap: targets.some((t) => samePoint(t, pt)) ? pt : null };
  };

  switch (handle.kind) {
    case "wall-start":
    case "wall-end": {
      const wall = home.walls.find((w) => w.attrs.id === id);
      if (!wall) return null;
      const a = wall.attrs;
      const isStart = handle.kind === "wall-start";
      const fixed: Pt = isStart ? [a.x_end, a.y_end] : [a.x_start, a.y_start];
      // Snap to the ends of other walls (not to the end being moved, nor to its own other end)
      const targets: Pt[] = [];
      for (const w of home.walls) {
        if (w.attrs.id === id || !sameLevel(w.attrs.level, levelId)) continue;
        for (const q of [
          [w.attrs.x_start, w.attrs.y_start],
          [w.attrs.x_end, w.attrs.y_end],
        ] as Pt[]) {
          if (!samePoint(q, handle.pos)) targets.push(q);
        }
      }
      const { pt, snap } = snapTo(p, fixed, targets);
      const start = isStart ? pt : fixed;
      const end = isStart ? fixed : pt;
      const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (len < 1) return null;
      const nx = (-(end[1] - start[1]) / len) * (a.thickness / 2);
      const ny = ((end[0] - start[0]) / len) * (a.thickness / 2);
      return {
        preview: [
          {
            pts: [
              [start[0] + nx, start[1] + ny],
              [end[0] + nx, end[1] + ny],
              [end[0] - nx, end[1] - ny],
              [start[0] - nx, start[1] - ny],
            ],
            closed: true,
          },
        ],
        snap,
        info: lengthText(len),
        command: "wall_update",
        params: isStart
          ? { id, x_start: pt[0], y_start: pt[1] }
          : { id, x_end: pt[0], y_end: pt[1] },
      };
    }
    case "room-point": {
      const room = home.rooms.find((r) => r.attrs.id === id);
      if (!room) return null;
      const others: Pt[] = room.points
        .filter((_, i) => i !== handle.index)
        .map((q) => [q.x, q.y] as Pt);
      const targets = [...wallSideCorners(home, wallShapes, levelId), ...others];
      const { pt, snap } = snapTo(p, null, targets);
      const points: Pt[] = room.points.map((q, i) => (i === handle.index ? pt : [q.x, q.y]));
      return {
        preview: [{ pts: points, closed: true }],
        snap,
        info: `${pt[0].toFixed(0)}, ${pt[1].toFixed(0)}`,
        command: "room_update",
        params: { id, points },
      };
    }
    case "polyline-point": {
      const pl = home.polylines.find((l) => l.attrs.id === id);
      if (!pl) return null;
      const n = pl.points.length;
      const prevIndex = handle.index > 0 ? handle.index - 1 : pl.attrs.closed_path ? n - 1 : -1;
      const previous: Pt | null =
        prevIndex >= 0 && prevIndex !== handle.index
          ? [pl.points[prevIndex].x, pl.points[prevIndex].y]
          : null;
      const { pt, snap } = snapTo(p, previous, []);
      const points: Pt[] = pl.points.map((q, i) => (i === handle.index ? pt : [q.x, q.y]));
      return {
        preview: [{ pts: points, closed: !!pl.attrs.closed_path }],
        snap,
        info: previous ? lengthText(Math.hypot(pt[0] - previous[0], pt[1] - previous[1])) : "",
        command: "polyline_update",
        params: { id, points },
      };
    }
    case "dimension-start":
    case "dimension-end": {
      const dim = home.dimension_lines.find((d) => d.attrs.id === id);
      if (!dim) return null;
      const a = dim.attrs;
      const isStart = handle.kind === "dimension-start";
      const fixed: Pt = isStart ? [a.x_end, a.y_end] : [a.x_start, a.y_start];
      const targets: Pt[] = [];
      for (const w of home.walls) {
        if (!sameLevel(w.attrs.level, levelId)) continue;
        targets.push([w.attrs.x_start, w.attrs.y_start], [w.attrs.x_end, w.attrs.y_end]);
      }
      targets.push(...wallSideCorners(home, wallShapes, levelId));
      const { pt, snap } = snapTo(p, fixed, targets);
      return {
        preview: [{ pts: [fixed, pt], closed: false }],
        snap,
        info: lengthText(Math.hypot(pt[0] - fixed[0], pt[1] - fixed[1])),
        command: "dimension_update",
        params: isStart
          ? { id, x_start: pt[0], y_start: pt[1] }
          : { id, x_end: pt[0], y_end: pt[1] },
      };
    }
    case "piece-rotate": {
      const piece = findPiece(home, id);
      if (!piece) return null;
      const a = piece.attrs;
      const w = a.width_in_plan ?? a.width;
      const d = a.depth_in_plan ?? a.depth;
      // The handle sits on the top-left corner: angle of the pointer minus angle of that corner
      let angle = Math.atan2(p[1] - a.y, p[0] - a.x) - Math.atan2(-d / 2, -w / 2);
      let deg = ((((angle * 180) / Math.PI) % 360) + 360) % 360;
      if (magnetism) deg = (Math.round(deg / ROTATION_STEP_DEG) * ROTATION_STEP_DEG) % 360;
      else deg = Math.round(deg * 10) / 10;
      angle = (deg * Math.PI) / 180;
      return {
        preview: [{ pts: pieceCorners(a.x, a.y, w, d, angle), closed: true }],
        snap: null,
        info: `${deg}°`,
        command: "furniture_update",
        params: { id, angle_deg: deg },
      };
    }
    case "piece-resize": {
      const piece = findPiece(home, id);
      if (!piece) return null;
      const a = piece.attrs;
      const angle = a.angle ?? 0;
      // Pointer in the piece's local frame, measured from the fixed top-left corner
      const local = rotate([p[0] - a.x, p[1] - a.y], -angle);
      let w = local[0] + a.width / 2;
      let d = local[1] + a.depth / 2;
      let h = a.height;
      if (a.deformable === false) {
        const f = Math.max(w / a.width, d / a.depth, 0.01);
        w = a.width * f;
        d = a.depth * f;
        h = a.height * f;
      }
      if (magnetism) {
        w = Math.round(w);
        d = Math.round(d);
        h = Math.round(h);
      }
      w = Math.max(w, 1);
      d = Math.max(d, 1);
      // The top-left corner stays in place
      const [ox, oy] = rotate([(w - a.width) / 2, (d - a.depth) / 2], angle);
      const cx = a.x + ox;
      const cy = a.y + oy;
      const params: Record<string, unknown> = { id, x: cx, y: cy, width: w, depth: d };
      if (a.deformable === false) params.height = h;
      return {
        preview: [{ pts: pieceCorners(cx, cy, w, d, angle), closed: true }],
        snap: null,
        info: `${w.toFixed(0)} × ${d.toFixed(0)} cm`,
        command: "furniture_update",
        params,
      };
    }
  }
}
