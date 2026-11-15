import { describe, expect, it } from "vitest";
import {
  backgroundScale,
  cssColor,
  type FurnitureGroup,
  forEachGroup,
  forEachPiece,
  isReference,
  onLevel,
  type Piece,
  pieceAtLevel,
  pieceIsBackdrop,
  piecePickable,
  piecesWithTop,
  REFERENCE_PROPERTY,
  wallAtLevel,
  wallPolygon,
} from "./model";
import { makeHome, makeLevel, makePiece, makeWall } from "./testFixtures";

function group(
  id: string,
  items: (Piece | FurnitureGroup)[],
  visible: boolean | null = null,
): FurnitureGroup {
  return {
    type: "group",
    attrs: {
      id,
      level: null,
      name: id,
      visible,
      x: null,
      y: null,
      elevation: null,
      angle: null,
      width: null,
      depth: null,
      height: null,
    },
    items,
  };
}

describe("backgroundScale", () => {
  const image = {
    image: "plan.png",
    scale_distance: 500,
    scale_distance_x_start: 10,
    scale_distance_y_start: 10,
    scale_distance_x_end: 40,
    scale_distance_y_end: 50,
    x_origin: null,
    y_origin: null,
    visible: null,
  };

  it("is the real length per image pixel of the scale marker", () => {
    expect(backgroundScale(image)).toBe(10);
  });

  it("falls back to 1 for a marker without length", () => {
    expect(backgroundScale({ ...image, scale_distance_x_end: 10, scale_distance_y_end: 10 })).toBe(
      1,
    );
  });
});

describe("cssColor", () => {
  it("drops the alpha channel", () => {
    expect(cssColor(0xff336699, "#000")).toBe("#336699");
    expect(cssColor(0x0000ff, "#000")).toBe("#0000ff");
    expect(cssColor(0, "#000")).toBe("#000000");
  });

  it("uses the fallback without a color", () => {
    expect(cssColor(null, "#abc")).toBe("#abc");
    expect(cssColor(undefined, "#abc")).toBe("#abc");
  });
});

describe("furniture traversal", () => {
  const a = makePiece({ id: "a" });
  const b = makePiece({ id: "b" });
  const hidden = makePiece({ id: "hidden", visible: false });
  const inner = group("inner", [b, hidden]);
  const outer = group("outer", [inner]);
  const invisible = group("invisible", [makePiece({ id: "c" })], false);

  it("visits visible pieces inside groups", () => {
    const ids: (string | null)[] = [];
    forEachPiece([a, outer, invisible], (p) => ids.push(p.attrs.id));
    expect(ids).toEqual(["a", "b"]);
  });

  it("reports the top-level element of each piece", () => {
    const tops = piecesWithTop([a, outer, invisible]).map((x) => [x.piece.attrs.id, x.topId]);
    expect(tops).toEqual([
      ["a", "a"],
      ["b", "outer"],
    ]);
  });

  it("visits all groups recursively", () => {
    const ids: (string | null)[] = [];
    forEachGroup([a, outer, invisible], (g) => ids.push(g.attrs.id));
    expect(ids).toEqual(["outer", "inner", "invisible"]);
  });
});

describe("wallPolygon", () => {
  it("runs along the left side and back along the right side", () => {
    expect(
      wallPolygon({
        id: "w",
        left: [
          [0, -5],
          [100, -5],
        ],
        right: [
          [0, 5],
          [100, 5],
        ],
      }),
    ).toEqual([
      [0, -5],
      [100, -5],
      [100, 5],
      [0, 5],
    ]);
  });
});

describe("levels", () => {
  const home = makeHome({
    levels: [
      makeLevel("ground", 0),
      makeLevel("mezzanine", 0, { elevation_index: 1 }),
      makeLevel("first", 250),
      makeLevel("second", 500),
    ],
  });

  it("puts everything on the plan without a selected level", () => {
    expect(onLevel("first", null)).toBe(true);
    expect(onLevel("first", "first")).toBe(true);
    expect(onLevel("first", "second")).toBe(false);
    expect(onLevel(null, "first")).toBe(false);
  });

  it("shows walls of the level and lower levels at the same elevation", () => {
    const w = makeWall("w", [0, 0], [1, 0], { level: "ground" });
    expect(wallAtLevel(home, w, "ground")).toBe(true);
    expect(wallAtLevel(home, w, "mezzanine")).toBe(true);
    expect(wallAtLevel(home, w, null)).toBe(true);
  });

  it("shows walls of lower levels that reach into the level", () => {
    const low = makeWall("w", [0, 0], [1, 0], { level: "ground" });
    const tall = makeWall("t", [0, 0], [1, 0], { level: "ground", height: 300 });
    const sloped = makeWall("s", [0, 0], [1, 0], {
      level: "ground",
      height: 100,
      height_at_end: 260,
    });
    expect(wallAtLevel(home, low, "first")).toBe(false);
    expect(wallAtLevel(home, tall, "first")).toBe(true);
    expect(wallAtLevel(home, sloped, "first")).toBe(true);
    expect(wallAtLevel(home, tall, "second")).toBe(false);
  });

  it("does not show walls of upper levels or unknown levels", () => {
    const up = makeWall("w", [0, 0], [1, 0], { level: "first" });
    expect(wallAtLevel(home, up, "ground")).toBe(false);
    const lost = makeWall("l", [0, 0], [1, 0], { level: "gone" });
    expect(wallAtLevel(home, lost, "ground")).toBe(false);
  });

  it("shows pieces of lower levels above the floor of the level", () => {
    const cupboard = makePiece({ level: "ground", height: 255 });
    const highCupboard = makePiece({ level: "ground", height: 270 });
    expect(pieceAtLevel(home, cupboard, "first")).toBe(false);
    expect(pieceAtLevel(home, highCupboard, "first")).toBe(true);
  });

  it("shows staircases that reach the floor of the level", () => {
    const stairs = makePiece({
      level: "ground",
      height: 250,
      staircase_cut_out_shape: "M0,0 L1,0 L1,1 Z",
    });
    expect(pieceAtLevel(home, stairs, "first")).toBe(true);
    expect(pieceAtLevel(home, stairs, "second")).toBe(false);
  });

  it("does not show pieces of upper levels", () => {
    expect(pieceAtLevel(home, makePiece({ level: "first", height: 1000 }), "ground")).toBe(false);
  });

  it("shows tall pieces of lower levels and reference objects only as backdrop", () => {
    // Terrain on the ground level, reaching up through the first level
    const terrain = makePiece({ level: "ground", height: 6000 });
    expect(pieceAtLevel(home, terrain, "first")).toBe(true);
    expect(pieceIsBackdrop(home, terrain, "first")).toBe(true);
    expect(piecePickable(home, terrain, "first")).toBe(false);
    // On its own level it is an ordinary piece, unless it is a reference object
    expect(piecePickable(home, terrain, "ground")).toBe(true);
    const reference: Piece = {
      ...terrain,
      properties: [{ name: REFERENCE_PROPERTY, value: "true" }],
    };
    expect(isReference(reference)).toBe(true);
    expect(piecePickable(home, reference, "ground")).toBe(false);
    expect(piecePickable(home, reference, null)).toBe(false);
    // Staircases stay pickable on the level they lead to
    const stairs = makePiece({
      level: "ground",
      height: 250,
      staircase_cut_out_shape: "M0,0 L1,0 L1,1 Z",
    });
    expect(piecePickable(home, stairs, "first")).toBe(true);
  });
});
