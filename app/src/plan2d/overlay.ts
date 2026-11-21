// Editing overlay of the 2D plan: selection highlight, drag handles, previews
// of moves and handle drags (with the angles at wall corners), the path being
// drawn (walls with their thickness), alignment guides, angle arcs, the typed
// length, rubber band selection and snap marker.

import type { Home, Pt, WallShape } from "../model";
import { usePreferences } from "../preferences";
import { formatLength, formatPrecise } from "../units";
import { type AutoDim, dimensionLine } from "./autoDims";
import type { ViewTransform } from "./drawPlan";
import type { DropPreview } from "./dropPreview";
import { HANDLE_SHAPE, type Handle, type HandleDrag, lengthText } from "./handles";
import { elementOutlines } from "./interaction";
import { drawMarker, markerShape, noteText } from "./markers";
import type { Gap } from "./moveSnap";
import type { Joint, MovePreview } from "./moving";
import { offsetOutline, type Segment } from "./snapping";

export type DraftKind = "wall" | "room" | "dimension" | "polyline";

export type PlanOverlay = {
  selection: string[];
  /** Offset of the selection while it is dragged (cm) */
  dragOffset: Pt | null;
  /** Replaces the moved outline of the selection (e.g. a piece docked to a wall) */
  dragGhost: Pt[] | null;
  /** Joined walls and corner angles while walls are moved */
  movePreview: MovePreview | null;
  /** Angles at the corners of the selected walls */
  selectionJoints: Joint[];
  /** Left and right sides of the selected walls (colored like in the properties panel) */
  wallSides: { left: Pt[][]; right: Pt[][]; highlight: "left" | "right" | null } | null;
  /** Points of the path being drawn, including the cursor point */
  /** `axis`: where the wall will lie when the points describe one of its sides */
  draft: { points: Pt[]; kind: DraftKind; thickness: number; axis?: Pt[] } | null;
  /** Alignment guides of the current snap */
  guides: Segment[];
  /** Explanation of a direction snap shown at the cursor (e.g. "⊥ wall") */
  note: string | null;
  /** Where the note is shown (the snapped cursor point) */
  noteAt: Pt | null;
  /** Snap points of nearby walls (ends, middle, flush points) shown while drawing */
  hints: { pt: Pt; label: string }[];
  /** Text of the length, angle or point typed on the keyboard while drawing or measuring */
  typedLength: string | null;
  /** Where the typed text is shown while measuring or drawing a ruler (null: at the draft) */
  typedAt?: Pt | null;
  /** Handles of the selected element */
  handles: Handle[];
  /** Handle being dragged: preview of the change and the cursor position */
  handleDrag: { drag: HandleDrag; cursor: Pt } | null;
  /** Rubber band rectangle (two corners in cm) */
  rubberBand: [Pt, Pt] | null;
  /** Distance measured with the measuring tool */
  measure: [Pt, Pt] | null;
  /** Pairs of points being clicked (a point and where it belongs), with the pointer */
  pointPairs?: { points: Pt[]; cursor: Pt | null; outline?: Pt[] | null } | null;
  /** Free spaces beside a door or window being slid along its wall */
  gaps: Gap[];
  /** Automatic dimensions of the selected wall or piece */
  autoDims: AutoDim[];
  /** Dimension being placed with the dimension tool (after its two points) */
  dimensionDraft: AutoDim | null;
  /** Point the cursor snapped to */
  snap: Pt | null;
  /** Virtual visitor in the plan (position in cm, yaw and field of view in radians) */
  visitor: { x: number; y: number; yaw: number; fov: number } | null;
  /** The visitor is selected: outline and the handle that turns it */
  visitorHandle: Pt | null;
  /** Key points of the camera path of the video, in their order (yaw in radians) */
  cameraPath?: { x: number; y: number; yaw: number }[] | null;
  /** Catalog piece dragged over the plan, at its size where it will land */
  dropPreview?: { preview: DropPreview; icon: HTMLImageElement | null } | null;
  /** Surface under a dragged texture or the pipette: a wall side (line) or a floor or piece */
  surfaceTarget?: { outline: Pt[]; closed: boolean } | null;
  accent: string;
  /** Color of guides */
  guide: string;
  /** Color of the measuring tool (default: the guide color) */
  measureColor?: string;
};

/** Radius around the visitor that selects it (cm). */
export const VISITOR_PICK_RADIUS = 26;

