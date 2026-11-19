import { describe, expect, it } from "vitest";
import {
  insideOutlines,
  mapBackground,
  northRotation,
  type Outline,
  offsetPosition,
  planMiddle,
  planOutlines,
} from "./northMap";

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

describe("map helpers", () => {
  it("moves a position by meters to the east and south", () => {
    const [lat, lon] = offsetPosition(0, 10, 111_320, 111_320);
    expect(lat).toBeCloseTo(-1);
    expect(lon).toBeCloseTo(11);
    // Degrees of longitude get shorter towards the poles
    expect(offsetPosition(60, 0, 55_660, 0)[1]).toBeCloseTo(1, 3);
  });

  it("tells whether a point lies on the building", () => {
    const outlines: Outline[] = [
      [
        [-50, -20],
        [50, -20],
        [50, 20],
      ],
    ];
    expect(insideOutlines(outlines, 0, 0)).toBe(true);
    expect(insideOutlines(outlines, 60, 0)).toBe(false);
    expect(insideOutlines(outlines, 60, 0, 15)).toBe(true);
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

describe("map as background image", () => {
  it("puts the zero point of the plan where it lies on the image", () => {
    // 1000 pixels of 20 cm, the middle of the walls (500 / 300) in the middle of the image
    expect(mapBackground([500, 300], [0, 0], [0, 0], 0, 1000, 0.2)).toEqual({
      side: 20000,
      xOrigin: 9500,
      yOrigin: 9700,
    });
  });

  it("follows the middle of the image and of the walls on the map", () => {
    // The image lies 10 m east of the walls: the zero point moves to the left on it
    expect(mapBackground([500, 300], [0, 0], [10, 0], 0, 1000, 0.2).xOrigin).toBe(8500);
    // The walls were dragged 10 m east too: as before
    expect(mapBackground([500, 300], [10, 0], [10, 0], 0, 1000, 0.2).xOrigin).toBe(9500);
  });

  it("turns east into the plan with its north direction", () => {
    // North points to the right of the plan: east of the walls is below them in the plan
    const b = mapBackground([500, 300], [0, 0], [10, 0], Math.PI / 2, 1000, 0.2);
    expect(b.xOrigin).toBeCloseTo(9500, 6);
    expect(b.yOrigin).toBeCloseTo(8700, 6);
  });

  it("has the middle of the walls at 0 / 0 without walls", () => {
    expect(planMiddle([])).toEqual([0, 0]);
  });
});
