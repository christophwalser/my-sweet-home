// Rulers along the top and left edge of the plan, like Sweet Home 3D's: marks in the unit of the preferences
// that follow zoom and scrolling, and a mark at the mouse position.

import { usePreferences } from "../preferences";
import { rulerLabel, rulerSteps } from "../units";
import type { ViewTransform } from "./drawPlan";

export type RulerColors = { background: string; text: string; tick: string; marker: string };

/**
 * Draws one ruler. `canvas` is resized to its CSS size; `horizontal` rulers measure x,
 * vertical ones y. `mouse` is the world coordinate of the mouse along the ruler, or null.
 */
export function drawRuler(
  canvas: HTMLCanvasElement,
  horizontal: boolean,
  view: ViewTransform,
  mouse: number | null,
  colors: RulerColors,
): void {
  const dpr = devicePixelRatio;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, w, h);

  const length = horizontal ? w : h;
  const depth = horizontal ? h : w;
  const offset = horizontal ? view.offsetX : view.offsetY;
  const toPx = (cm: number) => cm * view.scale + offset;
  // Distances between labeled marks in the unit of the preferences: the first one at least
  // ~70 CSS pixels apart wins
  const unit = usePreferences.getState().unit;
  const steps = rulerSteps(unit);
  const step = steps.find((s) => s * view.scale >= 70 * dpr) ?? steps[steps.length - 1];
  // Minor marks: tenths (inches of a foot) if they stay 5 px apart, otherwise halves
  const parts = unit === "inch" ? (Math.round(step / 2.54) % 12 === 0 ? 12 : 2) : 10;
  const minor = (step / parts) * view.scale >= 5 * dpr ? step / parts : step / 2;
  const first = Math.floor(-offset / view.scale / minor) * minor;
  const last = (length - offset) / view.scale;

  ctx.strokeStyle = colors.tick;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let cm = first; cm <= last; cm += minor) {
    const p = Math.round(toPx(cm)) + 0.5;
    const ratio = Math.round(cm / minor) % Math.round(step / minor);
    const major = ratio === 0;
    const half = !major && Math.round(step / minor) === parts && ratio * 2 === parts;
    const tick = depth * (major ? 0.6 : half ? 0.4 : 0.22);
    if (horizontal) {
      ctx.moveTo(p, h);
      ctx.lineTo(p, h - tick);
    } else {
      ctx.moveTo(w, p);
      ctx.lineTo(w - tick, p);
    }
  }
  // Edge towards the plan
  if (horizontal) {
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
  } else {
    ctx.moveTo(w - 0.5, 0);
    ctx.lineTo(w - 0.5, h);
  }
  ctx.stroke();

  ctx.fillStyle = colors.text;
  ctx.font = `${10 * dpr}px sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const firstMajor = Math.floor(-offset / view.scale / step) * step;
  for (let cm = firstMajor; cm <= last; cm += step) {
    const p = Math.round(toPx(cm));
    const text = rulerLabel(cm, unit);
    if (horizontal) {
      ctx.fillText(text, p + 3 * dpr, 2 * dpr);
    } else {
      // Vertical labels read from bottom to top
      ctx.save();
      ctx.translate(2 * dpr, p - 3 * dpr);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }

  if (mouse !== null) {
    const p = Math.round(toPx(mouse)) + 0.5;
    ctx.strokeStyle = colors.marker;
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(p, 0);
      ctx.lineTo(p, h);
    } else {
      ctx.moveTo(0, p);
      ctx.lineTo(w, p);
    }
    ctx.stroke();
  }
}
