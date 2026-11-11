// The selected elements as a list for the properties panel: kind and a readable name, so an
// element selected by mistake can be taken out of the selection.

import { t } from "../i18n";
import type { Furniture, Home } from "../model";
import { homeGuides } from "../plan2d/guides";
import { formatLength } from "../units";

export type SelectionItem = { id: string; kind: string; name: string };

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
      name: formatLength(Math.hypot(a.x_end - a.x_start, a.y_end - a.y_start)),
    });
  }
  for (const r of home.rooms) {
    if (r.attrs.id)
      byId.set(r.attrs.id, { id: r.attrs.id, kind: t("Room"), name: r.attrs.name ?? "" });
  }
  const walk = (items: Furniture[]) => {
    for (const f of items) {
      if (!f.attrs.id) continue;
      if (f.type === "group") {
        byId.set(f.attrs.id, { id: f.attrs.id, kind: t("Group"), name: f.attrs.name });
        walk(f.items);
      } else {
        const kind =
          f.kind === "DoorOrWindow"
            ? t("Door or window")
            : f.kind === "Light"
              ? t("Light")
              : t("Furniture");
        byId.set(f.attrs.id, { id: f.attrs.id, kind, name: f.attrs.name });
      }
    }
  };
  walk(home.furniture);
  for (const l of home.labels) {
    if (l.attrs.id) byId.set(l.attrs.id, { id: l.attrs.id, kind: t("Text"), name: l.text });
  }
  for (const d of home.dimension_lines) {
    const a = d.attrs;
    if (a.id) {
      byId.set(a.id, {
        id: a.id,
        kind: t("Dimension"),
        name: formatLength(Math.hypot(a.x_end - a.x_start, a.y_end - a.y_start)),
      });
    }
  }
  for (const p of home.polylines) {
    if (p.attrs.id) byId.set(p.attrs.id, { id: p.attrs.id, kind: t("Line"), name: "" });
  }
  for (const g of homeGuides(home)) {
    byId.set(g.id, {
      id: g.id,
      kind: t("Ruler"),
      name: formatLength(Math.hypot(g.x_end - g.x_start, g.y_end - g.y_start)),
    });
  }
  return selection.map(
    (id) =>
      byId.get(id) ??
      (id === visitorId
        ? { id, kind: t("Visitor"), name: "" }
        : { id, kind: t("Element"), name: id }),
  );
}
