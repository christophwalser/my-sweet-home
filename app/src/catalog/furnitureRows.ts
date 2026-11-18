// Rows of the furniture list: one per piece or group, or one per kind of piece with the number
// of equal pieces ("6 × Chair"), so the list can be read as a parts list.

import type { Furniture } from "../model";

export type ListedFurniture = Furniture & { attrs: { id: string } };

/** A row of the list: the piece shown and the IDs of all pieces it stands for. */
export type ListRow = { first: ListedFurniture; ids: string[] };

/** What makes two pieces equal for the list: catalog item, name, size and level. */
function combineKey(f: ListedFurniture): string {
  if (f.type !== "piece") return `group:${f.attrs.id}`;
  const a = f.attrs;
  return [a.catalog_id ?? "", a.name, a.width, a.depth, a.height, a.level ?? ""].join("|");
}

/** Rows in the order of `items`; with `combine` equal pieces share the row of the first. */
export function listRows(items: ListedFurniture[], combine: boolean): ListRow[] {
  const rows: ListRow[] = [];
  const byKey = new Map<string, ListRow>();
  for (const item of items) {
    const key = combine ? combineKey(item) : item.attrs.id;
    const row = byKey.get(key);
    if (row) row.ids.push(item.attrs.id);
    else {
      const added = { first: item, ids: [item.attrs.id] };
      byKey.set(key, added);
      rows.push(added);
    }
  }
  return rows;
}

/** Whether all words of the search are found in the texts of a row (case-insensitive). */
export function matchesWords(texts: string[], query: string): boolean {
  const hay = texts.join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** IDs of the rows from the one clicked before to the clicked one (Shift+click). */
export function rangeIds(rows: ListRow[], anchor: number, index: number): string[] {
  const from = Math.max(0, Math.min(anchor, index));
  const to = Math.max(anchor, index);
  return rows.slice(from, to + 1).flatMap((r) => r.ids);
}