/** Position of the handle that turns the visitor: in front of its head. */
export function visitorHandlePos(v: { x: number; y: number; yaw: number }, px: number): Pt {
  const d = VISITOR_PICK_RADIUS + 18 * px;
  return [v.x - Math.sin(v.yaw) * d, v.y + Math.cos(v.yaw) * d];
}

/**
 * Pairs of points being clicked to align an object: each point with its number and an arrow
 * to where it belongs. The pointer stands in for the point that is clicked next.
 */
function drawPointPairs(
  ctx: CanvasRenderingContext2D,
  points: Pt[],
  cursor: Pt | null,
  color: string,
  px: number,
): void {
  const all = cursor ? [...points, cursor] : points;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5 * px;
  ctx.font = `600 ${12 * px}px system-ui, sans-serif`;
  for (let i = 0; i < all.length; i += 2) {
    const [x, y] = all[i];
    const to = all[i + 1];
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, 5 * px, 0, 2 * Math.PI);
    ctx.moveTo(x - 9 * px, y);
    ctx.lineTo(x + 9 * px, y);
    ctx.moveTo(x, y - 9 * px);
    ctx.lineTo(x, y + 9 * px);
    ctx.stroke();
    ctx.fillText(String(i / 2 + 1), x + 8 * px, y - 8 * px);
    if (!to) continue;
    const len = Math.hypot(to[0] - x, to[1] - y);
    if (len < 1e-6) continue;
    const ux = (to[0] - x) / len;
    const uy = (to[1] - y) / len;
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
    // Arrow head at the target
    ctx.setLineDash([]);
    const head = Math.min(10 * px, len / 2);
    ctx.beginPath();
    ctx.moveTo(to[0], to[1]);
    ctx.lineTo(to[0] - ux * head - uy * head * 0.5, to[1] - uy * head + ux * head * 0.5);
    ctx.lineTo(to[0] - ux * head + uy * head * 0.5, to[1] - uy * head - ux * head * 0.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Points clicked so far as crosses, and the outline they make with the pointer. */
function drawPointOutline(
  ctx: CanvasRenderingContext2D,
  points: Pt[],
  outline: Pt[],
  color: string,
  px: number,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * px;
  if (outline.length > 1) {
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (const [x, y] of outline.slice(1)) ctx.lineTo(x, y);
    if (outline.length > 2) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const [x, y] of points) {
    ctx.beginPath();
    ctx.arc(x, y, 4 * px, 0, 2 * Math.PI);
    ctx.moveTo(x - 8 * px, y);
    ctx.lineTo(x + 8 * px, y);
    ctx.moveTo(x, y - 8 * px);
    ctx.lineTo(x, y + 8 * px);
    ctx.stroke();
  }
  ctx.restore();
}

/** Camera path of the video: a line through the key points, each with its number. */
function drawCameraPath(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number; yaw: number }[],
  color: string,
  px: number,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2 * px;
  ctx.setLineDash([8 * px, 5 * px]);
  ctx.beginPath();
  for (const [i, p] of points.entries()) {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  const r = 9 * px;
  ctx.font = `600 ${11 * px}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  points.forEach((p, i) => {
    // A tick shows where the camera looks
    const dir = Math.atan2(Math.cos(p.yaw), -Math.sin(p.yaw));
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(dir) * r, p.y + Math.sin(dir) * r);
    ctx.lineTo(p.x + Math.cos(dir) * 2.2 * r, p.y + Math.sin(dir) * 2.2 * r);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(String(i + 1), p.x, p.y + 0.5 * px);
  });
  ctx.restore();
}

/** Body of the visitor with the field of view it sees in the 3D view. */
function drawVisitor(
  ctx: CanvasRenderingContext2D,
  v: { x: number; y: number; yaw: number; fov: number },
  color: string,
  px: number,
): void {
  const reach = Math.max(150, 60 * px);
  const dir = Math.atan2(Math.cos(v.yaw), -Math.sin(v.yaw));
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(v.x, v.y);
  ctx.arc(v.x, v.y, reach, dir - v.fov / 2, dir + v.fov / 2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * px;
  ctx.setLineDash([4 * px, 3 * px]);
  ctx.stroke();
  ctx.setLineDash([]);
  // Shoulders across the view direction and the head in front of them
  const r = 20;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(v.x, v.y, r * 0.45, r, dir, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(v.x, v.y, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * px;
  ctx.stroke();
  ctx.restore();
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  home: Home,
  wallShapes: WallShape[],
  overlay: PlanOverlay,
): void {
  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);
  const px = 1 / view.scale;
  ctx.lineJoin = "round";

  if (overlay.cameraPath?.length) drawCameraPath(ctx, overlay.cameraPath, overlay.accent, px);
  if (overlay.pointPairs) {
    const { points, cursor, outline } = overlay.pointPairs;
    if (outline) drawPointOutline(ctx, points, outline, overlay.accent, px);
    else drawPointPairs(ctx, points, cursor, overlay.accent, px);
  }
  if (overlay.visitor) drawVisitor(ctx, overlay.visitor, overlay.accent, px);
  if (overlay.visitor && overlay.visitorHandle) {
    ctx.strokeStyle = overlay.accent;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(overlay.visitor.x, overlay.visitor.y, VISITOR_PICK_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    const [hx, hy] = overlay.visitorHandle;
    drawHandleIcon(ctx, "rotate", hx, hy, overlay.accent, px, [
      overlay.visitor.x,
      overlay.visitor.y,
    ]);
  }

  // Selection outlines
  ctx.strokeStyle = overlay.accent;
  ctx.lineWidth = 2 * px;
  for (const id of overlay.selection) {
    for (const o of elementOutlines(home, wallShapes, id)) strokePath(ctx, o.pts, o.closed);
  }

  // Ghost of the dragged selection, stretched joined walls and their corner angles
  if (overlay.dragOffset) {
    const [dx, dy] = overlay.dragOffset;
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.lineWidth = 1.5 * px;
    if (overlay.dragGhost) {
      strokePath(ctx, overlay.dragGhost, true);
    } else {
      for (const id of overlay.selection) {
        for (const o of elementOutlines(home, wallShapes, id)) {
          strokePath(
            ctx,
            o.pts.map(([x, y]) => [x + dx, y + dy]),
            o.closed,
          );
        }
      }
    }
    for (const o of overlay.movePreview?.outlines ?? []) strokePath(ctx, o, true);
    ctx.setLineDash([]);
    for (const j of overlay.movePreview?.joints ?? []) drawJoint(ctx, j, overlay.accent, px);
  }

  // Left (orange) and right (teal) sides of the selected walls
  if (overlay.wallSides && !overlay.dragOffset && !overlay.handleDrag) {
    const { left, right, highlight } = overlay.wallSides;
    // Colors of the preferences; the properties panel uses the same (CSS --side-left/right)
    const { leftSideColor, rightSideColor } = usePreferences.getState();
    ctx.lineCap = "round";
    for (const [lines, color, side] of [
      [left, leftSideColor, "left"],
      [right, rightSideColor, "right"],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = (highlight === side ? 6 : 3) * px;
      ctx.globalAlpha = highlight && highlight !== side ? 0.35 : 1;
      for (const line of lines) strokePath(ctx, line, false);
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
  }

  // Angles at the corners of the selected walls (while nothing is dragged)
  if (!overlay.dragOffset && !overlay.handleDrag) {
    for (const j of overlay.selectionJoints) drawJoint(ctx, j, overlay.accent, px);
  }

  // Handles of a single selected element
  if (!overlay.dragOffset && !overlay.handleDrag) {
    const r = 4.5 * px;
    ctx.lineWidth = 1.5 * px;
    for (const h of overlay.handles) {
      const [x, y] = h.pos;
      const shape = HANDLE_SHAPE[h.kind];
      if (shape === "rotate" || shape === "elevation" || shape === "height" || shape === "resize") {
        drawHandleIcon(ctx, shape, x, y, overlay.accent, px, h.anchor);
        continue;
      }
      ctx.beginPath();
      if (shape === "circle") {
        ctx.arc(x, y, r * 1.15, 0, Math.PI * 2);
      } else if (shape === "label") {
        // Room labels: a small frame around the anchor of the text
        ctx.rect(x - r * 2.2, y - r * 1.3, r * 4.4, r * 2.6);
      } else if (shape === "diamond") {
        ctx.moveTo(x, y - r * 1.4);
        ctx.lineTo(x + r * 1.4, y);
        ctx.lineTo(x, y + r * 1.4);
        ctx.lineTo(x - r * 1.4, y);
        ctx.closePath();
      } else {
        ctx.rect(x - r, y - r, 2 * r, 2 * r);
      }
      // Label frames stay unfilled so the text remains readable
      if (shape !== "label") {
        ctx.fillStyle = h.kind === "wall-thickness" ? overlay.accent : "#ffffff";
        ctx.fill();
      }
      ctx.strokeStyle = overlay.accent;
      ctx.stroke();
    }
  }

  // Preview while a handle is dragged
  if (overlay.handleDrag) {
    const { drag, cursor } = overlay.handleDrag;
    ctx.strokeStyle = overlay.accent;
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.lineWidth = 1.5 * px;
    for (const o of drag.preview) strokePath(ctx, o.pts, o.closed);
    ctx.setLineDash([]);
    for (const j of drag.joints ?? []) drawJoint(ctx, j, overlay.accent, px);
    if (drag.text) {
      const { text, at, size } = drag.text;
      ctx.font = `${size}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = overlay.accent;
      ctx.fillText(text, at[0], at[1]);
    }
    if (drag.info) drawTag(ctx, drag.info, cursor[0] + 14 * px, cursor[1] + 22 * px, px);
  }

  // Path being drawn
  const draft = overlay.draft;
  if (draft && draft.points.length > 0) {
    const pts = draft.points;
    ctx.strokeStyle = overlay.accent;
    if (draft.kind === "wall" && pts.length >= 2) {
      // Walls with their real thickness
      const outline = offsetOutline(draft.axis ?? pts, draft.thickness / 2);
      ctx.fillStyle = withAlpha(overlay.accent, 0.25);
      ctx.beginPath();
      outline.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.lineWidth = px;
      strokePath(ctx, pts, false);
      ctx.setLineDash([]);
    } else {
      ctx.lineWidth = 1.5 * px;
      if (draft.kind === "room") {
        ctx.fillStyle = withAlpha(overlay.accent, 0.12);
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fill();
      }
      strokePath(ctx, pts, false);
    }
    ctx.fillStyle = overlay.accent;
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(x, y, 3 * px, 0, Math.PI * 2);
      ctx.fill();
    }
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      // Angle to the previous segment (or to the x axis for the first one)
      const prev = pts.length >= 3 ? pts[pts.length - 3] : null;
      drawAngle(ctx, a, b, prev, overlay.accent, px);
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const typed = overlay.typedLength;
      const text = typed ?? lengthText(length);
      drawCenteredTag(ctx, text, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a, b, px);
    }
  }

  // Snap points of nearby walls: where a click lands exactly
  if (overlay.hints.length > 0) {
    ctx.strokeStyle = overlay.guide;
    ctx.lineWidth = 1.2 * px;
    const r = 3.5 * px;
    // The shape tells the kind of point: square end, triangle middle, cross corner, ...
    for (const { pt, label } of overlay.hints) drawMarker(ctx, markerShape(label), pt[0], pt[1], r);
  }

  // Alignment guides and direction note
  if (overlay.guides.length > 0) {
    ctx.strokeStyle = overlay.guide;
    ctx.lineWidth = px;
    ctx.setLineDash([3 * px, 3 * px]);
    for (const [a, b] of overlay.guides) {
      // Extend a little beyond both ends so the alignment is easy to see
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const ex = ((b[0] - a[0]) / len) * 20 * px;
      const ey = ((b[1] - a[1]) / len) * 20 * px;
      strokePath(
        ctx,
        [
          [a[0] - ex, a[1] - ey],
          [b[0] + ex, b[1] + ey],
        ],
        false,
      );
    }
    ctx.setLineDash([]);
  }
  const cursor =
    overlay.noteAt ?? draft?.points[draft.points.length - 1] ?? overlay.handleDrag?.cursor;
  if (overlay.note && cursor)
    drawTag(ctx, noteText(overlay.note), cursor[0] + 14 * px, cursor[1] - 18 * px, px);

  if (overlay.measure)
    drawMeasure(
      ctx,
      overlay.measure[0],
      overlay.measure[1],
      overlay.measureColor ?? overlay.guide,
      px,
    );
  if (overlay.typedAt && overlay.typedLength) {
    const [x, y] = overlay.typedAt;
    drawTag(ctx, overlay.typedLength, x + 12 * px, y + 18 * px, px);
  }
  for (const [a, b, text] of overlay.gaps) drawGap(ctx, a, b, overlay.guide, px, text);
  if (overlay.dropPreview) drawDropPreview(ctx, overlay.dropPreview, overlay.accent, px);
  if (overlay.surfaceTarget && overlay.surfaceTarget.outline.length > 1) {
    const { outline, closed } = overlay.surfaceTarget;
    ctx.strokeStyle = overlay.accent;
    ctx.lineCap = "round";
    ctx.lineWidth = (closed ? 3 : 7) * px;
    if (closed) {
      ctx.fillStyle = withAlpha(overlay.accent, 0.2);
      ctx.beginPath();
      outline.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
    }
    strokePath(ctx, outline, closed);
    ctx.lineCap = "butt";
  }
  for (const d of overlay.autoDims) drawDimensionPreview(ctx, d, overlay.accent, px);
  if (overlay.dimensionDraft) {
    drawDimensionPreview(ctx, overlay.dimensionDraft, overlay.accent, px);
  }

  // Rubber band
  if (overlay.rubberBand) {
    const [[x0, y0], [x1, y1]] = overlay.rubberBand;
    // From right to left a crossing selection: dashed and green, like in CAD programs
    const crossing = x1 < x0;
    const color = crossing ? "#2e9e5b" : overlay.accent;
    ctx.fillStyle = withAlpha(color, 0.1);
    ctx.strokeStyle = color;
    ctx.lineWidth = px;
    ctx.setLineDash(crossing ? [6 * px, 4 * px] : []);
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.setLineDash([]);
  }

  // Snap marker
  const snap = overlay.snap ?? overlay.handleDrag?.drag.snap ?? null;
  if (snap) {
    const [x, y] = snap;
    ctx.strokeStyle = overlay.accent;
    ctx.lineWidth = 1.5 * px;
    const label = overlay.snap ? overlay.note : overlay.handleDrag?.drag.snapNote;
    drawMarker(ctx, markerShape(label), x, y, 6 * px);
  }
}

