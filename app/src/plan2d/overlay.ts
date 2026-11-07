// Editing overlay of the 2D plan: selection highlight, drag preview, the path
// being drawn, rubber band selection and snap marker.

import type { Home, Pt, WallShape } from "../model";
import type { ViewTransform } from "./drawPlan";
import { elementOutlines } from "./interaction";

export type PlanOverlay = {
  selection: string[];
  /** Offset of the selection while it is dragged (cm) */
  dragOffset: Pt | null;
  /** Points of a wall path, room or dimension being drawn, including the cursor point */
  draft: { points: Pt[]; kind: "wall" | "room" | "dimension" } | null;
  /** Rubber band rectangle (two corners in cm) */
  rubberBand: [Pt, Pt] | null;
  /** Point the cursor snapped to */
  snap: Pt | null;
  accent: string;
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

  // Ghost of the dragged selection
  if (overlay.dragOffset) {
    const [dx, dy] = overlay.dragOffset;
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.lineWidth = 1.5 * px;
    for (const id of overlay.selection) {
      for (const o of elementOutlines(home, wallShapes, id)) {
        strokePath(
          ctx,
          o.pts.map(([x, y]) => [x + dx, y + dy]),
          o.closed,
        );
      }
    }
    ctx.setLineDash([]);
  }

  // Path being drawn, with the length of the last segment
  const draft = overlay.draft;
  if (draft && draft.points.length > 0) {
    ctx.strokeStyle = overlay.accent;
    ctx.lineWidth = draft.kind === "wall" ? 2 * px : 1.5 * px;
    if (draft.kind === "room") {
      ctx.fillStyle = withAlpha(overlay.accent, 0.12);
      ctx.beginPath();
      draft.points.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
    }
    strokePath(ctx, draft.points, false);
    ctx.fillStyle = overlay.accent;
    for (const [x, y] of draft.points) {
      ctx.beginPath();
      ctx.arc(x, y, 3 * px, 0, Math.PI * 2);
      ctx.fill();
    }
    if (draft.points.length >= 2) {
      const a = draft.points[draft.points.length - 2];
      const b = draft.points[draft.points.length - 1];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const text = length >= 100 ? `${(length / 100).toFixed(2)} m` : `${length.toFixed(0)} cm`;
      ctx.font = `${12 * px}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const w = ctx.measureText(text).width + 6 * px;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(mx - w / 2, my - 18 * px, w, 15 * px);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, mx, my - 5 * px);
    }
  }

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
  if (overlay.snap) {
    const [x, y] = overlay.snap;
    ctx.strokeStyle = overlay.accent;
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.arc(x, y, 6 * px, 0, Math.PI * 2);
    ctx.stroke();
  }
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
