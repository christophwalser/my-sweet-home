// Surfaces of the plan that take a color or texture: the floor of a room, the sides of a wall
// and whole pieces of furniture. Used to drop a texture from the catalog onto the plan and to
// take the look of a surface with the pipette (surface_copy).

import { forEachPiece, type Home, type Pt, type WallShape } from "../model";
import { distanceToSegment, elementOutlines, hitTestAll } from "./interaction";

/** Surface names of the commands surface_copy, texture_apply and texture_adjust. */
export type Surface = "floor" | "ceiling" | "left_side" | "right_side" | "top" | "piece";

export type SurfaceTarget = {
  id: string;
  surface: Surface;
  /** Line or polygon marking the surface in the plan */
  outline: Pt[];
  closed: boolean;
};

function distanceToLine(p: Pt, line: Pt[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < line.length; i++) {
    best = Math.min(best, distanceToSegment(p, line[i], line[i + 1]));
  }
  return best;
}

/**
 * Surface under a point of the plan: the side of a wall nearer to the point, a piece of
 * furniture (not a group) or the floor of a room.
 */
export function surfaceAt(
  home: Home,
  wallShapes: WallShape[],
  levelId: string | null,
  p: Pt,
  tolerance: number,
): SurfaceTarget | null {
  for (const hit of hitTestAll(home, wallShapes, levelId, p, tolerance)) {
    if (hit.kind === "wall") {
      const shape = wallShapes.find((s) => s.id === hit.id);
      if (!shape) continue;
      const left = distanceToLine(p, shape.left) <= distanceToLine(p, shape.right);
      return {
        id: hit.id,
        surface: left ? "left_side" : "right_side",
        outline: left ? shape.left : shape.right,
        closed: false,
      };
    }
    if (hit.kind === "room") {
      const room = home.rooms.find((r) => r.attrs.id === hit.id);
      if (!room) continue;
      return {
        id: hit.id,
        surface: "floor",
        outline: room.points.map((q): Pt => [q.x, q.y]),
        closed: true,
      };
    }
    if (hit.kind === "piece") {
      let single = false;
      forEachPiece(home.furniture, (q) => {
        if (q.attrs.id === hit.id) single = true;
      });
      const outline = elementOutlines(home, wallShapes, hit.id)[0];
      if (!single || !outline) continue;
      return { id: hit.id, surface: "piece", outline: outline.pts, closed: true };
    }
  }
  return null;
}
