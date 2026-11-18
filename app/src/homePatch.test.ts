import { describe, expect, it } from "vitest";
import { applyPatch, type HomePatch, isPatch, patchList } from "./homePatch";
import type { OpenedHome } from "./model";
import { makeHome, makePiece, makeWall, straightShape } from "./testFixtures";

const walls = [makeWall("a", [0, 0], [100, 0]), makeWall("b", [100, 0], [100, 100])];
const opened: OpenedHome = {
  id: 1,
  path: null,
  home: makeHome({ walls, furniture: [makePiece({ id: "p" })] }),
  wallShapes: walls.map(straightShape),
  modified: false,
  canUndo: false,
  canRedo: false,
  cameraMoves: 0,
  seq: 4,
};

const patch = (changes: Partial<HomePatch["changes"]>): HomePatch => ({
  id: 1,
  base: 4,
  seq: 5,
  path: "home.sh3d",
  modified: true,
  canUndo: true,
  canRedo: false,
  undoHistory: ["wall_update"],
  redoHistory: [],
  cameraMoves: 0,
  changes: { fields: {}, lists: {}, ...changes },
});

describe("patchList", () => {
  const idOf = (e: { id: string }) => e.id;
  const prev = [
    { id: "a", v: 1 },
    { id: "b", v: 1 },
  ];

  it("replaces changed elements in place and keeps the others", () => {
    const next = patchList(prev, { changed: [{ id: "b", v: 2 }] }, idOf);
    expect(next?.[0]).toBe(prev[0]);
    expect(next?.[1]).toEqual({ id: "b", v: 2 });
  });

  it("follows a new order with added and removed elements", () => {
    const next = patchList(prev, { order: ["c", "a"], changed: [{ id: "c", v: 3 }] }, idOf);
    expect(next?.map((e) => e.id)).toEqual(["c", "a"]);
    expect(next?.[1]).toBe(prev[0]);
  });

  it("gives up on an element it does not know", () => {
    expect(patchList(prev, { order: ["a", "x"], changed: [] }, idOf)).toBeNull();
  });
});

describe("applyPatch", () => {
  it("changes one wall and keeps everything else the same object", () => {
    const moved = makeWall("a", [0, 10], [100, 10]);
    const next = applyPatch(
      opened,
      patch({
        lists: { walls: { changed: [moved] } },
        wallShapes: { changed: [straightShape(moved)] },
      }),
    );
    expect(next?.seq).toBe(5);
    expect(next?.modified).toBe(true);
    expect(next?.path).toBe("home.sh3d");
    expect(next?.undoHistory).toEqual(["wall_update"]);
    expect(next?.home).not.toBe(opened.home);
    expect(next?.home.walls[0]).toBe(moved);
    expect(next?.home.walls[1]).toBe(opened.home.walls[1]);
    expect(next?.home.furniture).toBe(opened.home.furniture);
    expect(next?.wallShapes[1]).toBe(opened.wallShapes[1]);
    expect(next?.wallShapes[0].left[0]).toEqual([0, 5]);
  });

  it("replaces changed fields of the home", () => {
    const attrs = { ...opened.home.attrs, wall_height: 270 };
    const next = applyPatch(opened, patch({ fields: { attrs } }));
    expect(next?.home.attrs.wall_height).toBe(270);
    expect(next?.home.walls).toBe(opened.home.walls);
  });

  it("refuses changes for another home or another state", () => {
    expect(applyPatch(opened, { ...patch({}), id: 2 })).toBeNull();
    expect(applyPatch(opened, { ...patch({}), base: 3 })).toBeNull();
    expect(
      applyPatch(opened, patch({ lists: { walls: { order: ["zzz"], changed: [] } } })),
    ).toBeNull();
  });
});

describe("isPatch", () => {
  it("tells changes from a whole home", () => {
    expect(isPatch(patch({}))).toBe(true);
    expect(isPatch(opened)).toBe(false);
  });
});
