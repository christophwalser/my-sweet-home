// Small geometry helpers of the plan: hit testing, curves, automatic dimensions, the
// visitor handle and furniture standing on furniture.

import { describe, expect, it } from "vitest";
import type { Pt } from "../model";
import { makeHome, makePiece, makeWall, roundPt, straightShape } from "../testFixtures";
import { autoDimensions, dimensionLine } from "./autoDims";
import { curveSegments, polylinePath, sampleCurve } from "./curve";
import { distanceToSegment, isBasePlanPiece, pieceContains, pointInPolygon } from "./interaction";
import { VISITOR_PICK_RADIUS, visitorHandlePos } from "./overlay";
import { dropElevation, surfacesAt } from "./support";

describe("pointInPolygon", () => {
  const l: Pt[] = [
    [0, 0],
    [100, 0],
    [100, 40],
    [40, 40],
    [40, 100],
    [0, 100],
  ];

  it("finds points inside and outside a concave polygon", () => {
    expect(pointInPolygon([20, 20], l)).toBe(true);
    expect(pointInPolygon([20, 80], l)).toBe(true);
    expect(pointInPolygon([80, 80], l)).toBe(false);
    expect(pointInPolygon([-1, 50], l)).toBe(false);
  });

  it("is false for empty polygons", () => {
    expect(pointInPolygon([0, 0], [])).toBe(false);
  });
});

describe("distanceToSegment", () => {
  it("measures to the inside and to the ends of the segment", () => {
    expect(distanceToSegment([50, 30], [0, 0], [100, 0])).toBe(30);
    expect(distanceToSegment([-30, 40], [0, 0], [100, 0])).toBe(50);
  });

  it("measures to the point of a zero-length segment", () => {
    expect(distanceToSegment([3, 4], [0, 0], [0, 0])).toBe(5);
  });
});

describe("pieces", () => {
  it("contains points within its turned footprint", () => {
    const piece = makePiece({ x: 0, y: 0, width: 100, depth: 20, angle: Math.PI / 2 });
    expect(pieceContains(piece, [0, 45])).toBe(true);
    expect(pieceContains(piece, [45, 0])).toBe(false);
  });

  it("uses the plan size of tilted pieces", () => {
    const piece = makePiece({ width: 100, depth: 20, width_in_plan: 100, depth_in_plan: 60 });
    expect(pieceContains(piece, [0, 25])).toBe(true);
  });

  it("counts doors, windows and fixed furniture to the base plan", () => {
    expect(isBasePlanPiece(makePiece({}, { kind: "DoorOrWindow" }))).toBe(true);
    expect(isBasePlanPiece(makePiece({ movable: false }))).toBe(true);
    expect(isBasePlanPiece(makePiece())).toBe(false);
  });
});

describe("curves", () => {
  const pts: Pt[] = [
    [0, 0],
    [100, 0],
    [100, 100],
  ];

  it("has no segments for fewer than two points", () => {
    expect(curveSegments([[0, 0]], false)).toEqual([]);
    expect(sampleCurve([[0, 0]], false)).toEqual([[0, 0]]);
  });

  it("has one segment per gap, one more when closed", () => {
    expect(curveSegments(pts, false)).toHaveLength(2);
    expect(curveSegments(pts, true)).toHaveLength(3);
  });

  it("is a straight line between two points", () => {
    const [[c1, c2, end]] = curveSegments(
      [
        [0, 0],
        [60, 0],
      ],
      false,
    );
    expect(c1).toEqual([10, 0]);
    expect(c2).toEqual([50, 0]);
    expect(end).toEqual([60, 0]);
  });

  it("passes through all points", () => {
    const sampled = sampleCurve(pts, false, 4);
    expect(sampled).toHaveLength(9);
    expect(sampled[0]).toEqual([0, 0]);
    expect(roundPt(sampled[4])).toEqual([100, 0]);
    expect(roundPt(sampled[8])).toEqual([100, 100]);
  });

  it("samples only curved polylines with more than two points", () => {
    const points = pts.map(([x, y]) => ({ x, y }));
    expect(polylinePath(points, null, false)).toEqual(pts);
    expect(polylinePath(points.slice(0, 2), "CURVED", false)).toEqual(pts.slice(0, 2));
    expect(polylinePath(points, "CURVED", false)).toHaveLength(25);
  });
});

