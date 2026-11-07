// Renders the 2D plan of a home onto a canvas.
//
// World coordinates are centimeters with the y axis pointing down, exactly as
// in Sweet Home 3D. The view transform maps them to device pixels.

import {
  cssColor,
  forEachPiece,
  type Home,
  type Piece,
  type Pt,
  type TextStyle,
  type WallShape,
  wallPolygon,
} from "../model";

export type ViewTransform = { scale: number; offsetX: number; offsetY: number };

export type PlanColors = {
  background: string;
  grid: string;
  wallFill: string;
  wallStroke: string;
  roomFill: string;
  roomStroke: string;
  furnitureStroke: string;
  text: string;
  dimension: string;
};

const DEFAULT_ROOM_FONT = 24;
const DEFAULT_LABEL_FONT = 18;
const DEFAULT_DIMENSION_FONT = 18;

export type PlanInput = {
  home: Home;
  wallShapes: WallShape[];
  levelId: string | null;
  icons: Map<string, HTMLImageElement>;
};

/** Bounding box of all walls, rooms and furniture on a level. */
export function planBounds(input: PlanInput): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  const { home, wallShapes, levelId } = input;
  home.walls.forEach((w, i) => {
    if (!sameLevel(w.attrs.level, levelId)) return;
    for (const p of wallPolygon(wallShapes[i])) add(p[0], p[1]);
  });
  for (const r of home.rooms) {
    if (!sameLevel(r.attrs.level, levelId)) continue;
    for (const p of r.points) add(p.x, p.y);
  }
  forEachPiece(home.furniture, (p) => {
    if (sameLevel(p.attrs.level, levelId)) add(p.attrs.x, p.attrs.y);
  });
  for (const d of home.dimension_lines) {
    if (!sameLevel(d.attrs.level, levelId)) continue;
    const { x_start: xs, y_start: ys, x_end: xe, y_end: ye, offset } = d.attrs;
    const len = Math.hypot(xe - xs, ye - ys) || 1;
    // Offset is perpendicular to the measured segment
    const nx = (-(ye - ys) / len) * offset;
    const ny = ((xe - xs) / len) * offset;
    add(xs + nx, ys + ny);
    add(xe + nx, ye + ny);
  }
  for (const l of home.labels) {
    if (sameLevel(l.attrs.level, levelId)) add(l.attrs.x, l.attrs.y);
  }
  const c = home.compass?.attrs;
  if (c && c.visible !== false) {
    add(c.x - c.diameter / 2, c.y - c.diameter);
    add(c.x + c.diameter / 2, c.y + c.diameter / 2);
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

export function sameLevel(itemLevel: string | null, levelId: string | null): boolean {
  return levelId === null || itemLevel === levelId;
}

/** Draws the complete plan. `ctx` is expected to be in device pixels. */
export function drawPlan(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: ViewTransform,
  input: PlanInput,
  colors: PlanColors,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);

  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);
  const px = 1 / view.scale; // one device pixel in world units

  drawGrid(ctx, width, height, view, colors);

  const { home, wallShapes, levelId } = input;

  // Rooms
  for (const room of home.rooms) {
    if (!sameLevel(room.attrs.level, levelId) || room.points.length < 3) continue;
    ctx.beginPath();
    tracePath(
      ctx,
      room.points.map((p) => [p.x, p.y]),
    );
    ctx.closePath();
    ctx.fillStyle =
      room.attrs.floor_visible === false
        ? "transparent"
        : room.attrs.floor_color !== null
          ? withAlpha(cssColor(room.attrs.floor_color, colors.roomFill), 0.35)
          : colors.roomFill;
    ctx.fill();
    ctx.lineWidth = px;
    ctx.strokeStyle = colors.roomStroke;
    ctx.stroke();
  }

  // Polylines
  for (const pl of home.polylines) {
    if (!sameLevel(pl.attrs.level, levelId) || pl.points.length < 2) continue;
    ctx.beginPath();
    tracePath(
      ctx,
      pl.points.map((p) => [p.x, p.y]),
    );
    if (pl.attrs.closed_path) ctx.closePath();
    ctx.lineWidth = Math.max(pl.attrs.thickness ?? 1, px);
    ctx.strokeStyle = cssColor(pl.attrs.color, colors.text);
    ctx.setLineDash(dashPattern(pl.attrs.dash_style, ctx.lineWidth));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Furniture (below walls so that doors in walls stay readable on top)
  const pieces: Piece[] = [];
  forEachPiece(home.furniture, (p) => {
    if (sameLevel(p.attrs.level, levelId)) pieces.push(p);
  });
  // Sort by elevation like Sweet Home 3D: higher pieces are drawn on top
  pieces.sort((a, b) => (a.attrs.elevation ?? 0) - (b.attrs.elevation ?? 0));
  for (const p of pieces) {
    if (p.kind !== "DoorOrWindow") drawPiece(ctx, p, input.icons, colors, px);
  }

  // Walls
  ctx.lineJoin = "miter";
  home.walls.forEach((w, i) => {
    if (!sameLevel(w.attrs.level, levelId)) return;
    const poly = wallPolygon(wallShapes[i]);
    ctx.beginPath();
    tracePath(ctx, poly);
    ctx.closePath();
    ctx.fillStyle = colors.wallFill;
    ctx.fill();
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = colors.wallStroke;
    ctx.stroke();
  });

  // Doors and windows on top of walls
  for (const p of pieces) {
    if (p.kind === "DoorOrWindow") drawDoorOrWindow(ctx, p, input.icons, colors, px);
  }

  // Room names and areas
  for (const room of home.rooms) {
    if (!sameLevel(room.attrs.level, levelId) || room.points.length < 3) continue;
    const [cx, cy] = boundsCenter(room.points.map((p) => [p.x, p.y] as Pt));
    const nameStyle = room.text_styles?.find((t) => t.role === "nameStyle") ?? null;
    const areaStyle = room.text_styles?.find((t) => t.role === "areaStyle") ?? null;
    if (room.attrs.name) {
      drawText(
        ctx,
        room.attrs.name,
        cx + (room.attrs.name_x_offset ?? 0),
        cy + (room.attrs.name_y_offset ?? 0),
        room.attrs.name_angle ?? 0,
        nameStyle,
        DEFAULT_ROOM_FONT,
        colors.text,
      );
    }
    if (room.attrs.area_visible) {
      const area = polygonArea(room.points) / 10000;
      drawText(
        ctx,
        `${area.toFixed(2)} m²`,
        cx + (room.attrs.area_x_offset ?? 0),
        cy + (room.attrs.area_y_offset ?? 0),
        room.attrs.area_angle ?? 0,
        areaStyle,
        DEFAULT_ROOM_FONT,
        colors.text,
      );
    }
  }

  // Dimension lines
  for (const d of home.dimension_lines) {
    if (sameLevel(d.attrs.level, levelId)) drawDimension(ctx, d, colors, px);
  }

  // Labels
  for (const l of home.labels) {
    if (!sameLevel(l.attrs.level, levelId)) continue;
    l.text.split("\n").forEach((line, i, all) => {
      const size = l.text_style?.font_size ?? DEFAULT_LABEL_FONT;
      const dy = (i - (all.length - 1)) * size * 1.2;
      drawText(
        ctx,
        line,
        l.attrs.x,
        l.attrs.y + dy,
        l.attrs.angle ?? 0,
        l.text_style,
        DEFAULT_LABEL_FONT,
        cssColor(l.attrs.color, colors.text),
      );
    });
  }

  // Compass
  const compass = home.compass?.attrs;
  if (compass && compass.visible !== false) drawCompass(ctx, compass, colors, px);
}

