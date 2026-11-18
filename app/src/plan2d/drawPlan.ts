// Renders the 2D plan of a home onto a canvas.
//
// World coordinates are centimeters with the y axis pointing down, exactly as
// in Sweet Home 3D. The view transform maps them to device pixels.

import {
  type BackgroundImage,
  backgroundScale,
  cssColor,
  forEachPiece,
  type Home,
  isReference,
  type Piece,
  type Pt,
  pieceAtLevel,
  pieceIsBackdrop,
  type Room,
  type TextStyle,
  type Texture,
  type WallShape,
  wallAtLevel,
  wallPolygon,
} from "../model";
import { type Underlay, usePreferences } from "../preferences";
import { formatArea, formatLength as formatUnitLength } from "../units";
import { baseboardOf, baseboardPolygon } from "../view3d/wallSides";
import { curveSegments, polylinePath } from "./curve";
import { distanceToSegment, pointInPolygon } from "./interaction";

export type ViewTransform = { scale: number; offsetX: number; offsetY: number };

export type PlanColors = {
  background: string;
  grid: string;
  /** Fill of walls with the "foreground" pattern; hatch lines use `wallStroke`. */
  wallFill: string;
  wallStroke: string;
  /** Room floor without color or texture (drawn with ROOM_ALPHA like Sweet Home 3D). */
  roomFill: string;
  roomStroke: string;
  furnitureStroke: string;
  text: string;
  dimension: string;
};

export const DEFAULT_ROOM_FONT = 24;
/** Default vertical offset of room names in cm (DTD default of `nameYOffset`). */
const DEFAULT_ROOM_NAME_Y_OFFSET = -40;
/** Opacity of room floors in the plan, as in Sweet Home 3D. */
const ROOM_ALPHA = 0.75;
/** Opacity of reference objects and pieces reaching up from a lower level in the plan. */
const BACKDROP_ALPHA = 0.35;
/** Wall pattern used when a wall has none (Sweet Home 3D's default preference). */
const DEFAULT_WALL_PATTERN = "hatchUp";
const DEFAULT_LABEL_FONT = 18;
const DEFAULT_DIMENSION_FONT = 18;
const DEFAULT_PIECE_FONT = 18;

export type PlanInput = {
  home: Home;
  wallShapes: WallShape[];
  levelId: string | null;
  icons: Map<string, HTMLImageElement>;
  /** View of a piece from above (rendered from its model), or null to draw its icon */
  topView?: (p: Piece) => CanvasImageSource | null;
};

