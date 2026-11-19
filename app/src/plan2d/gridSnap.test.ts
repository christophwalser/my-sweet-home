import { describe, expect, it } from "vitest";
import type { Pt } from "../model";
import { makeHome, makePiece, makeWall, straightShape } from "../testFixtures";
import { gridAlong, gridAnchor, gridOffset, snapGridStep, toGrid } from "./gridSnap";
import { type SnapContext, snapDraw } from "./snapping";

const ctx = (extra: Partial<SnapContext> = {}): SnapContext => ({
  radius: 10,
  points: [],
  lines: [],
  refs: [],
  directions: [],
  ...extra,
});

describe("snapGridStep", () => {
  it("is 0 while the grid snap is off", () => {
    expect(snapGridStep({ snapGrid: false, gridSpacing: 50 }, 1)).toBe(0);
  });
  it("is the distance of the lines the plan draws", () => {
    expect(snapGridStep({ snapGrid: true, gridSpacing: 50 }, 1)).toBe(50);
    // Automatic: by the zoom
    expect(snapGridStep({ snapGrid: true, gridSpacing: 0 }, 1)).toBe(25);
    expect(snapGridStep({ snapGrid: true, gridSpacing: 0 }, 0.1)).toBe(250);
    // A fixed distance too dense to draw shows (and catches at) every tenth line
    expect(snapGridStep({ snapGrid: true, gridSpacing: 10 }, 0.2)).toBe(100);
  });
});

describe("toGrid", () => {
  it("gives the nearest grid line", () => {
    expect(toGrid(123, 50)).toBe(100);
    expect(toGrid(126, 50)).toBe(150);
    expect(toGrid(-30, 25)).toBe(-25);
    expect(toGrid(12.3, 0)).toBe(12.3);
  });
});

describe("gridAlong", () => {
  it("ends a segment along an axis on the nearest grid line", () => {
    expect(gridAlong([0, 0], [1, 0], 123, 50)).toBe(100);
    expect(gridAlong([0, 0], [0, -1], 130, 50)).toBe(150);
    // The start need not be on the grid: the end is
    expect(gridAlong([7, 0], [1, 0], 100, 50)).toBe(93);
  });
  it("ends a slanted segment where it crosses the nearest grid line", () => {
    const d = Math.SQRT1_2;
    // At 45° from a grid point the lines of both axes are crossed at the grid points
    expect(gridAlong([0, 0], [d, d], 70, 50)).toBeCloseTo(50 * Math.SQRT2, 6);
    // At a flat angle the vertical lines are near, the horizontal ones far apart
    const flat: Pt = [Math.cos(0.1), Math.sin(0.1)];
    expect(gridAlong([0, 0], flat, 98, 50) * flat[0]).toBeCloseTo(100, 6);
  });
  it("never ends at the start", () => {
    // 10 cm from the start the nearest line is the one the start lies on
    expect(gridAlong([0, 0], [1, 0], 10, 50)).toBe(50);
    expect(gridAlong([0, 0], [-1, 0], 10, 50)).toBe(50);
  });
});

describe("moving on the grid", () => {
  it("puts the anchor on the grid in the directions it moves in", () => {
    expect(gridOffset([117, 20], [30, 0], 50)).toEqual([33, 0]);
    expect(gridOffset([117, 20], [30, 12], 50)).toEqual([33, 30]);
    expect(gridOffset([117, 20], [30, 12], 0)).toEqual([30, 12]);
  });
  it("anchors walls at their start and other elements at the corner of their bounds", () => {
    const wall = makeWall("w", [117, 20], [440, 20], { thickness: 40 });
    const piece = makePiece({ id: "p", x: 200, y: 300, width: 80, depth: 40, angle: 0 });
    const home = makeHome({ walls: [wall], furniture: [piece] });
    const shapes = [straightShape(wall)];
    expect(gridAnchor(home, shapes, ["w"])).toEqual([117, 20]);
    expect(gridAnchor(home, shapes, ["p"])).toEqual([160, 280]);
    expect(gridAnchor(home, shapes, ["p", "w"])).toEqual([117, 20]);
    expect(gridAnchor(home, shapes, ["nothing"])).toBeNull();
  });
});

describe("drawing on the grid", () => {
  it("puts the first point on the nearest grid point", () => {
    const s = snapDraw([123, 77], null, ctx({ grid: 50 }));
    expect(s.pt).toEqual([100, 100]);
    expect(s.note).toBe("on the grid");
  });
  it("keeps whole centimeters without the grid snap", () => {
    expect(snapDraw([123.4, 77.2], null, ctx()).pt).toEqual([123, 77]);
  });
  it("ends a segment on a grid line and keeps its direction", () => {
    // Nearly horizontal: the angle magnetism makes it horizontal, the grid sets its length
    const s = snapDraw([123, 3], [0, 0], ctx({ grid: 50 }));
    expect(s.pt[0]).toBeCloseTo(100, 6);
    expect(s.pt[1]).toBeCloseTo(0, 6);
    expect(s.note).toBe("on the grid");
  });
  it("lets a point of an object win over the grid", () => {
    const corner: Pt = [126, 4];
    expect(snapDraw([123, 3], [0, 0], ctx({ grid: 50, points: [corner] })).pt).toEqual(corner);
    expect(snapDraw([123, 3], null, ctx({ grid: 50, points: [corner] })).pt).toEqual(corner);
  });
  it("lets a line of an object win over the grid", () => {
    // A wall face at x = 120: the horizontal segment ends on it, not on the grid line at 100
    const face: [Pt, Pt] = [
      [120, -100],
      [120, 100],
    ];
    const s = snapDraw([123, 3], [0, 0], ctx({ grid: 50, lines: [face] }));
    expect(s.pt[0]).toBeCloseTo(120, 6);
  });
});
