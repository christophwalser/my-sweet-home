// Draws the opening of a door or window (seen from the front) or the floor hole of a
// staircase (seen from above) as a rectangle with handles. The result is Sweet Home 3D's SVG
// path in the unit square of the piece (x to the right, y downwards).

import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { Pt } from "../model";
import { parseSvgPath } from "../view3d/staircase";

type Rect = { x0: number; y0: number; x1: number; y1: number };

const FULL: Rect = { x0: 0, y0: 0, x1: 1, y1: 1 };
const round = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number) => Math.max(0, Math.min(1, v));

function rectPath(r: Rect): string {
  const [x0, y0, x1, y1] = [r.x0, r.y0, r.x1, r.y1].map(round);
  return `M${x0},${y0} L${x1},${y0} L${x1},${y1} L${x0},${y1} Z`;
}

/** Outlines of a path and their bounding rectangle. */
function parse(shape: string | null): { outlines: Pt[][]; rect: Rect; isRect: boolean } {
  if (!shape) return { outlines: [], rect: FULL, isRect: true };
  const outlines = parseSvgPath(shape);
  const pts = outlines.flat();
  if (pts.length === 0) return { outlines: [], rect: FULL, isRect: true };
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const rect = {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
  const isRect =
    outlines.length === 1 &&
    pts.every(
      (p) =>
        (Math.abs(p[0] - rect.x0) < 1e-3 || Math.abs(p[0] - rect.x1) < 1e-3) &&
        (Math.abs(p[1] - rect.y0) < 1e-3 || Math.abs(p[1] - rect.y1) < 1e-3),
    );
  return { outlines, rect, isRect };
}

type Drag = { handle: "move" | "x0y0" | "x1y0" | "x0y1" | "x1y1"; start: Pt; rect: Rect };

export default function ShapeEditor({
  mode,
  width,
  height,
  image,
  shape,
  disabled,
  onChange,
}: {
  /** "door": front view, "stairs": top view */
  mode: "door" | "stairs";
  /** Size of the drawn face in cm (width × height of a door, width × depth of a staircase) */
  width: number;
  height: number;
  /** Icon of the piece shown behind the shape */
  image: string | null;
  /** SVG path in the unit square; null = the whole size */
  shape: string | null;
  disabled?: boolean;
  /** New path, or null for the whole size */
  onChange: (shape: string | null) => void;
}) {
  const parsed = parse(shape);
  const [rect, setRect] = useState<Rect>(parsed.rect);
  const [dirty, setDirty] = useState(false);
  const drag = useRef<Drag | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the stored shape
  useEffect(() => {
    setRect(parse(shape).rect);
    setDirty(false);
  }, [shape]);

  // Drawing area keeping the proportions of the face
  const maxW = 360;
  const maxH = 240;
  const scale = Math.min(maxW / Math.max(width, 1), maxH / Math.max(height, 1));
  const w = Math.max(40, width * scale);
  const h = Math.max(40, height * scale);

  const toUnit = (e: React.PointerEvent): Pt => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return [0, 0];
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  const start = (handle: Drag["handle"]) => (e: React.PointerEvent) => {
    if (disabled) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { handle, start: toUnit(e), rect };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [ux, uy] = toUnit(e);
    const dx = ux - d.start[0];
    const dy = uy - d.start[1];
    const r = { ...d.rect };
    if (d.handle === "move") {
      const cw = r.x1 - r.x0;
      const ch = r.y1 - r.y0;
      r.x0 = Math.max(0, Math.min(1 - cw, r.x0 + dx));
      r.y0 = Math.max(0, Math.min(1 - ch, r.y0 + dy));
      r.x1 = r.x0 + cw;
      r.y1 = r.y0 + ch;
    } else {
      if (d.handle.includes("x0")) r.x0 = clamp(Math.min(r.x1 - 0.02, d.rect.x0 + dx));
      if (d.handle.includes("x1")) r.x1 = clamp(Math.max(r.x0 + 0.02, d.rect.x1 + dx));
      if (d.handle.includes("y0")) r.y0 = clamp(Math.min(r.y1 - 0.02, d.rect.y0 + dy));
      if (d.handle.includes("y1")) r.y1 = clamp(Math.max(r.y0 + 0.02, d.rect.y1 + dy));
    }
    setRect(r);
    setDirty(true);
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    if (dirty) onChange(rectPath(rect));
  };

  const cm = (u: number, size: number) => Math.round(u * size);
  const showOutline = !parsed.isRect && !dirty;
  const corners: [Drag["handle"], number, number][] = [
    ["x0y0", rect.x0, rect.y0],
    ["x1y0", rect.x1, rect.y0],
    ["x0y1", rect.x0, rect.y1],
    ["x1y1", rect.x1, rect.y1],
  ];

  return (
    <div className="shape-editor">
      <div className="shape-editor-title">
        {mode === "door"
          ? t("Opening in the wall (front view)")
          : t("Hole in the floor above (top view)")}
      </div>
      <svg
        ref={svg}
        width={w}
        height={h}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        role="img"
        aria-label={mode === "door" ? t("Opening in the wall") : t("Hole in the floor above")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <rect x={0} y={0} width={1} height={1} className="shape-editor-face" />
        {image && (
          <image
            href={image}
            x={0}
            y={0}
            width={1}
            height={1}
            preserveAspectRatio="xMidYMid meet"
            opacity={0.55}
          />
        )}
        {showOutline ? (
          parsed.outlines.map((o, i) => (
            <polygon
              // biome-ignore lint/suspicious/noArrayIndexKey: outlines have no ID
              key={i}
              points={o.map((p) => p.join(",")).join(" ")}
              className="shape-editor-shape"
            />
          ))
        ) : (
          // biome-ignore lint/a11y/noStaticElementInteractions: the handles are for the mouse; the size fields are the keyboard way
          <rect
            x={rect.x0}
            y={rect.y0}
            width={rect.x1 - rect.x0}
            height={rect.y1 - rect.y0}
            className="shape-editor-shape"
            onPointerDown={start("move")}
          />
        )}
        {!disabled &&
          corners.map(([handle, x, y]) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: handles are for the mouse
            <circle
              key={handle}
              cx={x}
              cy={y}
              r={0.025}
              className="shape-editor-handle"
              onPointerDown={start(handle)}
            />
          ))}
      </svg>
      <div className="shape-editor-info muted small">
        {showOutline
          ? t("Curved outline from the library – drag a corner to replace it with a rectangle.")
          : t("{w} × {h} cm, {left} cm from the left, {top} cm from the top", {
              w: cm(rect.x1 - rect.x0, width),
              h: cm(rect.y1 - rect.y0, height),
              left: cm(rect.x0, width),
              top: cm(rect.y0, height),
            })}
      </div>
      <button type="button" disabled={disabled} onClick={() => onChange(null)}>
        {t("Whole size")}
      </button>
    </div>
  );
}