/**
 * A handle drawn as a small icon that says what it does: a turning arrow (rotate), an arrow
 * up from a floor line (elevation), a double arrow between two lines (height) or a diagonal
 * double arrow pointing away from the anchor corner (resize).
 */
function drawHandleIcon(
  ctx: CanvasRenderingContext2D,
  shape: "rotate" | "elevation" | "height" | "resize",
  x: number,
  y: number,
  color: string,
  px: number,
  anchor?: Pt,
) {
  const s = 7 * px;
  ctx.save();
  // White disc so the icon reads on any floor color
  ctx.beginPath();
  ctx.arc(x, y, s * 1.35, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 1.2 * px;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.lineWidth = 1.6 * px;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const head = (tx: number, ty: number, dx: number, dy: number) => {
    // Arrow head at (tx, ty) pointing along (dx, dy)
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const h = 3 * px;
    ctx.moveTo(tx - ux * h - uy * h, ty - uy * h + ux * h);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx - ux * h + uy * h, ty - uy * h - ux * h);
  };
  ctx.beginPath();
  if (shape === "rotate") {
    const r = s * 0.75;
    const a0 = -Math.PI * 0.9;
    const a1 = Math.PI * 0.45;
    ctx.arc(x, y, r, a0, a1);
    const ex = x + Math.cos(a1) * r;
    const ey = y + Math.sin(a1) * r;
    head(ex, ey, -Math.sin(a1), Math.cos(a1));
  } else if (shape === "elevation") {
    ctx.moveTo(x - s * 0.8, y + s * 0.8);
    ctx.lineTo(x + s * 0.8, y + s * 0.8);
    ctx.moveTo(x, y + s * 0.5);
    ctx.lineTo(x, y - s * 0.8);
    head(x, y - s * 0.8, 0, -1);
  } else if (shape === "height") {
    ctx.moveTo(x - s * 0.6, y - s * 0.9);
    ctx.lineTo(x + s * 0.6, y - s * 0.9);
    ctx.moveTo(x - s * 0.6, y + s * 0.9);
    ctx.lineTo(x + s * 0.6, y + s * 0.9);
    ctx.moveTo(x, y - s * 0.6);
    ctx.lineTo(x, y + s * 0.6);
    head(x, y - s * 0.6, 0, -1);
    head(x, y + s * 0.6, 0, 1);
  } else {
    // Diagonal away from the corner (the direction the piece grows)
    let dx = 1;
    let dy = 1;
    if (anchor) {
      const len = Math.hypot(x - anchor[0], y - anchor[1]) || 1;
      dx = (x - anchor[0]) / len;
      dy = (y - anchor[1]) / len;
    } else {
      dx = Math.SQRT1_2;
      dy = Math.SQRT1_2;
    }
    const l = s * 0.75;
    ctx.moveTo(x - dx * l, y - dy * l);
    ctx.lineTo(x + dx * l, y + dy * l);
    head(x + dx * l, y + dy * l, dx, dy);
    head(x - dx * l, y - dy * l, -dx, -dy);
  }
  ctx.stroke();
  ctx.restore();
}

