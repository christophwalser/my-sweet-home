import { describe, expect, it } from "vitest";
import { REFERENCE_PROPERTY } from "../model";
import {
  makeHome,
  makePiece,
  makePolyline,
  makeRoom,
  makeWall,
  straightShape,
} from "../testFixtures";
import { elementsInRect, hitTest, hitTestAll, rectSelection } from "./interaction";

describe("rectSelection", () => {
  it("takes only what lies inside as a window", () => {
    const r = rectSelection([0, 0], [100, 100], false);
    expect(r.point([50, 50])).toBe(true);
    expect(r.segment([10, 10], [90, 90])).toBe(true);
    expect(r.segment([10, 10], [150, 10])).toBe(false);
  });

  it("also takes what it touches when crossing", () => {
    const r = rectSelection([100, 100], [0, 0], true);
    expect(r.segment([-50, 50], [150, 50])).toBe(true);
    expect(r.segment([-50, -50], [-10, 150])).toBe(false);
    // A polygon around the whole band is touched too
    expect(
      r.polygon([
        [-100, -100],
        [200, -100],
        [200, 200],
        [-100, 200],
      ]),
    ).toBe(true);
  });
});

describe("elementsInRect", () => {
  const wall = makeWall("w", [0, 0], [400, 0]);
  const room = makeRoom(
    [
      [0, 0],
      [400, 0],
      [400, 300],
      [0, 300],
    ],
    { id: "r" },
  );
  const piece = makePiece({ id: "p", x: 200, y: 150, width: 100, depth: 60 });
  const line = makePolyline(
    [
      [50, 250],
      [350, 250],
    ],
    { id: "l" },
  );
  const home = makeHome({ walls: [wall], rooms: [room], furniture: [piece], polylines: [line] });

  it("selects elements inside the band", () => {
    expect(elementsInRect(home, null, [-10, -10], [410, 310]).sort()).toEqual(
      ["l", "p", "r", "w"].sort(),
    );
    expect(elementsInRect(home, null, [100, 100], [300, 200])).toEqual(["p"]);
  });

  it("selects what a band dragged to the left touches", () => {
    expect(elementsInRect(home, null, [240, 260], [160, 140], true).sort()).toEqual(
      ["l", "p", "r"].sort(),
    );
    // As a window only the piece, whose center is inside
    expect(elementsInRect(home, null, [240, 260], [160, 140], false)).toEqual(["p"]);
  });
});

describe("hitTestAll", () => {
  it("lists all elements under the point, the one a click selects first", () => {
    const wall = makeWall("w", [0, 0], [400, 0]);
    const room = makeRoom(
      [
        [0, 0],
        [400, 0],
        [400, 300],
        [0, 300],
      ],
      { id: "r" },
    );
    const piece = makePiece({ id: "p", x: 200, y: 150, width: 100, depth: 60 });
    const home = makeHome({ walls: [wall], rooms: [room], furniture: [piece] });
    const shapes = [straightShape(wall)];
    expect(hitTestAll(home, shapes, null, [200, 150], 2).map((h) => h.id)).toEqual(["p", "r"]);
    expect(hitTest(home, shapes, null, [200, 150], 2)?.id).toBe("p");
    expect(hitTestAll(home, shapes, null, [100, 2], 2).map((h) => h.id)).toEqual(["w", "r"]);
    expect(hitTestAll(home, shapes, null, [900, 900], 2)).toEqual([]);
  });
});

describe("reference objects", () => {
  it("are neither hit by a click nor selected by a band", () => {
    const terrain = {
      ...makePiece({ id: "t", x: 0, y: 0, width: 20000, depth: 20000 }),
      properties: [{ name: REFERENCE_PROPERTY, value: "true" }],
    };
    const chair = makePiece({ id: "c", x: 100, y: 100, width: 40, depth: 40 });
    const home = makeHome({ furniture: [terrain, chair] });
    expect(hitTest(home, [], null, [500, 500], 5)).toBeNull();
    expect(hitTest(home, [], null, [100, 100], 5)?.id).toBe("c");
    expect(elementsInRect(home, null, [-15000, -15000], [15000, 15000], true)).toEqual(["c"]);
  });
});
