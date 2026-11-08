// Staircases cut holes in the floors above them and in the ceilings they reach through,
// like Sweet Home 3D: the piece's `staircaseCutOutShape` is an SVG path in the unit
// square, stretched over the piece's width and depth and placed like the piece.

import { forEachPiece, type Home, type Piece, type Pt } from "../model";
import type { LevelInfo } from "./buildScene";

/** Segments a curve is split into. */
const CURVE_STEPS = 12;

/** Closed outlines of an SVG path (M, L, H, V, C, S, Q, T, A, Z; absolute and relative). */
export function parseSvgPath(d: string): Pt[][] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const outlines: Pt[][] = [];
  let current: Pt[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastControl: Pt | null = null;
  let lastQuad: Pt | null = null;
  let cmd = "";
  let i = 0;
  const num = () => Number(tokens[i++]);
  const hasNumber = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);
  const close = () => {
    if (current.length > 2) outlines.push(current);
    current = [];
  };
  const lineTo = (nx: number, ny: number) => {
    x = nx;
    y = ny;
    current.push([x, y]);
  };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    const c = cmd.toUpperCase();
    if (c !== "C" && c !== "S") lastControl = null;
    if (c !== "Q" && c !== "T") lastQuad = null;
    switch (c) {
      case "M": {
        close();
        x = ox + num();
        y = oy + num();
        startX = x;
        startY = y;
        current.push([x, y]);
        // Further pairs after M are line segments
        cmd = rel ? "l" : "L";
        break;
      }
      case "L":
        lineTo(ox + num(), oy + num());
        break;
      case "H":
        lineTo(ox + num(), y);
        break;
      case "V":
        lineTo(x, oy + num());
        break;
      case "C":
      case "S": {
        const c1: Pt =
          c === "C"
            ? [ox + num(), oy + num()]
            : lastControl
              ? [2 * x - lastControl[0], 2 * y - lastControl[1]]
              : [x, y];
        const c2: Pt = [ox + num(), oy + num()];
        const end: Pt = [ox + num(), oy + num()];
        const [x0, y0] = [x, y];
        for (let k = 1; k <= CURVE_STEPS; k++) {
          const t = k / CURVE_STEPS;
          const u = 1 - t;
          lineTo(
            u * u * u * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
            u * u * u * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
          );
        }
        lastControl = c2;
        break;
      }
      case "Q":
      case "T": {
        const q: Pt =
          c === "Q"
            ? [ox + num(), oy + num()]
            : lastQuad
              ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]]
              : [x, y];
        const end: Pt = [ox + num(), oy + num()];
        const [x0, y0] = [x, y];
        for (let k = 1; k <= CURVE_STEPS; k++) {
          const t = k / CURVE_STEPS;
          const u = 1 - t;
          lineTo(
            u * u * x0 + 2 * u * t * q[0] + t * t * end[0],
            u * u * y0 + 2 * u * t * q[1] + t * t * end[1],
          );
        }
        lastQuad = q;
        break;
      }
      case "A": {
        const rx = Math.abs(num());
        const ry = Math.abs(num());
        const rotation = (num() * Math.PI) / 180;
        const large = num() !== 0;
        const sweep = num() !== 0;
        const ex = ox + num();
        const ey = oy + num();
        for (const p of arcPoints(x, y, rx, ry, rotation, large, sweep, ex, ey)) lineTo(p[0], p[1]);
        break;
      }
      case "Z":
        x = startX;
        y = startY;
        close();
        break;
      default:
        // Unknown command: skip its numbers
        while (hasNumber()) i++;
    }
  }
  close();
  return outlines;
}

/** Points along an SVG elliptical arc (endpoint parameterization, SVG spec F.6.5). */
function arcPoints(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phi: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): Pt[] {
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const factor = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const steps = Math.max(2, Math.ceil((Math.abs(delta) / (Math.PI / 2)) * CURVE_STEPS));
  const points: Pt[] = [];
  for (let k = 1; k <= steps; k++) {
    const t = start + (delta * k) / steps;
    points.push([
      cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
      cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
    ]);
  }
  return points;
}

/** Outlines of a staircase's cut-out in plan coordinates (cm). */
export function cutOutOutlines(p: Piece): Pt[][] {
  const a = p.attrs;
  if (!a.staircase_cut_out_shape) return [];
  const w = a.width;
  const d = a.depth;
  const cos = Math.cos(a.angle ?? 0);
  const sin = Math.sin(a.angle ?? 0);
  const mirrored = a.model_mirrored === true;
  return parseSvgPath(a.staircase_cut_out_shape).map((outline) =>
    outline.map(([u, v]) => {
      const lx = (mirrored ? 0.5 - u : u - 0.5) * w;
      const ly = (v - 0.5) * d;
      return [a.x + lx * cos - ly * sin, a.y + lx * sin + ly * cos] as Pt;
    }),
  );
}

/** A staircase with its vertical extent. */
export type Staircase = { outlines: Pt[][]; bottom: number; top: number };

/** All visible staircases of the home with their bottom and top elevation. */
export function staircases(home: Home, levels: Map<string | null, LevelInfo>): Staircase[] {
  const result: Staircase[] = [];
  forEachPiece(home.furniture, (p) => {
    const outlines = cutOutOutlines(p);
    if (outlines.length === 0 || p.attrs.visible === false) return;
    const base = (levels.get(p.attrs.level) ?? levels.get(null))?.elevation ?? 0;
    const bottom = base + (p.attrs.elevation ?? 0);
    result.push({ outlines, bottom, top: bottom + (p.attrs.height_in_plan ?? p.attrs.height) });
  });
  return result;
}

/** Staircases that cut a horizontal surface (floor or ceiling) at `elevation`. */
export function holesAt(stairs: Staircase[], elevation: number): Pt[][] {
  return stairs
    .filter((s) => s.bottom < elevation - 1 && s.top >= elevation - 1)
    .flatMap((s) => s.outlines);
}
