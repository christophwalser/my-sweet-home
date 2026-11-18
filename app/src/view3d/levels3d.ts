// Which levels the 3D view shows: only the selected one, the selected one with the ones below
// (as in Sweet Home 3D) or all of them. Levels switched off for 3D are never shown.

import { t } from "../i18n";
import type { Home } from "../model";

export type Levels3d = "selected" | "up_to_selected" | "all";

/** Home property that marks "only the selected level" (Sweet Home 3D does not know it). */
export const LEVELS_3D_PROPERTY = "mySweetHome.levelsIn3d";

/** The modes with their names, in the order they are offered. */
export const LEVELS_3D_OPTIONS: [Levels3d, string][] = [
  ["selected", t("Only the selected level")],
  ["up_to_selected", t("Up to the selected level")],
  ["all", t("All levels")],
];

export function levels3dMode(home: Home): Levels3d {
  if (home.environment?.attrs.all_levels_visible === true) return "all";
  const only = home.properties?.some(
    (p) => p.name === LEVELS_3D_PROPERTY && p.value === "selected",
  );
  return only ? "selected" : "up_to_selected";
}

/** IDs of the levels shown in 3D (`null`: the elements of a home without levels). */
export function visibleLevels(home: Home, selected: string | null): Set<string | null> {
  const set = new Set<string | null>();
  if (home.levels.length === 0) {
    set.add(null);
    return set;
  }
  const mode = levels3dMode(home);
  const sel = home.levels.find((l) => l.attrs.id === selected);
  const maxElevation = sel ? sel.attrs.elevation : Number.POSITIVE_INFINITY;
  for (const l of home.levels) {
    // `visible` is derived state saved by Sweet Home 3D (levels above the selected
    // one); only `viewable` is the user's choice.
    if (l.attrs.viewable === false) continue;
    const shown =
      mode === "all" ||
      (mode === "selected" && sel ? l === sel : l.attrs.elevation <= maxElevation);
    if (shown) set.add(l.attrs.id);
  }
  return set;
}
