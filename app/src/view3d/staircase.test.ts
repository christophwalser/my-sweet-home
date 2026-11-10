import { describe, expect, it } from "vitest";
import { makeHome, makeLevel, makePiece, roundPt } from "../testFixtures";
import { levelInfos } from "./buildScene";
import { cutOutOutlines, holesAt, parseSvgPath, staircases } from "./staircase";

describe("parseSvgPath", () => {
  it("is empty for empty or invalid paths", () => {
    expect(parseSvgPath("")).toEqual([]);
    expect(parseSvgPath("1 2 3")).toEqual([]);
  });

  it("reads absolute lines and closes outlines", () => {
    expect(parseSvgPath("M0,0 L1,0 L1,1 Z")).toEqual([
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    ]);
  });

  it("drops outlines with fewer than three points", () => {
    expect(parseSvgPath("M0,0 L1,0 Z")).toEqual([]);
  });

  it("reads relative commands and horizontal / vertical lines", () => {
    expect(parseSvgPath("m0.5,0.5 h0.25 v0.25 H0.5 z")).toEqual([
      [
        [0.5, 0.5],
        [0.75, 0.5],
        [0.75, 0.75],
        [0.5, 0.75],
      ],
    ]);
  });

  it("treats further pairs after M as lines", () => {
    expect(parseSvgPath("M0 0 1 0 1 1")).toEqual([
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    ]);
  });

  it("reads several outlines and numbers without separators", () => {
    const outlines = parseSvgPath("M0,0L1,0L1,1ZM2-1L3-1L3,0Z");
    expect(outlines).toHaveLength(2);
    expect(outlines[1][0]).toEqual([2, -1]);
  });

  it("reads exponents", () => {
    expect(parseSvgPath("M0,0 L1e-1,0 L1E0,1 Z")[0][1]).toEqual([0.1, 0]);
  });

  it("splits curves into line segments ending at the end point", () => {
    const [outline] = parseSvgPath("M0,0 C0,1 1,1 1,0 Z");
    expect(outline).toHaveLength(13);
    expect(roundPt(outline[outline.length - 1])).toEqual([1, 0]);
    // The middle of this symmetric curve lies at 0.75 height
    expect(roundPt(outline[6])).toEqual([0.5, 0.75]);
  });

  it("splits elliptical arcs into points on the circle", () => {
    const [outline] = parseSvgPath("M0,0 A1,1 0 0,1 2,0 Z");
    expect(roundPt(outline[outline.length - 1])).toEqual([2, 0]);
    for (const p of outline) expect(Math.hypot(p[0] - 1, p[1])).toBeCloseTo(1);
  });

  it("skips the numbers of unknown commands", () => {
    expect(parseSvgPath("M0,0 L1,0 X 5 5 L1,1 Z")[0]).toHaveLength(3);
  });
});

describe("staircase cut-outs", () => {
  const stairs = makePiece({
    x: 100,
    y: 200,
    width: 100,
    depth: 300,
    height: 260,
    staircase_cut_out_shape: "M0,0 L0.5,0 L0.5,1 L0,1 Z",
  });

  it("stretches the shape over the piece and places it like the piece", () => {
    const [outline] = cutOutOutlines(stairs);
    expect(outline.map((p) => roundPt(p))).toEqual([
      [50, 50],
      [100, 50],
      [100, 350],
      [50, 350],
    ]);
  });

  it("mirrors the shape with the model", () => {
    const mirrored = { ...stairs, attrs: { ...stairs.attrs, model_mirrored: true } };
    const xs = cutOutOutlines(mirrored)[0].map((p) => Math.round(p[0]));
    expect(Math.min(...xs)).toBe(100);
    expect(Math.max(...xs)).toBe(150);
  });

  it("has no outlines for other pieces", () => {
    expect(cutOutOutlines(makePiece())).toEqual([]);
  });

  it("cuts the floors it reaches through", () => {
    const home = makeHome({
      levels: [makeLevel("ground", 0), makeLevel("first", 250)],
      furniture: [{ ...stairs, attrs: { ...stairs.attrs, level: "ground" } }],
    });
    const list = staircases(home, levelInfos(home));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ bottom: 0, top: 260 });
    expect(holesAt(list, 250)).toHaveLength(1);
    expect(holesAt(list, 0)).toEqual([]);
    expect(holesAt(list, 500)).toEqual([]);
  });

  it("leaves out hidden staircases", () => {
    const hidden = { ...stairs, attrs: { ...stairs.attrs, visible: false } };
    const home = makeHome({ furniture: [hidden] });
    expect(staircases(home, levelInfos(home))).toEqual([]);
  });
});
