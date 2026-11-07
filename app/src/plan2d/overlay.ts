// Editing overlay of the 2D plan: selection highlight, drag handles, previews
// of moves and handle drags (with the angles at wall corners), the path being
// drawn (walls with their thickness), alignment guides, angle arcs, the typed
// length, rubber band selection and snap marker.

import type { Home, Pt, WallShape } from "../model";
import type { ViewTransform } from "./drawPlan";
import { HANDLE_SHAPE, type Handle, type HandleDrag, lengthText } from "./handles";
import { elementOutlines } from "./interaction";
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
  /** Points of the path being drawn, including the cursor point */
  draft: { points: Pt[]; kind: DraftKind; thickness: number } | null;
  /** Alignment guides of the current snap */
  guides: Segment[];
  /** Explanation of a direction snap shown at the cursor (e.g. "⊥ wall") */
  note: string | null;
  /** Where the note is shown (the snapped cursor point) */
  noteAt: Pt | null;
  /** Snap points of nearby walls (ends, middle, flush points) shown while drawing */
  hints: { pt: Pt; label: string }[];
  /** Length typed on the keyboard while drawing */
  typedLength: string | null;
  /** Handles of the selected element */
  handles: Handle[];
  /** Handle being dragged: preview of the change and the cursor position */
  handleDrag: { drag: HandleDrag; cursor: Pt } | null;
  /** Rubber band rectangle (two corners in cm) */
  rubberBand: [Pt, Pt] | null;
  /** Point the cursor snapped to */
  snap: Pt | null;
  accent: string;
  /** Color of guides */
  guide: string;
};

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

  // Handles of a single selected element
  if (!overlay.dragOffset && !overlay.handleDrag) {
    const r = 4.5 * px;
    ctx.lineWidth = 1.5 * px;
    for (const h of overlay.handles) {
      const [x, y] = h.pos;
      ctx.beginPath();
      const shape = HANDLE_SHAPE[h.kind];
      if (shape === "circle") {
        ctx.arc(x, y, r * 1.15, 0, Math.PI * 2);
      } else if (shape === "diamond") {
        ctx.moveTo(x, y - r * 1.4);
        ctx.lineTo(x + r * 1.4, y);
        ctx.lineTo(x, y + r * 1.4);
        ctx.lineTo(x - r * 1.4, y);
        ctx.closePath();
      } else {
        ctx.rect(x - r, y - r, 2 * r, 2 * r);
      }
      ctx.fillStyle = h.kind === "wall-thickness" ? overlay.accent : "#ffffff";
      ctx.fill();
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
    if (drag.info) drawTag(ctx, drag.info, cursor[0] + 14 * px, cursor[1] + 22 * px, px);
  }

  // Path being drawn
  const draft = overlay.draft;
  if (draft && draft.points.length > 0) {
    const pts = draft.points;
    ctx.strokeStyle = overlay.accent;
    if (draft.kind === "wall" && pts.length >= 2) {
      // Walls with their real thickness
      const outline = offsetOutline(pts, draft.thickness / 2);
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
      const text = typed !== null ? `Length: ${typed}▏cm` : lengthText(length);
      drawCenteredTag(ctx, text, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a, b, px);
    }
  }

  // Snap points of nearby walls: where a click lands exactly
  if (overlay.hints.length > 0) {
    ctx.strokeStyle = overlay.guide;
    ctx.lineWidth = 1.2 * px;
    const r = 3.5 * px;
    for (const { pt, label } of overlay.hints) {
      const [x, y] = pt;
      ctx.beginPath();
      if (label.startsWith("flush")) {
        // Flush points are drawn as crosses, wall ends and middles as circles
        ctx.moveTo(x - r, y - r);
        ctx.lineTo(x + r, y + r);
        ctx.moveTo(x - r, y + r);
        ctx.lineTo(x + r, y - r);
      } else {
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
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
    drawTag(ctx, overlay.note, cursor[0] + 14 * px, cursor[1] - 18 * px, px);

  // Rubber band
  if (overlay.rubberBand) {
    const [[x0, y0], [x1, y1]] = overlay.rubberBand;
    ctx.fillStyle = withAlpha(overlay.accent, 0.1);
    ctx.strokeStyle = overlay.accent;
    ctx.lineWidth = px;
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  }

  // Snap marker
  const snap = overlay.snap ?? overlay.handleDrag?.drag.snap ?? null;
  if (snap) {
    const [x, y] = snap;
    ctx.strokeStyle = overlay.accent;
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.arc(x, y, 6 * px, 0, Math.PI * 2);
    ctx.stroke();
  }
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