/**
 * Area to fit the plan of a level to: the building, that is its walls. Without walls, all rooms,
 * lines, furniture, dimensions and texts; reference objects (terrain, scans) count only when there
 * is nothing else. Terrain, parcel lines and the like around the house never widen it.
 */
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
    if (!wallAtLevel(home, w, levelId)) return;
    for (const p of wallPolygon(wallShapes[i])) add(p[0], p[1]);
  });
  if (Number.isFinite(minX)) return [minX, minY, maxX, maxY];
  for (const r of home.rooms) {
    if (!sameLevel(r.attrs.level, levelId)) continue;
    for (const p of r.points) add(p.x, p.y);
  }
  for (const pl of home.polylines) {
    if (!sameLevel(pl.attrs.level, levelId)) continue;
    for (const p of pl.points) add(p.x, p.y);
  }
  const references: Piece[] = [];
  forEachPiece(home.furniture, (p) => {
    if (!pieceAtLevel(home, p, levelId)) return;
    if (isReference(p)) references.push(p);
    else add(p.attrs.x, p.attrs.y);
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
  const hasElements = Number.isFinite(minX);
  const c = home.compass?.attrs;
  if (c && c.visible !== false) {
    add(c.x - c.diameter / 2, c.y - c.diameter);
    add(c.x + c.diameter / 2, c.y + c.diameter / 2);
  }
  // A level that only has its background image yet fits to the image
  const bg = backgroundImageOf(home, levelId);
  const bb = bg && bg.visible !== false ? backgroundBounds(bg, input.icons.get(bg.image)) : null;
  if (bb && !hasElements) {
    add(bb[0], bb[1]);
    add(bb[2], bb[3]);
  }
  // Only terrain or scans yet: fit to them
  if (!hasElements && !bb) for (const p of references) add(p.attrs.x, p.attrs.y);
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

/** Background image shown with the plan of a level (the home's own one without levels). */
export function backgroundImageOf(home: Home, levelId: string | null): BackgroundImage | null {
  if (home.levels.length === 0) return home.background_image ?? null;
  return home.levels.find((l) => l.attrs.id === levelId)?.background_image ?? null;
}

/** Extent of a background image in the plan (cm), if its size is known. */
export function backgroundBounds(
  b: BackgroundImage,
  img: HTMLImageElement | undefined,
): [number, number, number, number] | null {
  if (!img?.naturalWidth) return null;
  const s = backgroundScale(b);
  const x0 = -(b.x_origin ?? 0);
  const y0 = -(b.y_origin ?? 0);
  return [x0, y0, x0 + img.naturalWidth * s, y0 + img.naturalHeight * s];
}

/**
 * The level next to `levelId`: directly below it (lower elevation, or same elevation and
 * lower index) or directly above it.
 */
function neighborLevel(home: Home, levelId: string | null, above: boolean): string | null {
  const current = home.levels.find((l) => l.attrs.id === levelId);
  if (!current) return null;
  const key = (l: { attrs: { elevation: number; elevation_index: number | null } }) =>
    l.attrs.elevation * 1000 + (l.attrs.elevation_index ?? 0);
  const sign = above ? -1 : 1;
  let best: { id: string; k: number } | null = null;
  for (const l of home.levels) {
    const k = key(l) * sign;
    if (k < key(current) * sign && (!best || k > best.k)) best = { id: l.attrs.id, k };
  }
  return best?.id ?? null;
}

/** The level directly below `levelId` (lower elevation, or same elevation and lower index). */
export function levelBelow(home: Home, levelId: string | null): string | null {
  return neighborLevel(home, levelId, false);
}

/** The level directly above `levelId`. */
export function levelAbove(home: Home, levelId: string | null): string | null {
  return neighborLevel(home, levelId, true);
}

/**
 * The level shown faded under the plan of `levelId` and offered to the magnetism: the one
 * below, the one above or none, as chosen in the status bar.
 */
export function underlayLevel(
  home: Home,
  levelId: string | null,
  mode: Underlay = usePreferences.getState().underlay,
): string | null {
  if (mode === "off") return null;
  return neighborLevel(home, levelId, mode === "above");
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
  options: { grid?: boolean } = {},
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);

  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);
  const px = 1 / view.scale; // one device pixel in world units

  // The grid shows faintly through the background image
  if (options.grid !== false) drawGrid(ctx, width, height, view, colors);

  const { home, wallShapes, levelId } = input;

  // Pieces sorted by elevation like Sweet Home 3D: higher pieces are drawn on top
  const pieces: Piece[] = [];
  forEachPiece(home.furniture, (p) => {
    if (pieceAtLevel(home, p, levelId)) pieces.push(p);
  });
  pieces.sort((a, b) => (a.attrs.elevation ?? 0) - (b.attrs.elevation ?? 0));
  // Backdrops (reference objects such as terrain and scans, pieces reaching up from a lower
  // level) lie faint at the bottom, under the background image: that is mostly the plan of the
  // building and stays readable on top of the terrain
  const backdrop = new Set(pieces.filter((p) => pieceIsBackdrop(home, p, levelId)));
  ctx.save();
  ctx.globalAlpha = BACKDROP_ALPHA;
  for (const p of backdrop) {
    if (p.kind !== "DoorOrWindow") drawPiece(ctx, p, input, colors, px);
  }
  ctx.restore();

  // Background image under the plan, at 70 % opacity like Sweet Home 3D; opaque over backdrops,
  // so that the terrain does not tint the plan of the building
  const bg = backgroundImageOf(home, levelId);
  const bgImage = bg && bg.visible !== false ? input.icons.get(bg.image) : undefined;
  if (bg && bgImage?.complete && bgImage.naturalWidth > 0) {
    const s = backgroundScale(bg);
    ctx.save();
    ctx.globalAlpha = backdrop.size > 0 ? 1 : 0.7;
    ctx.translate(-(bg.x_origin ?? 0), -(bg.y_origin ?? 0));
    ctx.scale(s, s);
    ctx.drawImage(bgImage, 0, 0);
    ctx.restore();
  }

  // The level below (or above) as a faded background, to align walls and rooms
  const below = underlayLevel(home, levelId);
  if (below) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = colors.wallStroke;
    ctx.lineWidth = px;
    ctx.setLineDash([4 * px, 3 * px]);
    for (const room of home.rooms) {
      if (room.attrs.level !== below || room.points.length < 3) continue;
      ctx.beginPath();
      tracePath(
        ctx,
        room.points.map((p) => [p.x, p.y]),
      );
      ctx.closePath();
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = colors.grid;
    home.walls.forEach((w, i) => {
      if (w.attrs.level !== below) return;
      ctx.beginPath();
      tracePath(ctx, wallPolygon(wallShapes[i]));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }

  // Rooms: floor color or texture like Sweet Home 3D's default preference
  // "room rendering: floor color or texture", 75 % opaque
  const monochrome = usePreferences.getState().roomRendering === "monochrome";
  for (const room of home.rooms) {
    if (!sameLevel(room.attrs.level, levelId) || room.points.length < 3) continue;
    ctx.beginPath();
    tracePath(
      ctx,
      room.points.map((p) => [p.x, p.y]),
    );
    ctx.closePath();
    if (room.attrs.floor_visible !== false) {
      const texture = monochrome
        ? undefined
        : room.textures?.find((t) => t.role === "floorTexture");
      const img = texture ? input.icons.get(texture.image) : undefined;
      const pattern = texture && img ? texturePattern(ctx, img, texture) : null;
      ctx.fillStyle =
        pattern ??
        (room.attrs.floor_color !== null && !monochrome
          ? cssColor(room.attrs.floor_color, colors.roomFill)
          : colors.roomFill);
      ctx.globalAlpha = ROOM_ALPHA;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = px;
    ctx.strokeStyle = colors.roomStroke;
    ctx.stroke();
  }

  // Polylines
  for (const pl of home.polylines) {
    if (!sameLevel(pl.attrs.level, levelId) || pl.points.length < 2) continue;
    ctx.beginPath();
    const linePts: Pt[] = pl.points.map((p) => [p.x, p.y]);
    const curved = pl.attrs.join_style === "CURVED" && linePts.length > 2;
    if (curved) {
      // Smooth curve through the points
      ctx.moveTo(linePts[0][0], linePts[0][1]);
      for (const [c1, c2, to] of curveSegments(linePts, !!pl.attrs.closed_path)) {
        ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], to[0], to[1]);
      }
    } else {
      tracePath(ctx, linePts);
      if (pl.attrs.closed_path) ctx.closePath();
    }
    ctx.lineWidth = Math.max(pl.attrs.thickness ?? 1, px);
    ctx.strokeStyle = cssColor(pl.attrs.color, colors.text);
    ctx.setLineDash(dashPattern(pl.attrs.dash_style, ctx.lineWidth));
    ctx.stroke();
    ctx.setLineDash([]);
    if (!pl.attrs.closed_path) {
      // Arrows follow the curve's direction at its ends
      const pts = polylinePath(pl.points, pl.attrs.join_style, false);
      const n = pts.length;
      drawArrow(ctx, pl.attrs.start_arrow_style, pts[1], pts[0], ctx.lineWidth);
      drawArrow(ctx, pl.attrs.end_arrow_style, pts[n - 2], pts[n - 1], ctx.lineWidth);
    }
  }

  // Furniture (below walls so that doors in walls stay readable on top)
  for (const p of pieces) {
    if (p.kind !== "DoorOrWindow" && !backdrop.has(p)) drawPiece(ctx, p, input, colors, px);
  }

  // Walls, drawn as one area like Sweet Home 3D: first all outlines with double
  // width, then all fills on top, so lines inside overlapping walls disappear and
  // only the outer half of each outline stays visible
  const wallPolys: { poly: Pt[]; pattern: string }[] = [];
  home.walls.forEach((w, i) => {
    if (wallAtLevel(home, w, levelId)) {
      wallPolys.push({
        poly: wallPolygon(wallShapes[i]),
        pattern: w.attrs.pattern ?? DEFAULT_WALL_PATTERN,
      });
    }
  });
  ctx.lineWidth = 3 * px;
  ctx.strokeStyle = colors.wallStroke;
  // Round joins: mitered outlines would stick out at the acute corners of joined walls
  ctx.lineJoin = "round";
  for (const { poly } of wallPolys) {
    ctx.beginPath();
    tracePath(ctx, poly);
    ctx.closePath();
    ctx.stroke();
  }
  for (const { poly, pattern } of wallPolys) {
    ctx.beginPath();
    tracePath(ctx, poly);
    ctx.closePath();
    ctx.fillStyle = wallPattern(ctx, pattern, colors, view.scale);
    ctx.fill();
  }

  // Baseboards: thin outlines along the wall sides
  ctx.lineWidth = px;
  ctx.strokeStyle = colors.wallStroke;
  home.walls.forEach((w, i) => {
    if (!wallAtLevel(home, w, levelId)) return;
    for (const side of ["left", "right"] as const) {
      const bb = baseboardOf(w, side);
      if (!bb || bb.attrs.thickness <= 0) continue;
      const outline = baseboardPolygon(wallShapes[i], side, bb.attrs.thickness);
      if (!outline) continue;
      ctx.beginPath();
      tracePath(ctx, outline.poly);
      ctx.closePath();
      ctx.stroke();
    }
  });

  // Doors and windows on top of walls
  for (const p of pieces) {
    if (p.kind === "DoorOrWindow") drawDoorOrWindow(ctx, p, input, colors, px);
  }

  // Names of the furniture shown in the plan
  for (const p of pieces) {
    if (!p.attrs.name_visible || p.attrs.visible === false) continue;
    drawText(
      ctx,
      p.attrs.name,
      p.attrs.x + (p.attrs.name_x_offset ?? 0),
      p.attrs.y + (p.attrs.name_y_offset ?? 0),
      p.attrs.name_angle ?? 0,
      p.text_style ?? null,
      DEFAULT_PIECE_FONT,
      colors.text,
    );
  }

  // Room names and areas
  for (const room of home.rooms) {
    if (!sameLevel(room.attrs.level, levelId) || room.points.length < 3) continue;
    const labels = roomLabelPositions(room);
    const nameStyle = room.text_styles?.find((t) => t.role === "nameStyle") ?? null;
    const areaStyle = room.text_styles?.find((t) => t.role === "areaStyle") ?? null;
    if (room.attrs.name) {
      drawText(
        ctx,
        room.attrs.name,
        labels.name[0],
        labels.name[1],
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
        formatArea(area * 10000),
        labels.area[0],
        labels.area[1],
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
  input: PlanInput,
  colors: PlanColors,
  px: number,
): void {
  // Footprint after pitch/roll (e.g. tilted roof panels)
  const w = p.attrs.width_in_plan ?? p.attrs.width;
  const d = p.attrs.depth_in_plan ?? p.attrs.depth;
  ctx.save();
  pieceTransform(ctx, p);
  const iconKey = p.attrs.plan_icon ?? p.attrs.icon;
  const img = iconKey ? input.icons.get(iconKey) : undefined;
  const top = input.topView?.(p) ?? null;
  if (top) {
    // Rendered with the model's mirroring already applied; fills the footprint exactly
    ctx.drawImage(top, -w / 2, -d / 2, w, d);
  } else if (img?.complete && img.naturalWidth > 0) {
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
  input: PlanInput,
  colors: PlanColors,
  px: number,
): void {
  const { width: w, depth: d } = p.attrs;
  const icons = input.icons;
  // The opening goes through the whole wall, as in the 3D view: clear the walls across the
  // width of the piece (a reveal where the piece is thinner than the wall)
  const { home, wallShapes, levelId } = input;
  ctx.save();
  ctx.beginPath();
  let thickest = 0;
  home.walls.forEach((wall, i) => {
    if (!wallAtLevel(home, wall, levelId)) return;
    const poly = wallPolygon(wallShapes[i]);
    poly.forEach((q, k) => {
      if (k) ctx.lineTo(q[0], q[1]);
      else ctx.moveTo(q[0], q[1]);
    });
    ctx.closePath();
    thickest = Math.max(thickest, wall.attrs.thickness);
  });
  if (thickest > 0) {
    ctx.clip("nonzero");
    pieceTransform(ctx, p);
    ctx.fillStyle = colors.background;
    ctx.fillRect(-w / 2, -d / 2 - thickest, w, d + 2 * thickest);
    // Edges of the opening through the wall
    ctx.lineWidth = px;
    ctx.strokeStyle = colors.wallStroke;
    ctx.strokeRect(-w / 2, -d / 2 - thickest, w, d + 2 * thickest);
  }
  ctx.restore();
  ctx.save();
  pieceTransform(ctx, p);
  // Opening in the wall, with the frame seen from above
  ctx.fillStyle = colors.background;
  ctx.fillRect(-w / 2, -d / 2, w, d);
  const top = input.topView?.(p) ?? null;
  if (top) ctx.drawImage(top, -w / 2, -d / 2, w, d);
  if (p.attrs.model_mirrored) ctx.scale(-1, 1);
  ctx.lineWidth = px;
  ctx.strokeStyle = colors.furnitureStroke;
  ctx.strokeRect(-w / 2, -d / 2, w, d);
  // Sashes: axis relative to the piece's top-left corner, opening angles in radians. Drawn as
  // pie like Sweet Home 3D (both edges and the arc): models differ in which angle is the open
  // position, so drawing one edge only loses the open sash of some windows.
  for (const s of p.sashes ?? []) {
    const ax = -w / 2 + s.x_axis * w;
    const ay = -d / 2 + s.y_axis * d;
    const r = s.width * w;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    // Sash angles follow Java's Arc2D (counter-clockwise on screen): negate them for canvas
    const end = -s.end_angle;
    const start = -s.start_angle;
    ctx.lineTo(ax + Math.cos(end) * r, ay + Math.sin(end) * r);
    ctx.arc(ax, ay, r, end, start, end > start);
    ctx.closePath();
    ctx.stroke();
  }
  if (!p.sashes?.length && !top) {
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
  if (length === 0) {
    drawHeightDimension(ctx, dl, colors, px);
    return;
  }
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
  // Like Sweet Home 3D, the text sits on the outer side of the dimension line
  ctx.textBaseline = offset > 0 ? "top" : "bottom";
  ctx.fillText(formatLength(length), length / 2, offset + Math.sign(offset || -1) * size * 0.15);
  ctx.restore();
}

/**
 * A height dimension (Sweet Home 3D's elevation dimension line: one point of the plan, two
 * elevations): a marker at the point with the measured height beside it.
 */
function drawHeightDimension(
  ctx: CanvasRenderingContext2D,
  dl: Home["dimension_lines"][number],
  colors: PlanColors,
  px: number,
): void {
  const a = dl.attrs;
  const height = Math.abs((a.elevation_end ?? 0) - (a.elevation_start ?? 0));
  if (height < 0.05) return;
  const color = cssColor(a.color, colors.dimension);
  const r = 6 * px;
  ctx.save();
  ctx.translate(a.x_start, a.y_start);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = px;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  // Vertical double arrow inside the marker
  ctx.moveTo(0, -r * 0.65);
  ctx.lineTo(0, r * 0.65);
  ctx.moveTo(-r * 0.35, -r * 0.3);
  ctx.lineTo(0, -r * 0.65);
  ctx.lineTo(r * 0.35, -r * 0.3);
  ctx.moveTo(-r * 0.35, r * 0.3);
  ctx.lineTo(0, r * 0.65);
  ctx.lineTo(r * 0.35, r * 0.3);
  ctx.stroke();
  ctx.font = fontOf(dl.text_style, DEFAULT_DIMENSION_FONT);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`↕ ${formatLength(height)}`, r * 1.6, 0);
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

/** Formats a length in centimeters in the unit of the preferences. */
export function formatLength(cm: number): string {
  return formatUnitLength(cm);
}

/** Arrow head of a polyline at `tip`, pointing from `from` to `tip` (shapes like Sweet Home 3D). */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  style: string | null,
  from: Pt,
  tip: Pt,
  lineWidth: number,
): void {
  if (!style || style === "NONE") return;
  const scale = lineWidth ** 0.66 * 2;
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  ctx.save();
  ctx.translate(tip[0], tip[1]);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = lineWidth / scale;
  ctx.beginPath();
  if (style === "DISC") {
    ctx.arc(-1.5, 0, 1.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(-5, -2);
    ctx.lineTo(0, 0);
    ctx.lineTo(-5, 2);
    if (style === "DELTA") {
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }
  ctx.restore();
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

/**
 * Positions of the name and area labels of a room. A label with a stored offset is
 * placed like Sweet Home 3D (bounding box center + offset); without one at
 * `labelCenter` (the name above the area). Same as `msh_geometry::room_label_positions`.
 */
export function roomLabelPositions(room: Room): { name: Pt; area: Pt } {
  const pts: Pt[] = room.points.map((p) => [p.x, p.y]);
  const bbox = boundsCenter(pts);
  const auto = labelCenter(pts);
  const a = room.attrs;
  const name: Pt =
    a.name_x_offset != null || a.name_y_offset != null
      ? [bbox[0] + (a.name_x_offset ?? 0), bbox[1] + (a.name_y_offset ?? 0)]
      : [auto[0], auto[1] + DEFAULT_ROOM_NAME_Y_OFFSET];
  const area: Pt =
    a.area_x_offset != null || a.area_y_offset != null
      ? [bbox[0] + (a.area_x_offset ?? 0), bbox[1] + (a.area_y_offset ?? 0)]
      : auto;
  return { name, area };
}

/** Center of the bounding box of the points. */
export function boundsCenter(points: Pt[]): Pt {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/**
 * Point where the name and area of a room are shown: the area centroid, or for
 * strongly concave rooms (centroid outside) the inner point farthest from the edges.
 * Same as `msh_geometry::label_center`, so the plan and its export agree.
 */
export function labelCenter(points: Pt[]): Pt {
  const n = points.length;
  if (n === 0) return [0, 0];
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  const centroid: Pt =
    Math.abs(area) < 1e-9
      ? [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n]
      : [cx / (3 * area), cy / (3 * area)];
  if (pointInPolygon(centroid, points)) return centroid;
  return innerPoint(points) ?? centroid;
}

/** Approximate inner point farthest from the edges (grid search with refinement). */
function innerPoint(points: Pt[]): Pt | null {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  let x0 = Math.min(...xs);
  let y0 = Math.min(...ys);
  let w = Math.max(...xs) - x0;
  let h = Math.max(...ys) - y0;
  const steps = 24;
  let best: { d: number; p: Pt } | null = null;
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const p: Pt = [x0 + (w * i) / steps, y0 + (h * j) / steps];
        if (!pointInPolygon(p, points)) continue;
        let d = Number.POSITIVE_INFINITY;
        for (let k = 0; k < points.length; k++) {
          d = Math.min(d, distanceToSegment(p, points[k], points[(k + 1) % points.length]));
        }
        if (!best || d > best.d) best = { d, p };
      }
    }
    if (!best) return null;
    w /= 4;
    h /= 4;
    x0 = best.p[0] - w / 2;
    y0 = best.p[1] - h / 2;
  }
  return best?.p ?? null;
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

// ------------------------------------------------------------------ Patterns

/** Size of a wall pattern tile in CSS pixels (Sweet Home 3D's pattern images are 10 px). */
const PATTERN_TILE = 10;
const patternCache = new Map<string, CanvasPattern | null>();

/**
 * Canvas pattern of a Sweet Home 3D wall pattern. Tiles keep their size in
 * screen pixels whatever the zoom, like in Sweet Home 3D.
 */
function wallPattern(
  ctx: CanvasRenderingContext2D,
  name: string,
  colors: PlanColors,
  scale: number,
): CanvasPattern | string {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const key = `${name}|${colors.wallStroke}|${colors.background}|${colors.wallFill}|${dpr}`;
  let pattern = patternCache.get(key);
  if (pattern === undefined) {
    pattern = createWallPattern(ctx, name, colors, dpr);
    patternCache.set(key, pattern);
  }
  if (!pattern) return colors.wallFill;
  // Undo the view scale so that one tile stays PATTERN_TILE × dpr device pixels
  pattern.setTransform(new DOMMatrix().scale(1 / scale));
  return pattern;
}

function createWallPattern(
  ctx: CanvasRenderingContext2D,
  name: string,
  colors: PlanColors,
  dpr: number,
): CanvasPattern | null {
  const size = Math.max(4, Math.round(PATTERN_TILE * dpr));
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const t = tile.getContext("2d");
  if (!t) return null;
  const reversed = name.startsWith("reversed");
  const fg = colors.wallStroke;
  const bg = colors.background;
  t.fillStyle = name === "foreground" ? colors.wallFill : reversed ? fg : bg;
  t.fillRect(0, 0, size, size);
  t.strokeStyle = reversed ? bg : fg;
  t.lineWidth = Math.max(1, dpr);
  t.lineCap = "square";
  const up = name === "hatchUp" || name === "reversedHatchUp" || name === "crossHatch";
  const down = name === "hatchDown" || name === "reversedHatchDown" || name === "crossHatch";
  t.beginPath();
  // Diagonals drawn across neighbouring tiles too, so that lines join seamlessly
  for (const o of [-size, 0, size]) {
    if (up) {
      t.moveTo(o, size);
      t.lineTo(o + size, 0);
    }
    if (down) {
      t.moveTo(o, 0);
      t.lineTo(o + size, size);
    }
  }
  t.stroke();
  return ctx.createPattern(tile, "repeat");
}

/** Pattern of a floor texture image covering texture.width × texture.height cm. */
function texturePattern(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  texture: Texture,
): CanvasPattern | null {
  if (!img.complete || img.naturalWidth === 0) return null;
  const pattern = ctx.createPattern(img, "repeat");
  if (!pattern) return null;
  const scale = texture.scale ?? 1;
  pattern.setTransform(
    new DOMMatrix()
      .rotate(((texture.angle ?? 0) * 180) / Math.PI)
      .scale(
        (texture.width * scale) / img.naturalWidth,
        (texture.height * scale) / img.naturalHeight,
      ),
  );
  return pattern;
}
