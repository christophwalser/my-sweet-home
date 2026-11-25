import { describe, expect, it } from "vitest";
import { tileHeight } from "./tileSize";

describe("tileHeight", () => {
  it("follows the proportions of the image", () => {
    expect(tileHeight(100, 2)).toBe(50);
    expect(tileHeight(100, 0.5)).toBe(200);
    expect(tileHeight(100, 3)).toBe(33.33);
  });

  it("is a square without known proportions", () => {
    expect(tileHeight(80, null)).toBe(80);
    expect(tileHeight(80, 0)).toBe(80);
    expect(tileHeight(80, Number.NaN)).toBe(80);
  });
});
