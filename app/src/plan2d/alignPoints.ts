// Aligning a reference object (scan, terrain, neighbor house) or a piece of furniture with two
// pairs of points: a point on it and where it belongs in the plan, twice. The four clicks are
// taken in the plan; `furniture_align_points` then turns, moves and optionally resizes it.

import { t } from "../i18n";
import { useStore } from "../store";
import { useUi } from "../ui/uiStore";

/** Asks for the four points in the plan and aligns the piece when they are clicked. */
export function startAlignPoints(id: string, name: string, resize: boolean): void {
  useUi.getState().setPointPick({
    labels: [
      t("Align “{name}”: click a point on it · Esc cancels", { name }),
      t("Click where this point belongs in the plan"),
      t("Click a second point on “{name}”, far from the first", { name }),
      t("Click where the second point belongs"),
    ],
    points: [],
    onDone: (points) =>
      void useStore.getState().run("furniture_align_points", {
        id,
        from: [points[0], points[2]],
        to: [points[1], points[3]],
        resize,
      }),
  });
}