/** Adds the points as a connected path (moveTo + lineTo) to the current path. */
function tracePath(ctx: CanvasRenderingContext2D, points: Pt[]): void {
  points.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: ViewTransform,
  colors: PlanColors,
): void {
  // Pick a grid step that is at least ~12 device pixels wide
  const steps = [10, 25, 50, 100, 250, 500, 1000];
  const step = steps.find((s) => s * view.scale >= 12) ?? 1000;
  const x0 = Math.floor(-view.offsetX / view.scale / step) * step;
  const y0 = Math.floor(-view.offsetY / view.scale / step) * step;
  const x1 = (width - view.offsetX) / view.scale;
  const y1 = (height - view.offsetY) / view.scale;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += step) {
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
  }
  for (let y = y0; y <= y1; y += step) {
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.lineWidth = 1 / view.scale;
  ctx.strokeStyle = colors.grid;
  ctx.stroke();
}

function pieceTransform(ctx: CanvasRenderingContext2D, p: Piece): void {
  ctx.translate(p.attrs.x, p.attrs.y);
  ctx.rotate(p.attrs.angle ?? 0);
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  p: Piece,
  icons: Map<string, HTMLImageElement>,
  colors: PlanColors,
  px: number,
): void {
  const { width: w, depth: d } = p.attrs;
  ctx.save();
  pieceTransform(ctx, p);
  const iconKey = p.attrs.plan_icon ?? p.attrs.icon;
  const img = iconKey ? icons.get(iconKey) : undefined;
  if (img?.complete && img.naturalWidth > 0) {
    // Keep the icon's aspect ratio inside the piece rectangle
    const ratio = img.naturalWidth / img.naturalHeight;
    let iw = w;
    let ih = w / ratio;
    if (ih > d) {
      ih = d;
      iw = d * ratio;
    }
    if (p.attrs.model_mirrored) ctx.scale(-1, 1);
    ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
    if (p.attrs.model_mirrored) ctx.scale(-1, 1);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(-w / 2, -d / 2, w, d);
  }
  ctx.lineWidth = px;
  ctx.strokeStyle = colors.furnitureStroke;
  ctx.strokeRect(-w / 2, -d / 2, w, d);
  ctx.restore();
}

