// Drag handles ("indicators") of a single selected element in the 2D plan.
// Walls: both ends (length and direction), the middle of a side (thickness),
// the middle of the axis (bend into an arc) and a rotation handle beyond the end.
// Rooms and polylines: their points. Dimension lines: both ends. Furniture:
// resize (bottom-right) and rotate (top-left). Each handle turns a pointer
// position into a preview outline and the registry command that applies it.

import { forEachPiece, type Home, type Piece, type Pt, type WallShape } from "../model";
import { boundsCenter, DEFAULT_ROOM_FONT, labelCenter, roomLabelPositions } from "./drawPlan";
import { editedWallJoints, type Joint } from "./moving";
import {
  offsetOutline,
  type Segment,
  snapAngleDeg,
  snapContext,
  snapDraw,
  wallAxis,
} from "./snapping";

export type HandleKind =
  | "wall-start"
  | "wall-end"
  | "wall-thickness"
  | "wall-arc"
  | "wall-rotate"
  | "room-point"
  | "polyline-point"
  | "dimension-start"
  | "dimension-end"
  | "piece-resize"
  | "piece-rotate"
  | "room-name"
  | "room-area";

/** How a handle is drawn. */
export type HandleShape = "square" | "circle" | "diamond" | "label";

export const HANDLE_SHAPE: Record<HandleKind, HandleShape> = {
  "wall-start": "square",
  "wall-end": "square",
  "wall-thickness": "square",
  "wall-arc": "diamond",
  "wall-rotate": "circle",
  "room-point": "square",
  "polyline-point": "square",
  "dimension-start": "square",
  "dimension-end": "square",
  "piece-resize": "square",
  "piece-rotate": "circle",
  "room-name": "label",
  "room-area": "label",
};

/** Tooltip-like explanation shown while hovering a handle. */
export const HANDLE_HINT: Record<HandleKind, string> = {
  "wall-start": "Drag to move the wall start (length and angle) · Shift: 1° steps",
  "wall-end": "Drag to move the wall end (length and angle) · Shift: 1° steps",
  "wall-thickness": "Drag to change the thickness",
  "wall-arc": "Drag sideways to bend the wall into an arc · Shift: 1° steps",
  "wall-rotate": "Drag to rotate the wall around its center · Shift: 1° steps",
  "room-point": "Drag to move this corner",
  "polyline-point": "Drag to move this point",
  "dimension-start": "Drag to move the start of the dimension",
  "dimension-end": "Drag to move the end of the dimension",
  "piece-resize": "Drag to resize",
  "piece-rotate": "Drag to rotate · Shift: 1° steps",
  "room-name": "Drag to move the room name · it snaps back to the automatic position",
  "room-area": "Drag to move the area label · it snaps back to the automatic position",
};

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
  /** Alignment guides */
  guides: Segment[];
  /** Short text shown next to the cursor (length, size or angle) */
  info: string;
  /** Angles at the corners of an edited wall */
  joints?: Joint[];
  /** Text shown at its new position (room labels) */
  text?: { text: string; at: Pt; size: number };
  command: string;
  params: Record<string, unknown>;
};

/** Distance of offset handles from the element, in screen pixels. */
const HANDLE_OFFSET_PX = 22;

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

