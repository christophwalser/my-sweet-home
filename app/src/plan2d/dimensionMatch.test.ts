import { describe, expect, it } from "vitest";
import { makeDimension, makeHome } from "../testFixtures";
import { existingDimensions, existingHeightDimension } from "./dimensionMatch";

const dims = [
  { start: [0, 0] as [number, number], end: [100, 0] as [number, number], offset: 25 },
  { start: [100, 0] as [number, number], end: [100, 50] as [number, number], offset: 25 },
];

describe("existing dimensions", () => {
  it("finds the dimension lines that measure the dimensions of an element", () => {
    const home = makeHome({
      dimension_lines: [
        makeDimension([0, 0], [100, 0], { id: "d1" }),
        // Drawn the other way round, values rounded when added
        makeDimension([100, 50.1], [100, 0], { id: "d2" }),
      ],
    });
    expect(existingDimensions(home, null, dims)).toEqual(["d1", "d2"]);
  });

  it("finds none while one of them is missing", () => {
    const home = makeHome({ dimension_lines: [makeDimension([0, 0], [100, 0], { id: "d1" })] });
    expect(existingDimensions(home, null, dims)).toBeNull();
    expect(existingDimensions(home, null, [])).toBeNull();
  });

  it("finds a height dimension by its point and elevations", () => {
    const home = makeHome({
      dimension_lines: [
        makeDimension([10, 20], [10, 20], { id: "h", elevation_start: 0, elevation_end: 80 }),
      ],
    });
    expect(existingHeightDimension(home, null, [10, 20], 0, 80)).toBe("h");
    expect(existingHeightDimension(home, null, [10, 20], 0, 90)).toBeNull();
    // A height dimension is no dimension in the plan
    expect(
      existingDimensions(home, null, [{ start: [10, 20], end: [10, 20], offset: 0 }]),
    ).toBeNull();
  });
});