function drawDoorOrWindow(
  ctx: CanvasRenderingContext2D,
  p: Piece,
  icons: Map<string, HTMLImageElement>,
  colors: PlanColors,
  px: number,
): void {
  const { width: w, depth: d } = p.attrs;
  ctx.save();
  pieceTransform(ctx, p);
  if (p.attrs.model_mirrored) ctx.scale(-1, 1);
  // Opening in the wall
  ctx.fillStyle = colors.background;
  ctx.fillRect(-w / 2, -d / 2, w, d);
  ctx.lineWidth = px;
  ctx.strokeStyle = colors.furnitureStroke;
  ctx.strokeRect(-w / 2, -d / 2, w, d);
  // Sashes: axis relative to the piece's top-left corner, opening angles in radians
  for (const s of p.sashes ?? []) {
    const ax = -w / 2 + s.x_axis * w;
    const ay = -d / 2 + s.y_axis * d;
    const r = s.width * w;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + Math.cos(s.end_angle) * r, ay + Math.sin(s.end_angle) * r);
    ctx.arc(ax, ay, r, s.end_angle, s.start_angle, s.end_angle > s.start_angle);
    ctx.stroke();
  }
  if (!p.sashes?.length) {
    const img = p.attrs.icon ? icons.get(p.attrs.icon) : undefined;
    if (img?.complete && img.naturalWidth > 0) ctx.drawImage(img, -w / 2, -d / 2, w, d);
  }
  ctx.restore();
}

function drawDimension(
  ctx: CanvasRenderingContext2D,
  dl: Home["dimension_lines"][number],
  colors: PlanColors,
  px: number,
): void {
  const { x_start: xs, y_start: ys, x_end: xe, y_end: ye, offset } = dl.attrs;
  const length = Math.hypot(xe - xs, ye - ys);
  if (length === 0) return;
  const angle = Math.atan2(ye - ys, xe - xs);
  const color = cssColor(dl.attrs.color, colors.dimension);
  ctx.save();
  ctx.translate(xs, ys);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = px;
  ctx.beginPath();
  // Extension lines
  ctx.moveTo(0, 0);
  ctx.lineTo(0, offset + Math.sign(offset || 1) * 5);
  ctx.moveTo(length, 0);
  ctx.lineTo(length, offset + Math.sign(offset || 1) * 5);
  // Dimension line with end marks
  ctx.moveTo(0, offset);
  ctx.lineTo(length, offset);
  for (const x of [0, length]) {
    ctx.moveTo(x - 5, offset + 5);
    ctx.lineTo(x + 5, offset - 5);
  }
  ctx.stroke();
  const size = dl.text_style?.font_size ?? DEFAULT_DIMENSION_FONT;
  ctx.fillStyle = color;
  ctx.font = fontOf(dl.text_style, DEFAULT_DIMENSION_FONT);
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(formatLength(length), length / 2, offset - size * 0.15);
  ctx.restore();
}

function drawCompass(
  ctx: CanvasRenderingContext2D,
  c: { x: number; y: number; diameter: number; north_direction: number | null },
  colors: PlanColors,
  px: number,
): void {
  const r = c.diameter / 2;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.north_direction ?? 0);
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = px;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.3, r * 0.5);
  ctx.lineTo(0, r * 0.3);
  ctx.lineTo(-r * 0.3, r * 0.5);
  ctx.closePath();
  ctx.fillStyle = colors.text;
  ctx.fill();
  ctx.font = `${r * 0.5}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("N", 0, -r - r * 0.1);
  ctx.restore();
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  angle: number,
  style: TextStyle | null,
  defaultSize: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = fontOf(style, defaultSize);
  ctx.fillStyle = color;
  ctx.textAlign =
    style?.alignment === "LEFT" ? "left" : style?.alignment === "RIGHT" ? "right" : "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function fontOf(style: TextStyle | null, defaultSize: number): string {
  const size = style?.font_size ?? defaultSize;
  const family = style?.font_name ? `"${style.font_name}", sans-serif` : "sans-serif";
  return `${style?.italic ? "italic " : ""}${style?.bold ? "bold " : ""}${size}px ${family}`;
}

/** Formats a length in centimeters like Sweet Home 3D's default unit. */
export function formatLength(cm: number): string {
  return cm >= 100 ? `${(cm / 100).toFixed(2)} m` : `${cm.toFixed(1)} cm`;
}

function dashPattern(style: string | null, width: number): number[] {
  switch (style) {
    case "DOT":
      return [width, width * 2];
    case "DASH":
      return [width * 4, width * 2];
    case "DASH_DOT":
      return [width * 4, width * 2, width, width * 2];
    case "DASH_DOT_DOT":
      return [width * 4, width * 2, width, width * 2, width, width * 2];
    default:
      return [];
  }
}

function boundsCenter(points: Pt[]): Pt {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function polygonArea(points: { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
