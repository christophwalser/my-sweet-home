import { describe, expect, it } from "vitest";
import type { Pt } from "../model";
import { edgeOffset, insertCorner, moveEdge, snapCorner } from "./roomEdit";

const square: Pt[] = [
  [0, 0],
  [400, 0],
  [400, 300],
  [0, 300],
];

describe("snapCorner", () => {
  it("makes right angles to both neighboring edges where they cross", () => {
    // Corner 2 of the square dragged near its place: back to the right angles
    const s = snapCorner([404, 296], [0, 0], [400, 0], [0, 300], [0, 0], 10);
    expect(s?.pt[0]).toBeCloseTo(400);
    expect(s?.pt[1]).toBeCloseTo(300);
    expect(s?.guides).toHaveLength(2);
  });

  it("snaps onto one line when only one is near", () => {
    // Far from the crossing, but close to the right angle at the previous corner
    const s = snapCorner([403, 150], [0, 0], [400, 0], [0, 300], [0, 0], 10);
    expect(s?.pt[0]).toBeCloseTo(400);
    expect(s?.pt[1]).toBeCloseTo(150);
    expect(s?.note).toBe("90° to edge");
  });

  it("leaves points far from all lines alone", () => {
    expect(snapCorner([300, 150], [0, 0], [400, 0], [0, 300], [0, 0], 10)).toBeNull();
  });
});

describe("insertCorner and moveEdge", () => {
  it("inserts a corner after the edge start", () => {
    expect(insertCorner(square, 1, [450, 150])).toEqual([
      [0, 0],
      [400, 0],
      [450, 150],
      [400, 300],
      [0, 300],
    ]);
  });

  it("moves an edge parallel along its left normal", () => {
    // Edge 1 runs down (400,0)→(400,300); its left normal (y down) points to +x
    expect(moveEdge(square, 1, 20)).toEqual([
      [0, 0],
      [420, 0],
      [420, 300],
      [0, 300],
    ]);
    expect(edgeOffset([400, 0], [400, 300], [420, 150])).toBeCloseTo(20);
    // The last edge wraps around to the first point
    expect(moveEdge(square, 3, 10)[0]).toEqual([-10, 0]);
  });
});
