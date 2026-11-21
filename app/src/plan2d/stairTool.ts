// Adding stairs and floor openings from the plan. A stair takes two clicks: where its first
// step starts and the direction it climbs in, with its outline as preview. An opening takes
// the three clicks of a rectangle, like a roof.

import { t } from "../i18n";
import type { Pt } from "../model";
import { useStore } from "../store";
import { useUi } from "../ui/uiStore";
import { roofRectangle } from "./roof";
import { climbAngle, placedFootprint, type StairShape } from "./stair";

/** Asks for the start and the direction of a stair and adds it on the shown level. */
export async function startStair(shape: StairShape): Promise<void> {
  const { run, selectedLevel } = useStore.getState();
  const level = selectedLevel ? { level: selectedLevel } : {};
  // The outline of the stair with its defaults for the height of the level, for the preview
  const calc = (await run("stair_calc", { shape, ...level })) as { footprint?: Pt[] } | undefined;
  const footprint = calc?.footprint ?? [];
  useUi.getState().setPointPick({
    labels: [
      t("Stairs: click where the first step starts · Esc cancels"),
      t("Click the direction the stairs climb in"),
    ],
    points: [],
    outline: (points) =>
      points.length >= 2 && footprint.length > 2
        ? placedFootprint(footprint, points[0], points[1])
        : points.slice(0, 1),
    onDone: async (points) => {
      const [from, to] = points;
      if (!from || !to) return;
      const { run, setSelection } = useStore.getState();
      const result = (await run("stair_add", {
        x: from[0],
        y: from[1],
        angle_deg: climbAngle(from, to),
        shape,
        name: t("Stairs"),
        ...level,
      })) as { id?: string } | undefined;
      if (result?.id) setSelection([result.id]);
    },
  });
}

/** Asks for the three points of a rectangle and adds a floor opening on the shown level. */
export function startOpening(): void {
  useUi.getState().setPointPick({
    labels: [
      t("Floor opening: click a corner · Esc cancels"),
      t("Click the next corner along the same side"),
      t("Click a point on the opposite side"),
    ],
    points: [],
    outline: roofRectangle,
    onDone: async (points) => {
      const corners = roofRectangle(points);
      if (corners.length !== 4) return;
      const { run, selectedLevel, setSelection } = useStore.getState();
      const result = (await run("opening_add", {
        points: corners,
        name: t("Floor opening"),
        ...(selectedLevel && { level: selectedLevel }),
      })) as { id?: string } | undefined;
      if (result?.id) setSelection([result.id]);
    },
  });
}
