// Outline of a catalog piece dragged over the plan: at its size where it will be dropped, a
// door or window in the wall it will be placed in.

import type { Home, Pt } from "../model";
import { nearestWall } from "./interaction";

export type DropPreview = {
  /** Corners of the piece in the plan (cm) */
  corners: Pt[];
  center: Pt;
  /** Angle in radians, clockwise like the plan */
  angle: number;
  width: number;
  depth: number;
};

/** Rectangle of `width` × `depth` centered at `center`, turned by `angle`. */
export function rectangle(center: Pt, width: number, depth: number, angle: number): Pt[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ].map(([x, y]) => [center[0] + x * c - y * s, center[1] + x * s + y * c]);
}

/**
 * Where a dragged piece lands at `p`: a door or window near a wall sits in it (turned like the
 * wall, as deep as the wall is thick), as the drop places it; other pieces are centered at `p`.
 */
export function dropPreview(
  home: Home,
  levelId: string | null,
  item: { width: number; depth: number; doorOrWindow: boolean },
  p: Pt,
  wallDistance: number,
): DropPreview {
  const wall = item.doorOrWindow ? nearestWall(home, levelId, p, wallDistance) : null;
  const w = wall ? home.walls.find((x) => x.attrs.id === wall.id)?.attrs : undefined;
  if (wall && w) {
    const len = Math.hypot(w.x_end - w.x_start, w.y_end - w.y_start) || 1;
    const offset = Math.round(wall.offset);
    const center: Pt = [
      w.x_start + ((w.x_end - w.x_start) * offset) / len,
      w.y_start + ((w.y_end - w.y_start) * offset) / len,
    ];
    const angle = Math.atan2(w.y_end - w.y_start, w.x_end - w.x_start);
    return {
      corners: rectangle(center, item.width, w.thickness, angle),
      center,
      angle,
      width: item.width,
      depth: w.thickness,
    };
  }
  const center: Pt = [Math.round(p[0]), Math.round(p[1])];
  return {
    corners: rectangle(center, item.width, item.depth, 0),
    center,
    angle: 0,
    width: item.width,
    depth: item.depth,
  };
}
