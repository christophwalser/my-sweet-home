import { describe, expect, it } from "vitest";
import { decimal, formatMoney, piecePrice, total } from "./prices";
import { makePiece } from "./testFixtures";

describe("prices", () => {
  it("reads the decimal strings of the file", () => {
    expect(decimal("12.5")).toBe(12.5);
    expect(decimal("")).toBeNull();
    expect(decimal(null)).toBeNull();
    expect(decimal("abc")).toBeNull();
  });

  it("computes VAT from the stored fraction", () => {
    const p = makePiece({ price: "200", value_added_tax_percentage: "0.081" });
    const r = piecePrice(p);
    expect(r.price).toBe(200);
    expect(r.vat).toBeCloseTo(16.2);
    expect(r.withVat).toBeCloseTo(216.2);
    expect(piecePrice(makePiece({ price: "50" })).withVat).toBe(50);
    expect(piecePrice(makePiece()).price).toBeNull();
  });

  it("sums only known values", () => {
    expect(total([1, null, 2.5])).toBe(3.5);
    expect(total([null])).toBeNull();
  });

  it("formats amounts in the currency", () => {
    expect(formatMoney(1250, "USD")).toMatch(/1,250\.00/);
    expect(formatMoney(null, "USD")).toBe("");
    expect(formatMoney(3, "XXQ")).toMatch(/3\.00/);
  });
});
