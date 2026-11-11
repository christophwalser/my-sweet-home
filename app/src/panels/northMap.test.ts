import { describe, expect, it } from "vitest";
import { northRotation, planOutlines } from "./northMap";

describe("planOutlines", () => {
  it("joins both sides of each wall around the middle of all walls", () => {
    const outlines = planOutlines([
      {
        id: "a",
        left: [
          [0, 0],
          [100, 0],
        ],
        right: [
          [0, 10],
          [100, 10],
        ],
      },
      {
        id: "b",
        left: [
          [100, 0],
          [100, 200],
        ],
        right: [
          [110, 0],
          [110, 200],
        ],
      },
    ]);
    expect(outlines).toHaveLength(2);
    // Middle of the box 0..110 × 0..200
    expect(outlines[0]).toEqual([
      [-55, -100],
      [45, -100],
      [45, -90],
      [-55, -90],
    ]);
  });
});

describe("northRotation", () => {
  const close = (a: [number, number], b: [number, number]) => {
    expect(a[0]).toBeCloseTo(b[0]);
    expect(a[1]).toBeCloseTo(b[1]);
  };

  it("turns the north of the plan up", () => {
    // North 90°: north points to the right of the plan (+x)
    close(northRotation(Math.PI / 2)(1, 0), [0, -1]);
    // North 0°: nothing changes
    close(northRotation(0)(3, 4), [3, 4]);
    // North 180°: the bottom of the plan is north
    close(northRotation(Math.PI)(0, 1), [0, -1]);
  });
});
