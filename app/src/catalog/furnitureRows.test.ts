import { describe, expect, it } from "vitest";
import { makePiece } from "../testFixtures";
import { type ListedFurniture, listRows, matchesWords, rangeIds } from "./furnitureRows";

const piece = (id: string, name: string, width = 40) =>
  makePiece({ id, name, width, catalog_id: `cat#${name}` }) as ListedFurniture;

describe("listRows", () => {
  const items = [piece("a", "Chair"), piece("b", "Table", 120), piece("c", "Chair")];

  it("lists every piece on its own", () => {
    expect(listRows(items, false).map((r) => r.ids)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("combines equal pieces in the row of the first", () => {
    const rows = listRows(items, true);
    expect(rows.map((r) => r.ids)).toEqual([["a", "c"], ["b"]]);
    expect(rows[0].first.attrs.id).toBe("a");
  });

  it("keeps pieces of another size apart", () => {
    const rows = listRows([piece("a", "Chair"), piece("b", "Chair", 55)], true);
    expect(rows).toHaveLength(2);
  });
});

describe("matchesWords", () => {
  it("finds all words in any of the texts", () => {
    expect(matchesWords(["Oak table", "Living room", "120"], "table living")).toBe(true);
    expect(matchesWords(["Oak table", "120"], "table kitchen")).toBe(false);
    expect(matchesWords(["Oak table"], "  ")).toBe(true);
  });
});

describe("rangeIds", () => {
  const rows = listRows([piece("a", "A"), piece("b", "B"), piece("c", "C")], false);

  it("takes the rows between the two clicks, in both directions", () => {
    expect(rangeIds(rows, 0, 2)).toEqual(["a", "b", "c"]);
    expect(rangeIds(rows, 2, 1)).toEqual(["b", "c"]);
  });
});
