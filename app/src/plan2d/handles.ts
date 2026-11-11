// Drag handles ("indicators") of a single selected element in the 2D plan.
// Walls: both ends (length and direction), the middle of a side (thickness),
// the middle of the axis (bend into an arc) and a rotation handle beyond the end.
// Rooms and polylines: their points. Dimension lines: both ends. Furniture, like
// Sweet Home 3D: rotate (top-left), elevation (top-right), resize (bottom-right) and
// height (bottom-left), drawn as icons just outside the corners. Each handle turns a pointer
// position into a preview outline and the registry command that applies it.

import { t } from "../i18n";
import { forEachPiece, type Home, type Piece, type Pt, type WallShape } from "../model";
import { formatArea, formatLength, formatPrecise } from "../units";
import { boundsCenter, DEFAULT_ROOM_FONT, labelCenter, roomLabelPositions } from "./drawPlan";
import { homeGuides } from "./guides";
import { editedWallJoints, type Joint } from "./moving";
import {
  offsetOutline,
  type Segment,
  snapAngleDeg,
  snapContext,
  snapDraw,
  wallAxis,
} from "./snapping";
import { surfacesAt } from "./support";

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
  | "guide-start"
  | "guide-end"
  | "piece-resize"
  | "piece-rotate"
  | "piece-elevation"
  | "piece-height"
  | "compass-rotate"
  | "compass-resize"
  | "room-name"
  | "room-area";

/** How a handle is drawn. */
export type HandleShape =
  | "square"
  | "circle"
  | "diamond"
  | "label"
  /** Icons that show what the handle does */
  | "rotate"
  | "elevation"
  | "height"
  | "resize";

export const HANDLE_SHAPE: Record<HandleKind, HandleShape> = {
  "wall-start": "square",
  "wall-end": "square",
  "wall-thickness": "square",
  "wall-arc": "diamond",
  "wall-rotate": "rotate",
  "room-point": "square",
  "polyline-point": "square",
  "dimension-start": "square",
  "dimension-end": "square",
  "guide-start": "square",
  "guide-end": "square",
  "piece-resize": "resize",
  "piece-rotate": "rotate",
  "piece-elevation": "elevation",
  "piece-height": "height",
  "compass-rotate": "rotate",
  "compass-resize": "resize",
  "room-name": "label",
  "room-area": "label",
};

/** Tooltip-like explanation shown while hovering a handle. */
export const HANDLE_HINT: Record<HandleKind, string> = {
  "wall-start": t("Drag to move the wall start (length and angle) · Shift: 1° steps"),
  "wall-end": t("Drag to move the wall end (length and angle) · Shift: 1° steps"),
  "wall-thickness": t("Drag to change the thickness"),
  "wall-arc": t("Drag sideways to bend the wall into an arc · Shift: 1° steps"),
  "wall-rotate": t("Drag to rotate the wall around its center · Shift: 1° steps"),
  "room-point": t("Drag to move this corner"),
  "polyline-point": t("Drag to move this point"),
  "dimension-start": t("Drag to move the start of the dimension"),
  "dimension-end": t("Drag to move the end of the dimension"),
  "guide-start": t("Drag to move this end of the ruler"),
  "guide-end": t("Drag to move this end of the ruler"),
  "piece-resize": t("Drag to resize (the opposite corner stays)"),
  "piece-rotate": t("Drag to rotate · Shift: 1° steps"),
  "piece-elevation": t("Drag up or down to change the elevation above the floor"),
  "piece-height": t("Drag up or down to change the height"),
  "compass-rotate": t("Drag to turn north · 5° steps, Shift: 1° steps"),
  "compass-resize": t("Drag to change the size of the compass"),
  "room-name": t("Drag to move the room name · it snaps back to the automatic position"),
  "room-area": t("Drag to move the area label · it snaps back to the automatic position"),
};