describe("autoDimensions", () => {
  it("measures a single wall on the side of its normal", () => {
    const w = makeWall("w", [0, 0], [200, 0]);
    const dims = autoDimensions(makeHome({ walls: [w] }), [straightShape(w)], "w");
    expect(dims).toEqual([{ start: [0, 0], end: [200, 0], offset: 30 }]);
  });

  it("puts the dimension away from the joined walls", () => {
    const w = makeWall("w", [0, 0], [200, 0], { wall_at_end: "j" });
    // The joined wall goes to +y, the side of a positive offset
    const j = makeWall("j", [200, 0], [200, 100], { wall_at_start: "w" });
    const home = makeHome({ walls: [w, j] });
    expect(autoDimensions(home, home.walls.map(straightShape), "w")[0].offset).toBe(-30);
  });

  it("measures no arc walls and no zero-length walls", () => {
    const arc = makeWall("a", [0, 0], [200, 0], { arc_extent: 1 });
    const dot = makeWall("d", [5, 5], [5, 5]);
    const home = makeHome({ walls: [arc, dot] });
    const shapes = home.walls.map(straightShape);
    expect(autoDimensions(home, shapes, "a")).toEqual([]);
    expect(autoDimensions(home, shapes, "d")).toEqual([]);
  });

  it("measures the width and depth of a piece", () => {
    const piece = makePiece({ id: "p", width: 100, depth: 50 });
    const dims = autoDimensions(makeHome({ furniture: [piece] }), [], "p");
    expect(dims).toEqual([
      { start: [-50, -25], end: [50, -25], offset: -25 },
      { start: [50, -25], end: [50, 25], offset: -25 },
    ]);
  });

  it("has nothing for unknown elements", () => {
    expect(autoDimensions(makeHome(), [], "x")).toEqual([]);
  });

  it("moves the drawn line by the offset along the left normal", () => {
    expect(
      dimensionLine({ start: [0, 0], end: [100, 0], offset: 20 }).map((p) => roundPt(p)),
    ).toEqual([
      [0, 20],
      [100, 20],
    ]);
    // A zero-length dimension does not produce NaN
    expect(dimensionLine({ start: [5, 5], end: [5, 5], offset: 20 })).toEqual([
      [5, 5],
      [5, 5],
    ]);
  });
});

describe("visitorHandlePos", () => {
  it("sits in front of the visitor, farther away when zoomed out", () => {
    expect(visitorHandlePos({ x: 10, y: 20, yaw: 0 }, 1)).toEqual([
      10,
      20 + VISITOR_PICK_RADIUS + 18,
    ]);
    const turned = roundPt(visitorHandlePos({ x: 0, y: 0, yaw: Math.PI / 2 }, 2));
    expect(turned).toEqual([-(VISITOR_PICK_RADIUS + 36), 0]);
  });
});

describe("furniture standing on furniture", () => {
  const table = makePiece({ id: "table", name: "Table", width: 150, depth: 80, height: 75 });
  const vase = makePiece({ id: "vase", name: "Vase", width: 10, depth: 10, height: 30 });

  it("finds the top of a larger piece under the point", () => {
    const home = makeHome({ furniture: [table, vase] });
    expect(surfacesAt(home, vase, [0, 0])).toEqual([{ elevation: 75, label: "on Table" }]);
    expect(surfacesAt(home, vase, [100, 0])).toEqual([]);
  });

  it("does not put larger pieces on smaller ones", () => {
    const home = makeHome({ furniture: [table, vase] });
    expect(surfacesAt(home, table, [0, 0])).toEqual([]);
  });

  it("ignores doors, lights and pieces on other levels", () => {
    const door = makePiece({ id: "door", width: 300, depth: 300 }, { kind: "DoorOrWindow" });
    const other = makePiece({ id: "other", width: 300, depth: 300, level: "up" });
    expect(surfacesAt(makeHome({ furniture: [door, other, vase] }), vase, [0, 0])).toEqual([]);
  });

  it("lists shelves lowest first", () => {
    const shelf = makePiece(
      { id: "shelf", name: "Shelf", width: 100, depth: 40, height: 200 },
      { kind: "ShelfUnit", shelves: [{ elevation: 0.5 }, { elevation: 0.25 }] },
    );
    const elevations = surfacesAt(makeHome({ furniture: [shelf, vase] }), vase, [0, 0]).map(
      (s) => s.elevation,
    );
    expect(elevations).toEqual([50, 100, 200]);
  });

  it("drops a moved piece onto the support below it", () => {
    const home = makeHome({ furniture: [table, vase] });
    expect(dropElevation(home, vase, [10, 10])).toEqual({ elevation: 75, label: "on Table" });
  });

  it("drops onto the shelf nearest to the current elevation", () => {
    const shelf = makePiece(
      { id: "shelf", name: "Shelf", width: 100, depth: 40, height: 200 },
      { kind: "ShelfUnit", shelves: [{ elevation: 0.5 }, { elevation: 0.25 }] },
    );
    const raised = { ...vase, attrs: { ...vase.attrs, x: 500, elevation: 90 } };
    const home = makeHome({ furniture: [shelf, raised] });
    expect(dropElevation(home, raised, [0, 0])?.elevation).toBe(100);
  });

  it("puts a piece back on the floor when it leaves its support", () => {
    const onTable = { ...vase, attrs: { ...vase.attrs, elevation: 75 } };
    const home = makeHome({ furniture: [table, onTable] });
    expect(dropElevation(home, onTable, [500, 500])).toEqual({
      elevation: 0,
      label: "on the floor",
    });
  });

  it("changes nothing when the elevation stays", () => {
    const onTable = { ...vase, attrs: { ...vase.attrs, elevation: 75 } };
    const home = makeHome({ furniture: [table, onTable] });
    expect(dropElevation(home, onTable, [10, 10])).toBeNull();
    expect(dropElevation(makeHome({ furniture: [vase] }), vase, [500, 500])).toBeNull();
  });

  it("never moves doors and windows up", () => {
    const door = makePiece({ id: "door", width: 10, depth: 10 }, { kind: "DoorOrWindow" });
    expect(dropElevation(makeHome({ furniture: [table, door] }), door, [0, 0])).toBeNull();
  });
});
