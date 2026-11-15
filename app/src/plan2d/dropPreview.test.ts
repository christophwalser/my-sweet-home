import { describe, expect, it } from "vitest";
import { makeHome, makeWall, roundPt } from "../testFixtures";
import { dropPreview } from "./dropPreview";

const home = makeHome({ walls: [makeWall("w", [0, 0], [0, 400], { thickness: 20 })] });

describe("drop preview", () => {
  it("centers a piece at its size at the pointer", () => {
    const p = dropPreview(
      home,
      null,
      { width: 80, depth: 40, doorOrWindow: false },
      [200.4, 99.6],
      40,
    );
    expect(p.center).toEqual([200, 100]);
    expect(p.corners.map((c) => roundPt(c))).toEqual([
      [160, 80],
      [240, 80],
      [240, 120],
      [160, 120],
    ]);
  });

  it("puts a door near a wall into the wall, as deep as the wall", () => {
    const p = dropPreview(
      home,
      null,
      { width: 90, depth: 10, doorOrWindow: true },
      [15, 150.3],
      40,
    );
    expect(roundPt(p.center)).toEqual([0, 150]);
    expect(p.angle).toBeCloseTo(Math.PI / 2);
    expect(p.depth).toBe(20);
    // Far from walls it is placed like any piece
    const free = dropPreview(
      home,
      null,
      { width: 90, depth: 10, doorOrWindow: true },
      [300, 150],
      40,
    );
    expect(free.center).toEqual([300, 150]);
  });

  it("shows a piece docked to a wall where the dock puts it", () => {
    const dock = () => ({ x: 30, y: 150, angleDeg: 90 });
    const p = dropPreview(
      home,
      null,
      { width: 80, depth: 40, doorOrWindow: false },
      [35, 150],
      40,
      dock,
    );
    expect(p.center).toEqual([30, 150]);
    expect(p.angle).toBeCloseTo(Math.PI / 2);
    expect(p.corners.map((c) => roundPt(c))).toEqual([
      [50, 110],
      [50, 190],
      [10, 190],
      [10, 110],
    ]);
    // Without a dock nearby the piece stays at the pointer
    const free = dropPreview(
      home,
      null,
      { width: 80, depth: 40, doorOrWindow: false },
      [200, 100],
      40,
      () => null,
    );
    expect(free.center).toEqual([200, 100]);
  });
});
