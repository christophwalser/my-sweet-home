// The selected elements as a list for the properties panel: kind and a readable name, so an
// element selected by mistake can be taken out of the selection.

import { t } from "../i18n";
import type { Furniture, Home } from "../model";
import { homeGuides } from "../plan2d/guides";
import { formatLength } from "../units";

/** Kind of element the selection list filters by. */
export type SelectionGroup =
  | "wall"
  | "room"
  | "furniture"
  | "text"
  | "dimension"
  | "line"
  | "ruler"
  | "other";

export type SelectionItem = { id: string; kind: string; name: string; group: SelectionGroup };

/** Name of each kind of element in the filter of the selection list, in the shown order. */
const GROUP_LABELS: [SelectionGroup, () => string][] = [
  ["wall", () => t("Walls")],
  ["room", () => t("Rooms")],
  ["furniture", () => t("Furniture")],
  ["text", () => t("Texts")],
  ["dimension", () => t("Dimensions")],
  ["line", () => t("Lines")],
  ["ruler", () => t("Rulers")],
  ["other", () => t("Other")],
];

/** The kinds of the selected elements with their number, for filtering the list. */
export function selectionGroups(
  items: SelectionItem[],
): { group: SelectionGroup; label: string; count: number }[] {
  return GROUP_LABELS.map(([group, label]) => ({
    group,
    label: label(),
    count: items.filter((i) => i.group === group).length,
  })).filter((g) => g.count > 0);
}

/** Readable kind and name of each selected element, in the order of the selection. */
export function selectionItems(
  home: Home,
  selection: string[],
  visitorId: string,
): SelectionItem[] {
  const byId = new Map<string, SelectionItem>();
  for (const w of home.walls) {
    const a = w.attrs;
    byId.set(a.id, {
      id: a.id,
      kind: t("Wall"),
      group: "wall",
      name: formatLength(Math.hypot(a.x_end - a.x_start, a.y_end - a.y_start)),
    });
  }
  for (const r of home.rooms) {
    if (r.attrs.id)
      byId.set(r.attrs.id, {
        id: r.attrs.id,
        kind: t("Room"),
        name: r.attrs.name ?? "",
        group: "room",
      });
  }
  const walk = (items: Furniture[]) => {
    for (const f of items) {
      if (!f.attrs.id) continue;
      if (f.type === "group") {
        byId.set(f.attrs.id, {
          id: f.attrs.id,
          kind: t("Group"),
          name: f.attrs.name,
          group: "furniture",
        });
        walk(f.items);
      } else {
        const kind =
          f.kind === "DoorOrWindow"
            ? t("Door or window")
            : f.kind === "Light"
              ? t("Light")
              : t("Furniture");
        byId.set(f.attrs.id, { id: f.attrs.id, kind, name: f.attrs.name, group: "furniture" });
      }
    }
  };
  walk(home.furniture);
  for (const l of home.labels) {
    if (l.attrs.id)
      byId.set(l.attrs.id, { id: l.attrs.id, kind: t("Text"), name: l.text, group: "text" });
  }
  for (const d of home.dimension_lines) {
    const a = d.attrs;
    if (a.id) {
      byId.set(a.id, {
        id: a.id,
        kind: t("Dimension"),
        group: "dimension",
        name: formatLength(Math.hypot(a.x_end - a.x_start, a.y_end - a.y_start)),
      });
    }
  }
  for (const p of home.polylines) {
    if (p.attrs.id)
      byId.set(p.attrs.id, { id: p.attrs.id, kind: t("Line"), name: "", group: "line" });
  }
  for (const g of homeGuides(home)) {
    byId.set(g.id, {
      id: g.id,
      kind: t("Ruler"),
      group: "ruler",
      name: formatLength(Math.hypot(g.x_end - g.x_start, g.y_end - g.y_start)),
    });
  }
  return selection.map(
    (id) =>
      byId.get(id) ??
      (id === visitorId
        ? { id, kind: t("Visitor"), name: "", group: "other" }
        : { id, kind: t("Element"), name: id, group: "other" }),
  );
}
