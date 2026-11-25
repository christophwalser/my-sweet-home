import { describe, expect, it } from "vitest";
import type { CatalogItem, LibraryInfo } from "../api";
import { itemsOfLibrary, sortItems } from "./catalogView";

const item = (name: string, library: number, width: number, depth = 10): CatalogItem => ({
  library,
  index: 1,
  kind: "furniture",
  id: name,
  name,
  category: "Things",
  creator: null,
  license: null,
  tags: [],
  icon: null,
  model: null,
  width,
  depth,
  height: 100,
  doorOrWindow: false,
});

const lib = (index: number, path: string): LibraryInfo => ({
  index,
  path,
  name: null,
  kind: "furniture",
  license: null,
  hidden: false,
  editable: true,
});

const ITEMS = [item("Table 10", 0, 80), item("Chair", 1, 40), item("Table 2", 1, 120)];
const names = (items: CatalogItem[]) => items.map((i) => i.name);

describe("sortItems", () => {
  it("keeps the order of the libraries", () => {
    expect(sortItems(ITEMS, "library")).toBe(ITEMS);
  });

  it("sorts by name with numbers in them", () => {
    expect(names(sortItems(ITEMS, "name"))).toEqual(["Chair", "Table 2", "Table 10"]);
  });

  it("sorts by the floor the pieces take", () => {
    expect(names(sortItems(ITEMS, "largest"))).toEqual(["Table 2", "Table 10", "Chair"]);
    expect(names(sortItems(ITEMS, "smallest"))).toEqual(["Chair", "Table 10", "Table 2"]);
  });

  it("sorts textures by their tile", () => {
    const tile = (name: string, width: number, height: number): CatalogItem => ({
      ...item(name, 0, width, 0),
      kind: "textures",
      height,
    });
    expect(names(sortItems([tile("a", 10, 10), tile("b", 20, 30)], "largest"))).toEqual(["b", "a"]);
  });
});

describe("itemsOfLibrary", () => {
  // A file may hold several catalogs, each with an index of its own
  const libraries = [lib(0, "a.sh3f"), lib(1, "b.sh3f"), lib(2, "b.sh3f")];

  it("takes the items of one library file", () => {
    expect(names(itemsOfLibrary(ITEMS, libraries, "b.sh3f"))).toEqual(["Chair", "Table 2"]);
  });

  it("takes all without a library, or when it is gone", () => {
    expect(itemsOfLibrary(ITEMS, libraries, null)).toBe(ITEMS);
    expect(itemsOfLibrary(ITEMS, libraries, "gone.sh3f")).toBe(ITEMS);
  });
});
