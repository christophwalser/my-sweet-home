import { describe, expect, it } from "vitest";
import { makeHome, makeLevel, makePiece } from "../testFixtures";
import {
  available,
  cellText,
  cellValue,
  compareCells,
  DEFAULT_COLUMNS,
  groupPrices,
  shownColumns,
  toggled,
} from "./furnitureColumns";

const noPrices = { currency: "", vatEnabled: false };
const withVat = { currency: "USD", vatEnabled: true };

describe("furniture columns", () => {
  it("shows the defaults without a stored list, price columns only with a currency", () => {
    const home = makeHome();
    expect(shownColumns(home, noPrices).map((c) => c.id)).toEqual([
      "VISIBLE",
      "NAME",
      "WIDTH",
      "DEPTH",
      "HEIGHT",
      "ELEVATION",
    ]);
    expect(shownColumns(home, withVat).map((c) => c.id)).toContain("PRICE");
    expect(available("VALUE_ADDED_TAX", { currency: "USD", vatEnabled: false })).toBe(false);
    expect(available("VALUE_ADDED_TAX", withVat)).toBe(true);
  });

  it("keeps the stored order and skips unknown names and the level without levels", () => {
    const home = { ...makeHome(), furniture_visible_properties: ["X", "NAME", "BOGUS", "LEVEL"] };
    expect(shownColumns(home, noPrices).map((c) => c.id)).toEqual(["X", "NAME"]);
    const leveled = { ...home, levels: [makeLevel("l1", 0)] };
    expect(shownColumns(leveled, noPrices).map((c) => c.id)).toEqual(["X", "NAME", "LEVEL"]);
  });

  it("switches a column on in Sweet Home 3D's order and off again", () => {
    const home = { ...makeHome(), furniture_visible_properties: ["NAME", "HEIGHT"] };
    expect(toggled(home, "WIDTH")).toEqual(["NAME", "WIDTH", "HEIGHT"]);
    expect(toggled(home, "PRICE")).toEqual(["NAME", "HEIGHT", "PRICE"]);
    expect(toggled(home, "NAME")).toEqual(["HEIGHT"]);
    expect(toggled(makeHome(), "VISIBLE")).toEqual(DEFAULT_COLUMNS.filter((c) => c !== "VISIBLE"));
  });

  it("reads prices, VAT and other cells of pieces and groups", () => {
    const home = makeHome();
    const p = makePiece({ price: "100", value_added_tax_percentage: "0.2", angle: Math.PI / 2 });
    expect(cellValue(p, home, "PRICE")).toBe(100);
    expect(cellValue(p, home, "VALUE_ADDED_TAX_PERCENTAGE")).toBeCloseTo(20);
    expect(cellValue(p, home, "PRICE_VALUE_ADDED_TAX_INCLUDED")).toBeCloseTo(120);
    expect(cellValue(p, home, "ANGLE")).toBe(90);
    expect(cellValue(p, home, "DOOR_OR_WINDOW")).toBe(false);
    const group = {
      type: "group" as const,
      attrs: {
        id: "g",
        level: null,
        name: "Set",
        visible: null,
        x: 0,
        y: 0,
        elevation: 0,
        angle: 0,
        width: 1,
        depth: 1,
        height: 1,
      },
      items: [p, makePiece({ price: "50" }), makePiece()],
    };
    expect(groupPrices(group)).toEqual({ price: 150, vat: 20, withVat: 170 });
    expect(cellValue(group, home, "PRICE")).toBe(150);
  });

  it("formats and sorts cells", () => {
    expect(cellText(12.5, "VALUE_ADDED_TAX_PERCENTAGE", "USD")).toBe("12.5 %");
    expect(cellText(true, "MOVABLE", "USD")).toBe("✓");
    expect(cellText(null, "PRICE", "USD")).toBe("");
    expect(cellText(1234, "PRICE", "USD")).toMatch(/1,234\.00/);
    expect(compareCells(null, 1)).toBeLessThan(0);
    expect(compareCells(2, 10)).toBeLessThan(0);
    expect(compareCells("b", "a")).toBeGreaterThan(0);
  });
});
