import { describe, expect, it } from "vitest";
import { resizedPiece } from "./pieceSize";

const size = { width: 100, depth: 50, height: 80 };

describe("piece size", () => {
  it("changes only the given dimension by default", () => {
    expect(resizedPiece(size, "width", 120, false)).toEqual({ width: 120 });
  });

  it("scales all dimensions when keeping the proportions", () => {
    expect(resizedPiece(size, "depth", 75, true)).toEqual({ width: 150, depth: 75, height: 120 });
    expect(resizedPiece(size, "height", 40, true)).toEqual({ width: 50, depth: 25, height: 40 });
  });

  it("keeps only width and depth together for models whose base may not be deformed", () => {
    expect(resizedPiece(size, "width", 50, false, true)).toEqual({ width: 50, depth: 25 });
    expect(resizedPiece(size, "height", 100, false, true)).toEqual({ height: 100 });
  });
});
