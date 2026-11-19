// Reference objects (terrain, scans, neighbor houses): where they show and how.

import {
  forEveryPiece,
  type Home,
  hiddenIn3d,
  hiddenInPlan,
  isReference,
  type Piece,
  planOpacity,
  sectionHeight,
} from "../model";

/** Opacity of the view from above of a reference object in the plan, unless it has its own. */
export const REFERENCE_OPACITY = 0.35;

/** The reference objects of a home, hidden ones too (so that they can be shown again). */
export function referenceObjects(home: Home | null | undefined): Piece[] {
  const found: Piece[] = [];
  if (home) {
    forEveryPiece(home.furniture, (p) => {
      if (isReference(p) && p.attrs.id) found.push(p);
    });
  }
  return found;
}

/** Where a reference object shows. */
export function shownIn(p: Piece): { plan: boolean; view3d: boolean } {
  const visible = p.attrs.visible !== false;
  return { plan: visible && !hiddenInPlan(p), view3d: visible && !hiddenIn3d(p) };
}

/**
 * Parameters of `furniture_update` that show or hide a reference object in the plan or in 3D
 * and leave the other one as it is.
 */
export function showParams(
  p: Piece,
  where: "plan" | "view3d",
  shown: boolean,
): { visible: boolean; plan_visible: boolean; view3d_visible: boolean } {
  const next = { ...shownIn(p), [where]: shown };
  // Hidden everywhere is the visibility of the piece itself, which Sweet Home 3D knows too
  if (!next.plan && !next.view3d) {
    return { visible: false, plan_visible: true, view3d_visible: true };
  }
  return { visible: true, plan_visible: next.plan, view3d_visible: next.view3d };
}

/** Opacity of a reference object in the plan in percent: its own, or the default. */
export function shownOpacity(p: Piece): number {
  // The lines of a cut are drawn in full unless the object has its own opacity
  const fallback = sectionHeight(p) !== null ? 1 : REFERENCE_OPACITY;
  return Math.round((planOpacity(p) ?? fallback) * 100);
}