export type Handle = {
  id: string;
  kind: HandleKind;
  /** Point index for room and polyline points */
  index: number;
  /** Position in plan coordinates (cm) */
  pos: Pt;
  /** Point of the element the handle belongs to, if the handle sits beside it */
  anchor?: Pt;
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
/** Distance of the furniture icons from the corners, in screen pixels. */
const PIECE_HANDLE_OFFSET_PX = 11;

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
  const guide = homeGuides(home).find((g) => g.id === id);
  if (guide) {
    return [
      { id, kind: "guide-start", index: 0, pos: [guide.x_start, guide.y_start] },
      { id, kind: "guide-end", index: 0, pos: [guide.x_end, guide.y_end] },
    ];
  }
  const compass = home.compass?.attrs;
  if (id === "compass" && compass) {
    const r = compass.diameter / 2;
    const nd = compass.north_direction ?? 0;
    const center: Pt = [compass.x, compass.y];
    const off = PIECE_HANDLE_OFFSET_PX * cmPerPx;
    // Beyond the tip of the north arrow, and on the ring towards the lower right
    const tip: Pt = [compass.x + Math.sin(nd) * r, compass.y - Math.cos(nd) * r];
    const ring: Pt = [compass.x + Math.SQRT1_2 * r, compass.y + Math.SQRT1_2 * r];
    return [
      {
        id,
        kind: "compass-rotate",
        index: 0,
        pos: [tip[0] + Math.sin(nd) * off * 1.6, tip[1] - Math.cos(nd) * off * 1.6],
        anchor: center,
      },
      {
        id,
        kind: "compass-resize",
        index: 0,
        pos: [ring[0] + Math.SQRT1_2 * off, ring[1] + Math.SQRT1_2 * off],
        anchor: center,
      },
    ];
  }
  const piece = findPiece(home, id);
  if (piece) {
    const a = piece.attrs;
    const w = a.width_in_plan ?? a.width;
    const d = a.depth_in_plan ?? a.depth;
    const corners = pieceCorners(a.x, a.y, w, d, a.angle ?? 0);
    // Icons just outside the corners, so they do not hide the piece
    const outside = (c: Pt): Pt => {
      const len = Math.hypot(c[0] - a.x, c[1] - a.y) || 1;
      const off = PIECE_HANDLE_OFFSET_PX * cmPerPx;
      return [c[0] + ((c[0] - a.x) / len) * off, c[1] + ((c[1] - a.y) / len) * off];
    };
    const at = (kind: HandleKind, c: Pt): Handle => ({
      id,
      kind,
      index: 0,
      pos: outside(c),
      anchor: c,
    });
    const handles: Handle[] = [at("piece-rotate", corners[0]), at("piece-elevation", corners[1])];
    if (isResizable(piece)) {
      handles.push(at("piece-resize", corners[2]), at("piece-height", corners[3]));
    }
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
  return formatLength(cm);
}

/** Direction of a segment in degrees, clockwise from the x axis (0..360). */
export function directionDeg(a: Pt, b: Pt): number {
  const deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  // Rounded before wrapping (atan2 gives -180..180), so -0.03° shows as 0 and not as 360
  const r = Math.round(deg * 10) / 10;
  return r <= 0 ? (r + 360) % 360 : r;
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
        info: t("Thickness {v0}", { v0: formatPrecise(thickness) }),
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
        info: deg === 0 ? t("Straight") : t("Arc {deg}°", { deg }),
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
      const text = isName ? (room.attrs.name ?? "") : formatArea(area / 2);
      const round = (v: number) => Math.round(v * 10) / 10;
      const dx = round(at[0] - bbox[0]);
      const dy = round(at[1] - bbox[1]);
      return {
        preview: [],
        snap: magnetism && near ? autoPos : null,
        guides: [],
        info: magnetism && near ? t("automatic position") : isName ? t("Name") : t("Area"),
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
    case "guide-start":
    case "guide-end": {
      const guide = homeGuides(home).find((g) => g.id === id);
      if (!guide) return null;
      const isStart = handle.kind === "guide-start";
      const fixed: Pt = isStart ? [guide.x_end, guide.y_end] : [guide.x_start, guide.y_start];
      const s = magnetism
        ? snapDraw(
            p,
            fixed,
            snapContext("dimension", home, wallShapes, levelId, snapRadius, { near: p }),
          )
        : { pt: p, marker: null, guides: [], note: null };
      return {
        // The ruler itself shows the change (movedGuides), so no outline
        preview: [],
        snap: s.marker,
        guides: s.guides,
        info: lengthText(Math.hypot(s.pt[0] - fixed[0], s.pt[1] - fixed[1])),
        command: "guide_update",
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
    case "compass-rotate":
    case "compass-resize": {
      const c = home.compass?.attrs;
      if (!c) return null;
      const ring = (r: number) => {
        const pts: Pt[] = [];
        for (let k = 0; k < 32; k++) {
          const a = (k / 32) * Math.PI * 2;
          pts.push([c.x + Math.cos(a) * r, c.y + Math.sin(a) * r]);
        }
        return pts;
      };
      if (handle.kind === "compass-rotate") {
        // Direction from the center to the pointer, clockwise from the top of the plan
        let deg = (Math.atan2(p[0] - c.x, -(p[1] - c.y)) * 180) / Math.PI;
        deg = ((deg % 360) + 360) % 360;
        deg = magnetism ? snapAngleDeg(deg, fine) % 360 : Math.round(deg * 10) / 10;
        const r = (deg * Math.PI) / 180;
        const len = c.diameter / 2;
        return {
          preview: [
            { pts: ring(len), closed: true },
            {
              pts: [
                [c.x, c.y],
                [c.x + Math.sin(r) * len, c.y - Math.cos(r) * len],
              ],
              closed: false,
            },
          ],
          ...none,
          info: t("North {deg}°", { deg }),
          command: "compass_update",
          params: { north_direction_deg: deg },
        };
      }
      const offset = handle.anchor
        ? Math.hypot(handle.pos[0] - c.x, handle.pos[1] - c.y) - c.diameter / 2
        : 0;
      let diameter = Math.max(10, 2 * (Math.hypot(p[0] - c.x, p[1] - c.y) - offset));
      diameter = magnetism ? Math.round(diameter) : Math.round(diameter * 10) / 10;
      return {
        preview: [{ pts: ring(diameter / 2), closed: true }],
        ...none,
        info: t("Diameter {v0}", { v0: formatPrecise(diameter) }),
        command: "compass_update",
        params: { diameter },
      };
    }
    case "piece-elevation":
    case "piece-height": {
      const piece = findPiece(home, id);
      if (!piece) return null;
      const a = piece.attrs;
      // Up on the screen raises: the vertical distance dragged, in cm of the plan
      let delta = handle.pos[1] - p[1];
      if (magnetism) delta = Math.round(delta);
      const w = a.width_in_plan ?? a.width;
      const d = a.depth_in_plan ?? a.depth;
      const outline = { pts: pieceCorners(a.x, a.y, w, d, a.angle ?? 0), closed: true };
      if (handle.kind === "piece-elevation") {
        let elevation = Math.max(0, Math.round(((a.elevation ?? 0) + delta) * 10) / 10);
        // Snaps to the tops and shelves of the furniture under the piece
        let on = "";
        if (magnetism) {
          const near = surfacesAt(home, piece, [a.x, a.y]).find(
            (s) => Math.abs(s.elevation - elevation) < 4,
          );
          if (near) {
            elevation = Math.round(near.elevation * 10) / 10;
            on = ` · ${near.label}`;
          }
        }
        return {
          preview: [outline],
          ...none,
          info: t("Elevation {v0}{on}", { v0: formatPrecise(elevation), on }),
          command: "furniture_update",
          params: { id, elevation },
        };
      }
      const height = Math.max(1, Math.round((a.height + delta) * 10) / 10);
      const params: Record<string, unknown> = { id, height };
      let info = t("Height {v0}", { v0: formatPrecise(height) });
      if (a.deformable === false) {
        // Proportional pieces grow in all directions, around their center
        const f = height / a.height;
        params.width = Math.round(a.width * f * 10) / 10;
        params.depth = Math.round(a.depth * f * 10) / 10;
        info += ` · ${formatPrecise(params.width as number)} × ${formatPrecise(params.depth as number)}`;
      }
      return { preview: [outline], ...none, info, command: "furniture_update", params };
    }
    case "piece-resize": {
      const piece = findPiece(home, id);
      if (!piece) return null;
      const a = piece.attrs;
      const angle = a.angle ?? 0;
      // The icon sits beside the corner: drag the corner itself
      const q: Pt = handle.anchor
        ? [p[0] - (handle.pos[0] - handle.anchor[0]), p[1] - (handle.pos[1] - handle.anchor[1])]
        : p;
      // Pointer in the piece's local frame, measured from the fixed top-left corner
      const local = rotate([q[0] - a.x, q[1] - a.y], -angle);
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
        info: `${formatLength(w)} × ${formatLength(d)}`,
        command: "furniture_update",
        params,
      };
    }
  }
}
