// Snap markers and notes: the shape of the marker tells the kind of snap point at a glance
// (like the object snap markers of CAD programs), the note names it in the chosen language.

import { t } from "../i18n";

export type MarkerShape = "square" | "triangle" | "cross" | "perpendicular" | "diamond" | "circle";

/** Marker shape for the label of a snap point (its English note). */
export function markerShape(label: string | null | undefined): MarkerShape {
  if (!label) return "circle";
  if (label.startsWith("perpendicular")) return "perpendicular";
  if (label.includes("crossing") || label.startsWith("flush") || label === "wall corner")
    return "cross";
  if (label.includes("guide line") && !label.startsWith("on ")) return "diamond";
  if (label.includes("middle")) return "triangle";
  if (
    label.includes("end") ||
    label.startsWith("corner") ||
    label === "close" ||
    label === "finish room"
  )
    return "square";
  return "circle";
}

/** Draws a marker of radius `r` (in plan units) around (x, y) with the current stroke style. */
export function drawMarker(
  ctx: CanvasRenderingContext2D,
  shape: MarkerShape,
  x: number,
  y: number,
  r: number,
): void {
  ctx.beginPath();
  switch (shape) {
    case "square":
      ctx.rect(x - r, y - r, 2 * r, 2 * r);
      break;
    case "triangle":
      ctx.moveTo(x, y - r * 1.15);
      ctx.lineTo(x + r, y + r * 0.75);
      ctx.lineTo(x - r, y + r * 0.75);
      ctx.closePath();
      break;
    case "cross":
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x - r, y + r);
      ctx.lineTo(x + r, y - r);
      break;
    case "perpendicular":
      ctx.moveTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x, y + r);
      ctx.lineTo(x, y - r);
      break;
    case "diamond":
      ctx.moveTo(x, y - r * 1.25);
      ctx.lineTo(x + r * 1.25, y);
      ctx.lineTo(x, y + r * 1.25);
      ctx.lineTo(x - r * 1.25, y);
      ctx.closePath();
      break;
    default:
      ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.stroke();
}

/** Translations of the fixed notes of the magnetism. */
const NOTES: Record<string, string> = {
  "wall end": t("wall end"),
  "wall middle": t("wall middle"),
  "wall corner": t("wall corner"),
  "flush with wall end": t("flush with wall end"),
  "flush with wall corner": t("flush with wall corner"),
  "on wall axis": t("on wall axis"),
  "on wall face": t("on wall face"),
  "on edge": t("on edge"),
  "on guide line": t("on guide line"),
  "guide line end": t("guide line end"),
  "guide line middle": t("guide line middle"),
  "guide line crossing": t("guide line crossing"),
  perpendicular: t("perpendicular"),
  close: t("close"),
  "finish room": t("finish room"),
  "1° steps": t("1° steps"),
  "1° steps to wall": t("1° steps to wall"),
  "90° to wall": t("90° to wall"),
  "in line with wall": t("in line with wall"),
  "∥ wall": t("∥ wall"),
  "⊥ wall": t("⊥ wall"),
  "middle of the free space": t("middle of the free space"),
  "edge to edge": t("edge to edge"),
  "center to center": t("center to center"),
  "in line": t("in line"),
  "equal gaps": t("equal gaps"),
  "90° to edge": t("90° to edge"),
  "in line with edge": t("in line with edge"),
  horizontal: t("horizontal"),
  vertical: t("vertical"),
};

/** Notes with a name in them. */
const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^corner of (.*)$/, (m) => t("corner of {name}", { name: m[1] })],
  [
    /^edge in line with (.*) \(other level\)$/,
    (m) => t("edge in line with {name} (other level)", { name: m[1] }),
  ],
  [/^edge in line with (.*)$/, (m) => t("edge in line with {name}", { name: m[1] })],
  [
    /^in line with (.*) \(other level\)$/,
    (m) => t("in line with {name} (other level)", { name: m[1] }),
  ],
  [/^in line with (.*)$/, (m) => t("in line with {name}", { name: m[1] })],
];

/** The note of the magnetism in the chosen language (parts separated by " · "). */
export function noteText(note: string): string {
  return note
    .split(" · ")
    .map((part) => {
      const fixed = NOTES[part];
      if (fixed) return fixed;
      for (const [re, text] of PATTERNS) {
        const m = part.match(re);
        if (m) return text(m);
      }
      return part;
    })
    .join(" · ");
}
