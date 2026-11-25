// What the catalog shows and in which order: one library or all, as in the libraries, by name or
// by size.

import type { CatalogItem, LibraryInfo } from "../api";

export type CatalogSort = "library" | "name" | "largest" | "smallest";

export const CATALOG_SORTS: CatalogSort[] = ["library", "name", "largest", "smallest"];

/** What makes an item large: the floor a piece takes, the tile of a texture. */
function extent(item: CatalogItem): number {
  return item.kind === "furniture" ? item.width * item.depth : item.width * item.height;
}

/** The items in the chosen order; equal ones stay as in the libraries. */
export function sortItems(items: CatalogItem[], sort: CatalogSort): CatalogItem[] {
  switch (sort) {
    case "name":
      return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    case "largest":
      return [...items].sort((a, b) => extent(b) - extent(a));
    case "smallest":
      return [...items].sort((a, b) => extent(a) - extent(b));
    default:
      return items;
  }
}

/** The items of the library at `path`, or all if there is no such library (any more). */
export function itemsOfLibrary(
  items: CatalogItem[],
  libraries: LibraryInfo[],
  path: string | null,
): CatalogItem[] {
  const indexes = new Set(libraries.filter((l) => l.path === path).map((l) => l.index));
  return indexes.size > 0 ? items.filter((i) => indexes.has(i.library)) : items;
}