/** A free space beside a door or window: a line with end marks and its length. */
/** A dimension with its extension lines from the measured points to the dimension line. */
function drawDimensionPreview(
  ctx: CanvasRenderingContext2D,
  d: AutoDim,
  color: string,
  px: number,
): void {
  const [a, b] = dimensionLine(d);
  ctx.strokeStyle = color;
  ctx.lineWidth = px;
  ctx.setLineDash([3 * px, 3 * px]);
  strokePath(ctx, [d.start, a], false);
  strokePath(ctx, [d.end, b], false);
  ctx.setLineDash([]);
  drawGap(ctx, a, b, color, px, formatLength(Math.hypot(b[0] - a[0], b[1] - a[1])));
}

function drawGap(
  ctx: CanvasRenderingContext2D,
  a: Pt,
  b: Pt,
  color: string,
  px: number,
  text?: string,
) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.05) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * px;
  strokePath(ctx, [a, b], false);
  const nx = -dy / len;
  const ny = dx / len;
  const m = 6 * px;
  for (const p of [a, b]) {
    strokePath(
      ctx,
      [
        [p[0] - nx * m, p[1] - ny * m],
        [p[0] + nx * m, p[1] + ny * m],
      ],
      false,
    );
  }
  drawCenteredTag(ctx, text ?? formatPrecise(len), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a, b, px);
}

