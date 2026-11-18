import { describe, expect, it } from "vitest";
import { makeHome, makeLevel } from "../testFixtures";
import {
  GUIDES_PROPERTY,
  guideAngle,
  guideAt,
  guideDash,
  guideEnd,
  guideLength,
  guidesInRect,
  homeGuides,
  levelGuides,
  movedGuides,
} from "./guides";

const guides = [
  { id: "g1", level: "a", x_start: 0, y_start: 0, x_end: 100, y_end: 0 },
  { id: "g2", level: "b", x_start: 0, y_start: 50, x_end: 0, y_end: 150 },
];
const home = {
  ...makeHome({ levels: [makeLevel("a", 0), makeLevel("b", 250)] }),
  properties: [{ name: GUIDES_PROPERTY, value: JSON.stringify(guides) }],
};

describe("guides", () => {
  it("reads the guides of the home and of a level", () => {
    expect(homeGuides(home).map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(levelGuides(home, "b").map((g) => g.id)).toEqual(["g2"]);
    expect(homeGuides(makeHome())).toEqual([]);
    expect(
      homeGuides({ ...makeHome(), properties: [{ name: GUIDES_PROPERTY, value: "{" }] }),
    ).toEqual([]);
  });

  it("shows a guide on all levels when it is marked so", () => {
    const all = [...guides, { ...guides[0], id: "g3", all_levels: true }];
    const h = { ...home, properties: [{ name: GUIDES_PROPERTY, value: JSON.stringify(all) }] };
    expect(levelGuides(h, "b").map((g) => g.id)).toEqual(["g2", "g3"]);
    expect(levelGuides(h, "a").map((g) => g.id)).toEqual(["g1", "g3"]);
  });

  it("finds a guide near a point and inside a rectangle", () => {
    expect(guideAt(home, "a", [50, 3], 5)?.id).toBe("g1");
    expect(guideAt(home, "a", [50, 8], 5)).toBeNull();
    expect(guideAt(home, "b", [50, 3], 5)).toBeNull();
    expect(guidesInRect(home, "a", [-10, -10], [110, 10]).map((g) => g.id)).toEqual(["g1"]);
    expect(guidesInRect(home, "a", [-10, -10], [50, 10])).toEqual([]);
  });

  it("shows guides moved with the selection and with a dragged end", () => {
    const moved = movedGuides(guides, ["g1"], [10, 5], null);
    expect([moved[0].x_start, moved[0].y_end]).toEqual([10, 5]);
    expect(moved[1]).toBe(guides[1]);
    const dragged = movedGuides(guides, [], [0, 0], { id: "g2", x_end: 40, y_end: 160 });
    expect([dragged[1].x_start, dragged[1].y_start, dragged[1].x_end, dragged[1].y_end]).toEqual([
      0, 50, 40, 160,
    ]);
  });

  it("gives length and direction of a guide and moves its end to new ones", () => {
    expect(guideLength(guides[0])).toBe(100);
    expect(guideAngle(guides[0])).toBe(0);
    expect(guideAngle(guides[1])).toBe(90);
    expect(guideAngle({ ...guides[0], y_end: -100 })).toBe(315);
    expect(guideEnd(guides[1], 50, 0)).toEqual([50, 50]);
    expect(guideEnd(guides[0], 200, 90)).toEqual([0, 200]);
  });

  it("has a dash pattern per dash style, dashed by default", () => {
    expect(guideDash("SOLID")).toEqual([]);
    expect(guideDash(undefined)).toEqual(guideDash("DASH"));
    expect(guideDash("DASH_DOT")).toHaveLength(4);
    expect(guideDash("DASH_DOT_DOT")).toHaveLength(6);
  });
});
