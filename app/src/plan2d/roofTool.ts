// Adding roofs from the plan: over the walls of the shown level, or over a rectangle given by
// three clicks (two corners along one side, a point on the opposite side).

import { t } from "../i18n";
import { useStore } from "../store";
import { useUi } from "../ui/uiStore";
import { roofRectangle } from "./roof";

/** Adds a roof (over the walls of the shown level without `points`) and selects it. */
export async function addRoof(points?: [number, number][]): Promise<void> {
  const { run, selectedLevel, setSelection } = useStore.getState();
  const result = (await run("roof_add", {
    name: t("Roof"),
    ...(points && { points }),
    ...(selectedLevel && { level: selectedLevel }),
  })) as { ids?: string[] } | undefined;
  if (result?.ids?.length) setSelection(result.ids);
}

/** Asks for the three points of a rectangle in the plan and adds a roof over it. */
export function startRoofRectangle(): void {
  useUi.getState().setPointPick({
    labels: [
      t("Roof: click a corner of the area it covers · Esc cancels"),
      t("Click the next corner along the same side"),
      t("Click a point on the opposite side"),
    ],
    points: [],
    outline: roofRectangle,
    onDone: (points) => {
      const corners = roofRectangle(points);
      if (corners.length === 4) void addRoof(corners as [number, number][]);
    },
  });
}
