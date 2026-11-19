// Names of the undo steps. The core labels each step with the command that made it
// ("wall_update"); the menus show what was changed and how ("Wall: changed").

import { t } from "../i18n";

/** What a command works on, by the first word of its name. */
const OBJECTS: Record<string, () => string> = {
  wall: () => t("Wall"),
  room: () => t("Room"),
  furniture: () => t("Furniture"),
  level: () => t("Level"),
  guide: () => t("Guide line"),
  label: () => t("Text"),
  dimension: () => t("Dimension"),
  polyline: () => t("Line"),
  texture: () => t("Texture"),
  surface: () => t("Surface"),
  home: () => t("Home"),
  compass: () => t("Compass"),
  background: () => t("Background image"),
  camera: () => t("Point of view"),
  viewpoint: () => t("Point of view"),
  edit: () => t("Selection"),
  location: () => t("Location and sun"),
  sun: () => t("Location and sun"),
  render: () => t("3D view"),
  view3d: () => t("3D view"),
  video: () => t("Video"),
};

/** What a command does, by the rest of its name; the first matching entry counts. */
const ACTIONS: [RegExp, () => string][] = [
  [/paste_style$/, () => t("style pasted")],
  [/^(add|import|store|new)|_add$/, () => t("added")],
  [/^(delete|remove|clear)|_(remove|clear)$/, () => t("deleted")],
  [/^(duplicate|paste|copy)/, () => t("copied")],
  [/^move|_move$/, () => t("moved")],
  [/^rename/, () => t("renamed")],
  [/^rotate/, () => t("rotated")],
  [/^flip/, () => t("flipped")],
  [/^join/, () => t("joined")],
  [/^split/, () => t("split")],
  [/^detach/, () => t("detached")],
  [/^reverse/, () => t("reversed")],
  [/^group/, () => t("grouped")],
  [/^ungroup/, () => t("ungrouped")],
  [/^align/, () => t("aligned")],
  [/^distribute/, () => t("distributed")],
  [/^replace/, () => t("replaced")],
  [/^(update|set|adjust|apply|select)|_(update|set)$/, () => t("changed")],
];

/** Name of an undo step for menus and tooltips; unknown commands show their own name. */
export function stepLabel(command: string): string {
  const cut = command.indexOf("_");
  const object = OBJECTS[cut < 0 ? command : command.slice(0, cut)]?.();
  const rest = cut < 0 ? "" : command.slice(cut + 1);
  const action = ACTIONS.find(([pattern]) => pattern.test(rest))?.[1]();
  if (!object || !action) return command;
  return t("{object}: {action}", { object, action });
}
