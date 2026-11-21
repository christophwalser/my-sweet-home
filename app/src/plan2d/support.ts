// Furniture standing on other furniture: with magnetism a piece moved onto a larger one
// lands on its top (Sweet Home 3D's `dropOnTopElevation`) or, for shelf units, on the
// shelf nearest to its elevation. The elevation handle snaps to these surfaces.

import { t } from "../i18n";
import { forEachPiece, type Home, isReference, type Piece, type Pt } from "../model";
import { isRoof } from "./roof";

/** A surface a piece can stand on, as elevation above the floor of its level (cm). */
export type Surface = { elevation: number; label: string };

/** Position of `p` in the local frame of a piece, measured from its left / back corner. */
function local(q: Piece, p: Pt): Pt {
  const a = q.attrs;
  const angle = a.angle ?? 0;
  const dx = p[0] - a.x;
  const dy = p[1] - a.y;
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const w = a.width_in_plan ?? a.width;
  const d = a.depth_in_plan ?? a.depth;
  return [dx * c - dy * s + w / 2, dx * s + dy * c + d / 2];
}

function contains(q: Piece, p: Pt): boolean {
  const [x, y] = local(q, p);
  const a = q.attrs;
  return x >= 0 && y >= 0 && x <= (a.width_in_plan ?? a.width) && y <= (a.depth_in_plan ?? a.depth);
}

/** Surfaces of a support at the point `p` (its top and the shelves under `p`). */
function surfacesOf(q: Piece, p: Pt): Surface[] {
  const a = q.attrs;
  const base = a.elevation ?? 0;
  const height = a.height_in_plan ?? a.height;
  const result: Surface[] = [
    {
      elevation: base + height * (a.drop_on_top_elevation ?? 1),
      label: t("on {name}", { name: a.name }),
    },
  ];
  const [x, y] = local(q, p);
  for (const shelf of q.shelves ?? []) {
    if (shelf.elevation != null) {
      result.push({
        elevation: base + shelf.elevation * a.height,
        label: t("shelf of {name}", { name: a.name }),
      });
    } else if (shelf.z_lower != null) {
      const inside =
        x >= (shelf.x_lower ?? 0) * a.width &&
        x <= (shelf.x_upper ?? 1) * a.width &&
        y >= (shelf.y_lower ?? 0) * a.depth &&
        y <= (shelf.y_upper ?? 1) * a.depth;
      if (inside) {
        result.push({
          elevation: base + shelf.z_lower * a.height,
          label: t("shelf of {name}", { name: a.name }),
        });
      }
    }
  }
  return result;
}

/** Pieces that can carry `piece` at the point `p`: larger, on the same level, not doors. */
function supports(home: Home, piece: Piece, p: Pt): Piece[] {
  const a = piece.attrs;
  const area = (a.width_in_plan ?? a.width) * (a.depth_in_plan ?? a.depth);
  const result: Piece[] = [];
  forEachPiece(home.furniture, (q) => {
    const b = q.attrs;
    if (q === piece || b.id === a.id || b.level !== a.level || b.visible === false) return;
    if (q.kind === "DoorOrWindow" || q.kind === "Light" || b.staircase_cut_out_shape) return;
    // A reference object (terrain, scan) is only a box around its model, no surface to stand on
    if (isReference(q) || isRoof(q)) return;
    if ((b.width_in_plan ?? b.width) * (b.depth_in_plan ?? b.depth) <= area) return;
    if (contains(q, p)) result.push(q);
  });
  return result;
}

/** All surfaces under the point `p` for `piece`, lowest first. */
export function surfacesAt(home: Home, piece: Piece, p: Pt): Surface[] {
  return supports(home, piece, p)
    .flatMap((q) => surfacesOf(q, p))
    .sort((s1, s2) => s1.elevation - s2.elevation);
}

/**
 * Elevation of `piece` after moving its center to `to`: on the support below (the shelf
 * nearest to its elevation, else the top), back on the floor when it leaves the support
 * it stood on, otherwise unchanged. Null if nothing changes.
 */
export function dropElevation(home: Home, piece: Piece, to: Pt): Surface | null {
  const a = piece.attrs;
  if (piece.kind === "DoorOrWindow") return null;
  const current = a.elevation ?? 0;
  const candidates = supports(home, piece, to);
  if (candidates.length > 0) {
    let best: Surface | null = null;
    for (const q of candidates) {
      const surfaces = surfacesOf(q, to);
      // Shelf units: the shelf nearest to the current elevation; other pieces: their top
      const chosen =
        (q.shelves?.length ?? 0) > 0
          ? surfaces.reduce((s1, s2) =>
              Math.abs(s2.elevation - current) < Math.abs(s1.elevation - current) ? s2 : s1,
            )
          : surfaces[0];
      if (!best || chosen.elevation > best.elevation) best = chosen;
    }
    if (best && Math.abs(best.elevation - current) > 0.05) {
      return { elevation: Math.round(best.elevation * 10) / 10, label: best.label };
    }
    return null;
  }
  // Moved off the piece it stood on: back on the floor
  const before = surfacesAt(home, piece, [a.x, a.y]);
  if (current > 0 && before.some((s) => Math.abs(s.elevation - current) < 0.5)) {
    return { elevation: 0, label: t("on the floor") };
  }
  return null;
}