export function pieceCorners(cx: number, cy: number, w: number, d: number, angle: number): Pt[] {
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

/** Outline of a wall with the given geometry (unjoined ends), for previews. */
export function wallOutline(start: Pt, end: Pt, thickness: number, arcExtent: number | null): Pt[] {
  return offsetOutline(wallAxis(start, end, arcExtent), thickness / 2);
}

/** Middle of the wall axis (on the arc for arc walls). */
function axisMiddle(start: Pt, end: Pt, arcExtent: number | null): Pt {
  const axis = wallAxis(start, end, arcExtent);
  if (axis.length === 2) return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const chord = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const [lx, ly] = leftDir(start, end);
  const h = (chord / 2) * Math.tan((arcExtent ?? 0) / 4);
  return [(start[0] + end[0]) / 2 + lx * h, (start[1] + end[1]) / 2 + ly * h];
}

/** Unit vector to the left side of a wall going from `start` to `end`. */
function leftDir(start: Pt, end: Pt): Pt {
  const len = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1;
  return [(end[1] - start[1]) / len, -(end[0] - start[0]) / len];
}

/**
 * Handles of the element with the given ID. `cmPerPx` places handles that sit at
 * a fixed screen distance from the element.
 */
export function elementHandles(home: Home, id: string, cmPerPx: number): Handle[] {
  const wallIndex = home.walls.findIndex((w) => w.attrs.id === id);
  if (wallIndex >= 0) {
    const a = home.walls[wallIndex].attrs;
    const start: Pt = [a.x_start, a.y_start];
    const end: Pt = [a.x_end, a.y_end];
    const len = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1;
    const dir: Pt = [(end[0] - start[0]) / len, (end[1] - start[1]) / len];
    const [lx, ly] = leftDir(start, end);
    const mid = axisMiddle(start, end, a.arc_extent);
    const offset = Math.max(a.thickness / 2, 0) + HANDLE_OFFSET_PX * cmPerPx * 0.6;
    const handles: Handle[] = [
      { id, kind: "wall-start", index: 0, pos: start },
      { id, kind: "wall-end", index: 0, pos: end },
      { id, kind: "wall-arc", index: 0, pos: mid },
      { id, kind: "wall-thickness", index: 0, pos: [mid[0] + lx * offset, mid[1] + ly * offset] },
      {
        id,
        kind: "wall-rotate",
        index: 0,
        pos: [
          end[0] + dir[0] * HANDLE_OFFSET_PX * cmPerPx,
          end[1] + dir[1] * HANDLE_OFFSET_PX * cmPerPx,
        ],
      },
    ];
    return handles;
  }
  const room = home.rooms.find((r) => r.attrs.id === id);
  if (room) {
    const handles: Handle[] = room.points.map((p, index) => ({
      id,
      kind: "room-point",
      index,
      pos: [p.x, p.y],
    }));
    if (room.points.length >= 3) {
      const labels = roomLabelPositions(room);
      if (room.attrs.name) handles.push({ id, kind: "room-name", index: 0, pos: labels.name });
      if (room.attrs.area_visible) {
        handles.push({ id, kind: "room-area", index: 0, pos: labels.area });
      }
    }
    return handles;
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

export function lengthText(cm: number): string {
  return cm >= 100 ? `${(cm / 100).toFixed(2)} m` : `${cm.toFixed(0)} cm`;
}

/** Direction of a segment in degrees, clockwise from the x axis (0..360). */
export function directionDeg(a: Pt, b: Pt): number {
  const deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return Math.round((((deg % 360) + 360) % 360) * 10) / 10;
}

/**
 * Computes the change for dragging `handle` to `p`. `snapRadius` is the magnetism
 * radius in cm; `magnetism` is false while Alt is pressed; `fine` (Shift) uses 1°
 * angle steps instead of 5°.
 */
export function dragHandle(
  home: Home,
  wallShapes: WallShape[],
  levelId: string | null,
  handle: Handle,
  p: Pt,
  snapRadius: number,
  magnetism: boolean,
  fine = false,
): HandleDrag | null {
  const { id } = handle;
  const none = { snap: null, guides: [] as Segment[] };

  switch (handle.kind) {
    case "wall-start":
    case "wall-end": {
      const wall = home.walls.find((w) => w.attrs.id === id);
      if (!wall) return null;
      const a = wall.attrs;
      const isStart = handle.kind === "wall-start";
      const fixed: Pt = isStart ? [a.x_end, a.y_end] : [a.x_start, a.y_start];
      const s = magnetism
        ? snapDraw(
            p,
            fixed,
            snapContext("wall", home, wallShapes, levelId, snapRadius, {
              excludeId: id,
              thickness: a.thickness,
              anchor: fixed,
              fine,
              excludePoint: handle.pos,
              near: p,
            }),
          )
        : { pt: p, marker: null, guides: [], note: null };
      const pt = s.pt;
      const start = isStart ? pt : fixed;
      const end = isStart ? fixed : pt;
      const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (len < 1) return null;
      return {
        preview: [{ pts: wallOutline(start, end, a.thickness, a.arc_extent), closed: true }],
        snap: s.marker,
        guides: s.guides,
        info: `${lengthText(len)} · ${directionDeg(start, end)}°${s.note ? ` · ${s.note}` : ""}`,
        joints: editedWallJoints(home, id, start, end),
        command: "wall_update",
        params: isStart
          ? { id, x_start: pt[0], y_start: pt[1] }
          : { id, x_end: pt[0], y_end: pt[1] },
      };
    }
    case "wall-thickness": {
      const wall = home.walls.find((w) => w.attrs.id === id);
      if (!wall) return null;
      const a = wall.attrs;
      const start: Pt = [a.x_start, a.y_start];
      const end: Pt = [a.x_end, a.y_end];
      // Distance from the axis middle across the wall, minus the screen offset of the handle
      const mid = axisMiddle(start, end, a.arc_extent);
      const [lx, ly] = leftDir(start, end);
      const across = (q: Pt) => Math.abs((q[0] - mid[0]) * lx + (q[1] - mid[1]) * ly);
      const handleOffset = across(handle.pos) - a.thickness / 2;
      let thickness = Math.max(2 * (across(p) - handleOffset), 0.5);
      thickness = magnetism ? Math.max(Math.round(thickness), 1) : Math.round(thickness * 10) / 10;
      return {
        preview: [{ pts: wallOutline(start, end, thickness, a.arc_extent), closed: true }],
        ...none,
        info: `Thickness ${thickness} cm`,
        command: "wall_update",
        params: { id, thickness },
      };
    }
    case "wall-arc": {
      const wall = home.walls.find((w) => w.attrs.id === id);
      if (!wall) return null;
      const a = wall.attrs;
      const start: Pt = [a.x_start, a.y_start];
      const end: Pt = [a.x_end, a.y_end];
      const chord = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (chord < 1) return null;
      const [lx, ly] = leftDir(start, end);
      const mx = (start[0] + end[0]) / 2;
      const my = (start[1] + end[1]) / 2;
      // Signed sagitta towards the left side → arc extent = 4·atan(2h / chord)
      const h = (p[0] - mx) * lx + (p[1] - my) * ly;
      let deg = (4 * Math.atan((2 * h) / chord) * 180) / Math.PI;
      deg = magnetism ? snapAngleDeg(deg, fine) : Math.round(deg);
      if (Math.abs(deg) < 1) deg = 0;
      const extent = (deg * Math.PI) / 180;
      return {
        preview: [{ pts: wallOutline(start, end, a.thickness, extent || null), closed: true }],
        ...none,
        info: deg === 0 ? "Straight" : `Arc ${deg}°`,
        command: "wall_update",
        params: { id, arc_extent_deg: deg },
      };
    }
    case "wall-rotate": {
      const wall = home.walls.find((w) => w.attrs.id === id);
      if (!wall) return null;
      const a = wall.attrs;
      const half = Math.hypot(a.x_end - a.x_start, a.y_end - a.y_start) / 2;
      const c: Pt = [(a.x_start + a.x_end) / 2, (a.y_start + a.y_end) / 2];
      let deg = (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI;
      deg = magnetism ? snapAngleDeg(deg, fine) : Math.round(deg * 10) / 10;
      const r = (deg * Math.PI) / 180;
      const start: Pt = [c[0] - Math.cos(r) * half, c[1] - Math.sin(r) * half];
      const end: Pt = [c[0] + Math.cos(r) * half, c[1] + Math.sin(r) * half];
      const round = (v: number) => Math.round(v * 100) / 100;
      return {
        preview: [{ pts: wallOutline(start, end, a.thickness, a.arc_extent), closed: true }],
        ...none,
        info: `${directionDeg(start, end)}°`,
        joints: editedWallJoints(home, id, start, end),
        command: "wall_update",
        params: {
          id,
          x_start: round(start[0]),
          y_start: round(start[1]),
          x_end: round(end[0]),
          y_end: round(end[1]),
        },
      };
    }
    case "room-name":
    case "room-area": {
      const room = home.rooms.find((r) => r.attrs.id === id);
      if (!room) return null;
      const pts: Pt[] = room.points.map((q) => [q.x, q.y]);
      const bbox = boundsCenter(pts);
      const isName = handle.kind === "room-name";
      // The automatic position attracts the label again
      const auto = labelCenter(pts);
      const autoPos: Pt = isName ? [auto[0], auto[1] - 40] : auto;
      const near = Math.hypot(p[0] - autoPos[0], p[1] - autoPos[1]) < snapRadius;
      const at: Pt =
        magnetism && near ? autoPos : magnetism ? [Math.round(p[0]), Math.round(p[1])] : p;
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        area += x0 * y1 - x1 * y0;
      }
      const text = isName ? (room.attrs.name ?? "") : `${(Math.abs(area) / 20000).toFixed(2)} m²`;
      const round = (v: number) => Math.round(v * 10) / 10;
      const dx = round(at[0] - bbox[0]);
      const dy = round(at[1] - bbox[1]);
      return {
        preview: [],
        snap: magnetism && near ? autoPos : null,
        guides: [],
        info: magnetism && near ? "automatic position" : isName ? "Name" : "Area",
        text: { text, at, size: DEFAULT_ROOM_FONT },
        command: "room_update",
        // Back at the automatic position: no stored offset, so it keeps following the room
        params:
          magnetism && near
            ? { id, [isName ? "reset_name_position" : "reset_area_position"]: true }
            : isName
              ? { id, name_x_offset: dx, name_y_offset: dy }
              : { id, area_x_offset: dx, area_y_offset: dy },
      };
    }
    case "room-point": {
      const room = home.rooms.find((r) => r.attrs.id === id);
      if (!room) return null;
      const n = room.points.length;
      const prev = room.points[(handle.index + n - 1) % n];
      const s = magnetism
        ? snapDraw(
            p,
            null,
            snapContext("room", home, wallShapes, levelId, snapRadius, {
              excludePoint: handle.pos,
              near: p,
              path: room.points.filter((_, i) => i !== handle.index).map((q) => [q.x, q.y]),
            }),
          )
        : { pt: p, marker: null, guides: [], note: null };
      const points: Pt[] = room.points.map((q, i) => (i === handle.index ? s.pt : [q.x, q.y]));
      return {
        preview: [{ pts: points, closed: true }],
        snap: s.marker,
        guides: s.guides,
        info: `${lengthText(Math.hypot(s.pt[0] - prev.x, s.pt[1] - prev.y))}${s.note ? ` · ${s.note}` : ""}`,
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
      const others: Pt[] = pl.points.filter((_, i) => i !== handle.index).map((q) => [q.x, q.y]);
      const s = magnetism
        ? snapDraw(p, previous, {
            radius: snapRadius,
            points: [],
            lines: [],
            refs: others,
            directions: [],
          })
        : { pt: p, marker: null, guides: [], note: null };
      const points: Pt[] = pl.points.map((q, i) => (i === handle.index ? s.pt : [q.x, q.y]));
      return {
        preview: [{ pts: points, closed: !!pl.attrs.closed_path }],
        snap: s.marker,
        guides: s.guides,
        info: previous ? lengthText(Math.hypot(s.pt[0] - previous[0], s.pt[1] - previous[1])) : "",
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
      const s = magnetism
        ? snapDraw(
            p,
            fixed,
            snapContext("dimension", home, wallShapes, levelId, snapRadius, { near: p }),
          )
        : { pt: p, marker: null, guides: [], note: null };
      return {
        preview: [{ pts: [fixed, s.pt], closed: false }],
        snap: s.marker,
        guides: s.guides,
        info: lengthText(Math.hypot(s.pt[0] - fixed[0], s.pt[1] - fixed[1])),
        command: "dimension_update",
        params: isStart
          ? { id, x_start: s.pt[0], y_start: s.pt[1] }
          : { id, x_end: s.pt[0], y_end: s.pt[1] },
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
      if (magnetism) deg = snapAngleDeg(deg, fine) % 360;
      else deg = Math.round(deg * 10) / 10;
      angle = (deg * Math.PI) / 180;
      return {
        preview: [{ pts: pieceCorners(a.x, a.y, w, d, angle), closed: true }],
        ...none,
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
        ...none,
        info: `${w.toFixed(0)} × ${d.toFixed(0)} cm`,
        command: "furniture_update",
        params,
      };
    }
  }
}