/** A catalog piece being dragged: its outline, its icon inside and its size. */
function drawDropPreview(
  ctx: CanvasRenderingContext2D,
  drop: { preview: DropPreview; icon: HTMLImageElement | null },
  accent: string,
  px: number,
): void {
  const { preview: p, icon } = drop;
  ctx.save();
  ctx.fillStyle = withAlpha(accent, 0.12);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5 * px;
  ctx.setLineDash([]);
  strokePath(ctx, p.corners, true);
  ctx.fill();
  if (icon?.complete && icon.naturalWidth > 0) {
    // Fitted into the outline, keeping its proportions
    const k = Math.min(p.width / icon.naturalWidth, p.depth / icon.naturalHeight);
    const w = icon.naturalWidth * k;
    const h = icon.naturalHeight * k;
    ctx.translate(p.center[0], p.center[1]);
    ctx.rotate(p.angle);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(icon, -w / 2, -h / 2, w, h);
  }
  ctx.restore();
  drawTag(
    ctx,
    `${formatLength(p.width)} × ${formatLength(p.depth)}`,
    p.center[0] + p.width / 2 + 8 * px,
    p.center[1],
    px,
  );
}

/** Number with at most one decimal. */
function oneDecimal(v: number): string {
  return String(Math.round(v * 10) / 10);
}

