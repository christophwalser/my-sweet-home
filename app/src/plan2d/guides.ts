// Ruler guides: help lines in the plan, kept in the home property `mySweetHome.guides`
// (written by the core commands guide_add / guide_clear, moved and deleted with edit_move and
// edit_delete). Drawn only on screen, never printed or exported.

import type { Home, Pt } from "../model";
import { type Guide, levelGuides } from "./guideData";
import { rectSelection } from "./interaction";
import { drawMeasureTag } from "./overlay";

export { GUIDES_PROPERTY, type Guide, homeGuides, levelGuides } from "./guideData";

/** Dash pattern of a guide in screen pixels. */
export function guideDash(style: string | undefined): number[] {
  switch (style) {
    case "SOLID":
      return [];
    case "DOT":
      return [1.5, 4];
    case "DASH_DOT":
      return [8, 4, 1.5, 4];
    case "DASH_DOT_DOT":
      return [8, 4, 1.5, 4, 1.5, 4];
    default:
      return [8, 5];
  }
}

/** Length of a guide in cm. */
export function guideLength(g: Guide): number {
  return Math.hypot(g.x_end - g.x_start, g.y_end - g.y_start);
}

/**
 * Direction of a guide in degrees from 0 to 360, clockwise from the x axis like the plan (as
 * the measuring tool shows it), rounded to 0.1°.
 */
export function guideAngle(g: Guide): number {
  const deg = (Math.atan2(g.y_end - g.y_start, g.x_end - g.x_start) * 180) / Math.PI;
  // Rounded first, so that -0.01° shows as 0°, not 360°
  return (((Math.round(deg * 10) / 10) % 360) + 360) % 360;
}

/** End point of a guide that keeps its start and gets the given length and direction. */
export function guideEnd(g: Guide, length: number, angleDeg: number): Pt {
  const a = (angleDeg * Math.PI) / 180;
  const r = (v: number) => Math.round(v * 100) / 100;
  return [r(g.x_start + length * Math.cos(a)), r(g.y_start + length * Math.sin(a))];
}

/** Distance from `p` to the guide line. */
export function guideDistance(g: Guide, p: Pt): number {
  const ax = g.x_start;
  const ay = g.y_start;
  const dx = g.x_end - ax;
  const dy = g.y_end - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
  return Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
}

/** The guide under `p` within `tolerance` cm, nearest first. */
export function guideAt(home: Home, level: string | null, p: Pt, tolerance: number): Guide | null {
  let best: Guide | null = null;
  let bestD = tolerance;
  for (const g of levelGuides(home, level)) {
    const d = guideDistance(g, p);
    if (d <= bestD) {
      best = g;
      bestD = d;
    }
  }
  return best;
}

/** Guides lying completely inside the rectangle from `a` to `b`. */
export function guidesInRect(
  home: Home,
  level: string | null,
  a: Pt,
  b: Pt,
  crossing = false,
): Guide[] {
  const rect = rectSelection(a, b, crossing);
  return levelGuides(home, level).filter((g) =>
    rect.segment([g.x_start, g.y_start], [g.x_end, g.y_end]),
  );
}

/**
 * The guides as shown while the selection is moved by `offset` (the selected ones move) and
 * while an end is dragged (`edit`: the parameters of the pending guide_update).
 */
export function movedGuides(
  guides: Guide[],
  selection: string[],
  offset: Pt,
  edit: Record<string, unknown> | null,
): Guide[] {
  const [dx, dy] = offset;
  return guides.map((g) => {
    let out = g;
    if ((dx !== 0 || dy !== 0) && selection.includes(g.id)) {
      out = {
        ...g,
        x_start: g.x_start + dx,
        y_start: g.y_start + dy,
        x_end: g.x_end + dx,
        y_end: g.y_end + dy,
      };
    }
    if (edit && edit.id === g.id) {
      const num = (k: keyof Guide) => (typeof edit[k] === "number" ? (edit[k] as number) : null);
      out = {
        ...out,
        x_start: num("x_start") ?? out.x_start,
        y_start: num("y_start") ?? out.y_start,
        x_end: num("x_end") ?? out.x_end,
        y_end: num("y_end") ?? out.y_end,
      };
    }
    return out;
  });
}

/**
 * Draws the guides of the plan: thin lines with short end marks in their own color and dash
 * style (else `color` and `dashStyle`), in the accent color when selected. `px` is one screen
 * pixel in plan units.
 */
export function drawGuides(
  ctx: CanvasRenderingContext2D,
  guides: Guide[],
  selection: string[],
  color: string,
  accent: string,
  px: number,
  dashStyle = "DASH",
): void {
  ctx.save();
  ctx.lineCap = "round";
  for (const g of guides) {
    const selected = selection.includes(g.id);
    ctx.strokeStyle = selected ? accent : (g.color ?? color);
    ctx.lineWidth = (selected ? 2 : 1.25) * px;
    ctx.setLineDash(guideDash(g.dash_style ?? dashStyle).map((v) => v * px));
    ctx.beginPath();
    ctx.moveTo(g.x_start, g.y_start);
    ctx.lineTo(g.x_end, g.y_end);
    ctx.stroke();
    // End marks across the line
    ctx.setLineDash([]);
    const len = Math.hypot(g.x_end - g.x_start, g.y_end - g.y_start) || 1;
    const nx = (-(g.y_end - g.y_start) / len) * 6 * px;
    const ny = ((g.x_end - g.x_start) / len) * 6 * px;
    ctx.beginPath();
    for (const [x, y] of [
      [g.x_start, g.y_start],
      [g.x_end, g.y_end],
    ]) {
      ctx.moveTo(x - nx, y - ny);
      ctx.lineTo(x + nx, y + ny);
    }
    ctx.stroke();
  }
  // Length and direction of every guide, also of the one being drawn
  for (const g of guides) {
    drawMeasureTag(ctx, [g.x_start, g.y_start], [g.x_end, g.y_end], px);
  }
  ctx.restore();
}
