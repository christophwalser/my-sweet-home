import { describe, expect, it } from "vitest";
import { type Pt, sectionHeightIn } from "../model";
import { makeHome, makePiece } from "../testFixtures";
import { cutTriangles, linesNear } from "./section";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The lines of a cut as [x1, z1, x2, z2] rows, rounded. */
function rows(out: number[]): number[][] {
  const r: number[][] = [];
  for (let i = 0; i < out.length; i += 4) {
    r.push(out.slice(i, i + 4).map((v) => Math.round(v * 1000) / 1000));
  }
  return r;
}

describe("cutting triangles", () => {
  // An upright triangle in the plane z = 5: from the floor at x = 0 and 10 up to 10 at x = 0
  const wall = [0, 0, 5, 10, 0, 5, 0, 10, 5];

  it("gives the line where the plane meets a triangle", () => {
    const out: number[] = [];
    cutTriangles(wall, null, IDENTITY, 4, out);
    // At height 4 the triangle reaches from x = 0 to x = 6
    expect(rows(out)).toEqual([[6, 5, 0, 5]]);
  });

  it("skips triangles above, below and in the plane", () => {
    const out: number[] = [];
    cutTriangles(wall, null, IDENTITY, 12, out);
    cutTriangles(wall, null, IDENTITY, -1, out);
    // A floor at the height of the plane
    cutTriangles([0, 4, 0, 10, 4, 0, 0, 4, 10], null, IDENTITY, 4, out);
    expect(out).toEqual([]);
  });

  it("follows the index and the matrix of the mesh", () => {
    const out: number[] = [];
    // Twice as large and moved 100 to the right and 50 up
    const m = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 100, 50, 0, 1];
    cutTriangles([9, 9, 9, ...wall], [1, 2, 3], m, 58, out);
    // Height 58 is 4 above the bottom of the model, in its own size
    expect(rows(out)).toEqual([[112, 10, 100, 10]]);
  });
});

describe("lines of a cut near the pointer", () => {
  // Two walls of a scanned room: one along y = 0, one along x = 300
  const segments = [0, 0, 300, 0, 300, 0, 300, 200];

  it("returns the lines within reach, nearest first, in plan coordinates", () => {
    const near: Pt = [1150, 508];
    const lines = linesNear(segments, [1000, 500], 0, near, 20);
    expect(lines).toEqual([
      [
        [1000, 500],
        [1300, 500],
      ],
    ]);
    // Near the corner both lines are in reach: the nearer one comes first
    const both = linesNear(segments, [1000, 500], 0, [1297, 510], 20);
    expect(both.map((l) => l[1])).toEqual([
      [1300, 700],
      [1300, 500],
    ]);
  });

  it("turns the lines with the piece", () => {
    // A quarter turn clockwise: the wall along the piece's x runs down the plan
    const lines = linesNear(segments, [0, 0], Math.PI / 2, [5, 100], 20);
    expect(lines).toHaveLength(1);
    expect(lines[0][0][0]).toBeCloseTo(0, 6);
    expect(lines[0][1][0]).toBeCloseTo(0, 6);
    expect(lines[0][1][1]).toBeCloseTo(300, 6);
  });

  it("keeps at most the given number of lines", () => {
    const many: number[] = [];
    for (let i = 0; i < 50; i++) many.push(0, i, 100, i);
    expect(linesNear(many, [0, 0], 0, [50, 0], 100, 10)).toHaveLength(10);
  });
});

describe("height of the cut in a piece", () => {
  const scan = (extra: Record<string, unknown>, properties: { name: string; value: string }[]) =>
    makePiece({ id: "scan", level: "eg", elevation: 20, ...extra }, { properties });
  const reference = { name: "mySweetHome.reference", value: "true" };
  const home = makeHome({});
  home.levels = [
    { attrs: { id: "ug", name: "UG", elevation: -250, floor_thickness: 12, height: 240 } },
    { attrs: { id: "eg", name: "EG", elevation: 0, floor_thickness: 12, height: 250 } },
    { attrs: { id: "og", name: "OG", elevation: 280, floor_thickness: 30, height: 250 } },
  ] as typeof home.levels;

  it("is measured from the floor of the shown level", () => {
    const p = scan({}, [reference, { name: "mySweetHome.sectionHeight", value: "100" }]);
    // The piece stands 20 above the floor of its level
    expect(sectionHeightIn(home, p, "eg")).toBe(80);
    expect(sectionHeightIn(home, p, "og")).toBe(360);
    expect(sectionHeightIn(home, p, "ug")).toBe(-170);
  });

  it("is off without the property or for furniture", () => {
    expect(sectionHeightIn(home, scan({}, [reference]), "eg")).toBeNull();
    const furniture = scan({}, [{ name: "mySweetHome.sectionHeight", value: "100" }]);
    expect(sectionHeightIn(home, furniture, "eg")).toBeNull();
  });
});