/**
 * Measured distance: a line with end marks, the length, the direction (degrees,
 * clockwise from the x axis like the plan) and the horizontal and vertical parts.
 */
function drawMeasure(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, color: string, px: number) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * px;
  strokePath(ctx, [a, b], false);
  // End marks across the line (a cross while nothing is measured yet)
  const nx = len > 1e-6 ? -dy / len : 0;
  const ny = len > 1e-6 ? dx / len : 1;
  const m = 7 * px;
  for (const p of [a, b]) {
    strokePath(
      ctx,
      [
        [p[0] - nx * m, p[1] - ny * m],
        [p[0] + nx * m, p[1] + ny * m],
      ],
      false,
    );
  }
  drawMeasureTag(ctx, a, b, px, true);
}

/**
 * Tag beside the segment a→b with its length and direction (degrees, clockwise from the x axis
 * like the plan); with `parts` also its horizontal and vertical parts.
 */
export function drawMeasureTag(
  ctx: CanvasRenderingContext2D,
  a: Pt,
  b: Pt,
  px: number,
  parts = false,
): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.05) return;
  // Rounded first, so that -0.01° shows as 0°, not 360°
  const angle = (((Math.round((Math.atan2(dy, dx) * 1800) / Math.PI) / 10) % 360) + 360) % 360;
  let text = `${formatPrecise(len)} · ${oneDecimal(angle)}°`;
  if (parts && Math.abs(dx) >= 0.05 && Math.abs(dy) >= 0.05) {
    text += ` · Δx ${oneDecimal(Math.abs(dx))} · Δy ${oneDecimal(Math.abs(dy))}`;
  }
  drawCenteredTag(ctx, text, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a, b, px);
}

