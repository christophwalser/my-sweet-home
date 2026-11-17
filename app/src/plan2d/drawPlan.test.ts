import { describe, expect, it } from "vitest";
import { type Pt, REFERENCE_PROPERTY } from "../model";
import {
  makeDimension,
  makeHome,
  makeLevel,
  makePiece,
  makeRoom,
  makeWall,
  roundPt,
  straightShape,
} from "../testFixtures";
import {
  backgroundImageOf,
  boundsCenter,
  labelCenter,
  levelBelow,
  planBounds,
  roomLabelPositions,
  sameLevel,
} from "./drawPlan";
import { pointInPolygon } from "./interaction";

describe("sameLevel", () => {
  it("shows everything without a selected level", () => {
    expect(sameLevel("a", null)).toBe(true);
    expect(sameLevel(null, null)).toBe(true);
  });

  it("compares the level otherwise", () => {
    expect(sameLevel("a", "a")).toBe(true);
    expect(sameLevel("a", "b")).toBe(false);
    expect(sameLevel(null, "b")).toBe(false);
  });
});

describe("levelBelow", () => {
  const home = makeHome({
    levels: [
      makeLevel("ground", 0),
      makeLevel("mezzanine", 0, { elevation_index: 1 }),
      makeLevel("first", 250),
    ],
  });

  it("finds the next lower level", () => {
    expect(levelBelow(home, "first")).toBe("mezzanine");
  });

  it("orders levels at the same elevation by their index", () => {
    expect(levelBelow(home, "mezzanine")).toBe("ground");
  });

  it("has nothing below the lowest or an unknown level", () => {
    expect(levelBelow(home, "ground")).toBeNull();
    expect(levelBelow(home, "nope")).toBeNull();
    expect(levelBelow(home, null)).toBeNull();
  });
});

describe("boundsCenter", () => {
  it("is the center of the bounding box", () => {
    expect(
      boundsCenter([
        [0, 0],
        [100, 10],
        [40, 50],
      ]),
    ).toEqual([50, 25]);
  });
});

describe("labelCenter", () => {
  it("is [0, 0] without points", () => {
    expect(labelCenter([])).toEqual([0, 0]);
  });

  it("is the centroid of convex rooms, in either orientation", () => {
    const square: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    expect(roundPt(labelCenter(square))).toEqual([50, 50]);
    expect(roundPt(labelCenter([...square].reverse()))).toEqual([50, 50]);
  });

  it("weights the area, not the points", () => {
    // A triangle with an extra point on one edge
    const tri: Pt[] = [
      [0, 0],
      [60, 0],
      [90, 0],
      [0, 90],
    ];
    expect(roundPt(labelCenter(tri))).toEqual([30, 30]);
  });

  it("uses the mean of the points for degenerate rooms", () => {
    expect(
      labelCenter([
        [0, 0],
        [10, 0],
        [20, 0],
      ]),
    ).toEqual([10, 0]);
  });

  it("finds a point inside strongly concave rooms", () => {
    // A thin U: the centroid lies in the gap between the arms
    const u: Pt[] = [
      [0, 0],
      [20, 0],
      [20, 180],
      [180, 180],
      [180, 0],
      [200, 0],
      [200, 200],
      [0, 200],
    ];
    const c = labelCenter(u);
    expect(pointInPolygon(c, u)).toBe(true);
  });
});

describe("roomLabelPositions", () => {
  const pts: Pt[] = [
    [0, 0],
    [200, 0],
    [200, 100],
    [0, 100],
  ];

  it("puts the name 40 cm above the area by default", () => {
    const { name, area } = roomLabelPositions(makeRoom(pts));
    expect(roundPt(area)).toEqual([100, 50]);
    expect(roundPt(name)).toEqual([100, 10]);
  });

  it("places stored offsets from the bounding box center", () => {
    const { name, area } = roomLabelPositions(
      makeRoom(pts, { name_x_offset: 10, name_y_offset: null, area_y_offset: -5 }),
    );
    expect(name).toEqual([110, 50]);
    expect(area).toEqual([100, 45]);
  });
});

describe("planBounds", () => {
  const input = (home: ReturnType<typeof makeHome>) => ({
    home,
    wallShapes: home.walls.map(straightShape),
    levelId: null,
    icons: new Map(),
  });

  it("is null for an empty home", () => {
    expect(planBounds(input(makeHome()))).toBeNull();
  });

  it("fits to the walls only, when there are walls", () => {
    const home = makeHome({
      walls: [makeWall("w", [0, 0], [100, 0])],
      rooms: [makeRoom([[-50, 20]])],
      furniture: [makePiece({ x: 300, y: 300 })],
    });
    expect(planBounds(input(home))).toEqual([0, -5, 100, 5]);
  });

  it("covers rooms and furniture centers without walls", () => {
    const home = makeHome({
      rooms: [makeRoom([[-50, 20]])],
      furniture: [makePiece({ x: 300, y: 300 })],
    });
    expect(planBounds(input(home))).toEqual([-50, 20, 300, 300]);
  });

  it("fits to the building, not to reference objects such as terrain", () => {
    const terrain = makePiece(
      { id: "terrain", x: 5000, y: 5000 },
      { properties: [{ name: REFERENCE_PROPERTY, value: "true" }] },
    );
    const home = makeHome({ walls: [makeWall("w", [0, 0], [100, 0])], furniture: [terrain] });
    expect(planBounds(input(home))).toEqual([0, -5, 100, 5]);
    // Only terrain yet: fit to it
    expect(planBounds(input(makeHome({ furniture: [terrain] })))).toEqual([5000, 5000, 5000, 5000]);
  });

  it("includes the offset of dimension lines", () => {
    const home = makeHome({ dimension_lines: [makeDimension([0, 0], [100, 0], { offset: 30 })] });
    expect(planBounds(input(home))?.map((v) => v + 0)).toEqual([0, 30, 100, 30]);
  });

  it("leaves out elements of other levels", () => {
    const home = makeHome({
      levels: [makeLevel("a", 0), makeLevel("b", 300)],
      rooms: [makeRoom([[0, 0]], { level: "a" }), makeRoom([[500, 500]], { level: "b" })],
    });
    expect(planBounds({ ...input(home), levelId: "a" })).toEqual([0, 0, 0, 0]);
  });

  it("includes a visible compass", () => {
    const compass = {
      attrs: {
        x: 0,
        y: 0,
        diameter: 100,
        north_direction: 0,
        latitude: null,
        longitude: null,
        visible: true,
      },
    };
    expect(planBounds(input(makeHome({ compass })))).toEqual([-50, -100, 50, 50]);
    const hidden = { attrs: { ...compass.attrs, visible: false } };
    expect(planBounds(input(makeHome({ compass: hidden })))).toBeNull();
  });
});

describe("backgroundImageOf", () => {
  const image = {
    image: "plan.png",
    scale_distance: 100,
    scale_distance_x_start: 0,
    scale_distance_y_start: 0,
    scale_distance_x_end: 50,
    scale_distance_y_end: 0,
    x_origin: null,
    y_origin: null,
    visible: null,
  };

  it("uses the home's image without levels", () => {
    expect(backgroundImageOf(makeHome({ background_image: image }), null)).toBe(image);
  });

  it("uses the level's image with levels", () => {
    const level = { ...makeLevel("a", 0), background_image: image };
    const home = makeHome({ levels: [level, makeLevel("b", 250)], background_image: null });
    expect(backgroundImageOf(home, "a")).toBe(image);
    expect(backgroundImageOf(home, "b")).toBeNull();
  });
});