/** Angle mark at a wall corner: a square for 90°, otherwise an arc with the value. */
function drawJoint(ctx: CanvasRenderingContext2D, j: Joint, color: string, px: number): void {
  const right = Math.abs(j.deg - 90) < 0.05;
  ctx.strokeStyle = right ? "#2e9e5b" : color;
  ctx.lineWidth = 1.5 * px;
  const r = 14 * px;
  if (right) {
    const [ax, ay] = j.a;
    const [bx, by] = j.b;
    const s = r * 0.8;
    strokePath(
      ctx,
      [
        [j.at[0] + ax * s, j.at[1] + ay * s],
        [j.at[0] + (ax + bx) * s, j.at[1] + (ay + by) * s],
        [j.at[0] + bx * s, j.at[1] + by * s],
      ],
      false,
    );
  } else {
    arcBetween(ctx, j.at, j.a, j.b, r);
  }
  const label = `${Math.round(j.deg * 10) / 10}°`;
  const mx = j.a[0] + j.b[0];
  const my = j.a[1] + j.b[1];
  const ml = Math.hypot(mx, my) || 1;
  drawTag(ctx, label, j.at[0] + (mx / ml) * r * 2 - 10 * px, j.at[1] + (my / ml) * r * 2, px);
}

/** Arc at `at` between the unit directions `a` and `b` (the smaller angle). */
function arcBetween(ctx: CanvasRenderingContext2D, at: Pt, a: Pt, b: Pt, r: number): void {
  const a0 = Math.atan2(a[1], a[0]);
  let a1 = Math.atan2(b[1], b[0]);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  a1 = a0 + delta;
  ctx.beginPath();
  ctx.arc(at[0], at[1], r, a0, a1, delta < 0);
  ctx.stroke();
}

/**
 * Angle of the segment a→b at `a`: to the previous segment (prev→a) if there
 * is one, otherwise to the x axis. Right angles get a square mark.
 */
function drawAngle(
  ctx: CanvasRenderingContext2D,
  a: Pt,
  b: Pt,
  prev: Pt | null,
  color: string,
  px: number,
): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1) return;
  const dirB: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  let dirA: Pt = [1, 0];
  if (prev) {
    const l = Math.hypot(prev[0] - a[0], prev[1] - a[1]) || 1;
    dirA = [(prev[0] - a[0]) / l, (prev[1] - a[1]) / l];
  }
  const dot = Math.max(-1, Math.min(1, dirA[0] * dirB[0] + dirA[1] * dirB[1]));
  const deg = (Math.acos(dot) * 180) / Math.PI;
  if (!prev && (deg < 0.05 || deg > 179.95)) return;
  drawJoint(ctx, { at: a, a: dirA, b: dirB, deg }, color, px);
}

/** Text on a dark tag, left-aligned at (x, y). */
function drawTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number) {
  ctx.font = `${12 * px}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 8 * px;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(x, y - 8 * px, w, 16 * px);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x + 4 * px, y);
}

/** Tag centered next to the segment a→b, on its left side. */
function drawCenteredTag(
  ctx: CanvasRenderingContext2D,
  text: string,
  mx: number,
  my: number,
  a: Pt,
  b: Pt,
  px: number,
) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = (b[1] - a[1]) / len;
  const ny = -(b[0] - a[0]) / len;
  ctx.font = `${12 * px}px sans-serif`;
  const w = ctx.measureText(text).width + 8 * px;
  const x = mx + nx * 18 * px - w / 2;
  const y = my + ny * 18 * px;
  drawTag(ctx, text, x, y, px);
}

function strokePath(ctx: CanvasRenderingContext2D, pts: Pt[], closed: boolean): void {
  if (pts.length === 0) return;
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (closed) ctx.closePath();
  ctx.stroke();
}

function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
