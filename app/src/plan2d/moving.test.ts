import { describe, expect, it } from "vitest";
import type { Pt } from "../model";
import { makeHome, makePiece, makeWall, roundPt, straightShape } from "../testFixtures";
import {
  constrainMove,
  dockToWall,
  editedWallJoints,
  fitInWall,
  movePreview,
  selectionJoints,
  slideInWall,
  wallSlot,
} from "./moving";

/** Two walls joined at a right angle in (100, 0). */
function corner() {
  const w1 = makeWall("w1", [0, 0], [100, 0], { wall_at_end: "w2" });
  const w2 = makeWall("w2", [100, 0], [100, 100], { wall_at_start: "w1" });
  return makeHome({ walls: [w1, w2] });
}

describe("constrainMove", () => {
  const home = makeHome({ walls: [makeWall("w", [0, 0], [100, 0])] });

  it("moves a single wall perpendicular to itself", () => {
    expect(roundPt(constrainMove(home, ["w"], [3, 50]))).toEqual([0, 50]);
    expect(roundPt(constrainMove(home, ["w"], [0.4, 20.6]))).toEqual([0, 21]);
  });

  it("moves a single wall along itself", () => {
    expect(roundPt(constrainMove(home, ["w"], [50, -3]))).toEqual([50, 0]);
  });

  it("keeps diagonal drags", () => {
    expect(constrainMove(home, ["w"], [30, 30])).toEqual([30, 30]);
  });

  it("does not constrain several elements or unknown ones", () => {
    expect(constrainMove(home, ["w", "x"], [3, 50])).toEqual([3, 50]);
    expect(constrainMove(home, ["piece"], [3, 50])).toEqual([3, 50]);
    expect(constrainMove(home, [], [3, 50])).toEqual([3, 50]);
  });
});

describe("wall joints", () => {
  it("reports the right angle at the corner of a selected wall", () => {
    const joints = selectionJoints(corner(), ["w1"]);
    expect(joints).toHaveLength(1);
    expect(joints[0].at).toEqual([100, 0]);
    expect(joints[0].deg).toBeCloseTo(90);
  });

  it("reports a corner once when both walls are selected", () => {
    expect(selectionJoints(corner(), ["w1", "w2"])).toHaveLength(1);
  });

  it("leaves out straight continuations", () => {
    const w1 = makeWall("w1", [0, 0], [100, 0], { wall_at_end: "w2" });
    const w2 = makeWall("w2", [100, 0], [200, 0], { wall_at_start: "w1" });
    expect(selectionJoints(makeHome({ walls: [w1, w2] }), ["w1"])).toEqual([]);
  });

  it("has no joints for selections without walls", () => {
    expect(selectionJoints(corner(), ["piece"])).toEqual([]);
    expect(selectionJoints(corner(), [])).toEqual([]);
  });

  it("ignores joins to walls that do not exist", () => {
    const w = makeWall("w", [0, 0], [100, 0], { wall_at_end: "gone" });
    expect(selectionJoints(makeHome({ walls: [w] }), ["w"])).toEqual([]);
  });

  it("lets a joined wall follow an edited end", () => {
    const joints = editedWallJoints(corner(), "w1", [0, 0], [100, 50]);
    expect(joints).toHaveLength(1);
    expect(joints[0].at).toEqual([100, 50]);
    // w1 now points from (100, 50) back to (0, 0), w2 from (100, 50) down to (100, 100)
    expect(joints[0].deg).toBeCloseTo(90 + (Math.atan2(50, 100) * 180) / Math.PI);
  });

  it("has no joints for an unknown wall", () => {
    expect(editedWallJoints(corner(), "nope", [0, 0], [1, 1])).toEqual([]);
  });
});

describe("movePreview", () => {
  it("outlines the walls that stretch, not the moved ones", () => {
    const home = corner();
    const shapes = home.walls.map(straightShape);
    const preview = movePreview(home, shapes, ["w1"], 0, 10);
    expect(preview.outlines).toHaveLength(1);
    // w2 starts at the moved corner (100, 10)
    const ys = preview.outlines[0].map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(10);
    expect(preview.joints).toHaveLength(1);
    expect(preview.joints[0].at).toEqual([100, 10]);
  });

  it("moves doors and windows standing in a moved wall", () => {
    const w = makeWall("w", [0, 0], [200, 0]);
    const door = makePiece(
      { id: "door", x: 100, y: 0, width: 80, depth: 10 },
      { kind: "DoorOrWindow" },
    );
    const home = makeHome({ walls: [w], furniture: [door] });
    const preview = movePreview(home, [straightShape(w)], ["w"], 5, 0);
    expect(preview.outlines).toHaveLength(1);
    const xs = preview.outlines[0].map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(65);
    expect(Math.max(...xs)).toBeCloseTo(145);
  });
});

describe("dockToWall", () => {
  const wall = makeWall("w", [0, 0], [200, 0]);
  const home = makeHome({ walls: [wall] });
  const shapes = [straightShape(wall)];

  it("puts the back of a piece against the closest wall side", () => {
    const piece = makePiece({ width: 100, depth: 50 });
    const below = dockToWall(home, shapes, null, piece, [100, 33], 10);
    expect(below).not.toBeNull();
    expect(below?.x).toBe(100);
    expect(below?.y).toBe(30);
    expect(below?.angleDeg).toBe(0);
    const above = dockToWall(home, shapes, null, piece, [100, -33], 10);
    expect(above?.y).toBe(-30);
    expect(above?.angleDeg).toBe(180);
  });

  it("does not dock beyond the radius or beyond the wall ends", () => {
    const piece = makePiece({ width: 100, depth: 50 });
    expect(dockToWall(home, shapes, null, piece, [100, 60], 10)).toBeNull();
    expect(dockToWall(home, shapes, null, piece, [-20, 30], 10)).toBeNull();
  });

  it("does not dock doors, windows and tilted pieces", () => {
    const door = makePiece({}, { kind: "DoorOrWindow" });
    expect(dockToWall(home, shapes, null, door, [100, 30], 10)).toBeNull();
    const tilted = makePiece({ pitch: 0.3 });
    expect(dockToWall(home, shapes, null, tilted, [100, 30], 10)).toBeNull();
  });
});

describe("fitInWall", () => {
  const door = (attrs = {}) =>
    makePiece({ depth: 10, wall_thickness: 1, ...attrs }, { kind: "DoorOrWindow" });

  it("follows the wall thickness up to the wall part of its depth", () => {
    expect(fitInWall(door(), 8)).toEqual({ depth: 8, shift: 0, cutThrough: false });
    // Half of its depth is the wall part: a 4 cm wall needs 8 cm
    expect(fitInWall(door({ wall_thickness: 0.5 }), 4)).toEqual({
      depth: 8,
      shift: 0,
      cutThrough: false,
    });
  });

  it("keeps its depth in thicker walls and cuts through them", () => {
    expect(fitInWall(door(), 30)).toEqual({ depth: 10, shift: 10, cutThrough: true });
    expect(fitInWall(door(), 30, 20)).toEqual({ depth: 20, shift: 5, cutThrough: true });
  });

  it("keeps the depth of pieces that cannot be resized", () => {
    expect(fitInWall(door({ resizable: false }), 30)).toEqual({
      depth: 10,
      shift: 0,
      cutThrough: false,
    });
    expect(fitInWall(door({ width_depth_deformable: false }), 4).depth).toBe(10);
  });
});

describe("doors and windows sliding in walls", () => {
  const wall = makeWall("w", [0, 0], [400, 0], { thickness: 20 });
  const shapes = [straightShape(wall)];
  const door = makePiece(
    { id: "door", x: 195, y: 0, width: 80, depth: 20, wall_thickness: 1, angle: 0 },
    { kind: "DoorOrWindow" },
  );

  it("finds the wall a door stands in and its free space", () => {
    const home = makeHome({ walls: [wall], furniture: [door] });
    const slot = wallSlot(home, shapes, null, door, [195, 3], 10);
    expect(slot).not.toBeNull();
    expect(slot?.t).toBeCloseTo(195);
    expect(slot?.prev).toBeCloseTo(0);
    expect(slot?.next).toBeCloseTo(400);
    expect(slot?.angle).toBeCloseTo(0);
  });

  it("splits the free space at other openings in the wall", () => {
    const window = makePiece(
      { id: "window", x: 320, y: 0, width: 60, depth: 20 },
      { kind: "DoorOrWindow" },
    );
    const home = makeHome({ walls: [wall], furniture: [door, window] });
    expect(wallSlot(home, shapes, null, door, [195, 0], 10)?.next).toBeCloseTo(290);
  });

  it("has no slot away from walls", () => {
    const home = makeHome({ walls: [wall], furniture: [door] });
    expect(wallSlot(home, shapes, null, door, [195, 100], 10)).toBeNull();
  });

  it("snaps to the middle of the free space with magnetism", () => {
    const home = makeHome({ walls: [wall], furniture: [door] });
    const slid = slideInWall(home, shapes, null, door, [195, 0], 10, 10, true);
    expect(slid?.x).toBe(200);
    expect(slid?.y).toBeCloseTo(0);
    expect(slid?.depth).toBe(20);
    expect(slid?.note).toBe("middle of the free space · 160 cm | 160 cm");
    expect(slid?.gaps).toHaveLength(2);
  });

  it("stays where it is dragged without magnetism", () => {
    const home = makeHome({ walls: [wall], furniture: [door] });
    const slid = slideInWall(home, shapes, null, door, [195, 0], 10, 10, false);
    expect(slid?.x).toBe(195);
    expect(slid?.note).toBe("155 cm | 165 cm");
  });

  it("aligns with doors of parallel walls", () => {
    const other = makeWall("o", [0, 300], [400, 300], { thickness: 20 });
    const upstairs = makePiece(
      { id: "up", name: "Window", x: 120, y: 300, width: 80, depth: 20, angle: 0 },
      { kind: "DoorOrWindow" },
    );
    const home = makeHome({ walls: [wall, other], furniture: [door, upstairs] });
    const slid = slideInWall(
      home,
      [straightShape(wall), straightShape(other)],
      null,
      door,
      [124, 0],
      10,
      10,
      true,
    );
    expect(slid?.x).toBe(120);
    expect(slid?.note?.startsWith("in line with Window")).toBe(true);
    expect(slid?.guides).toHaveLength(1);
  });
});

describe("pieces turning to the side they are pulled to", () => {
  it("opens to the side of the wall the piece is pulled across", () => {
    const wall = makeWall("w", [0, 0], [400, 0], { thickness: 20 });
    const door = makePiece(
      { id: "door", x: 200, y: 0, width: 80, depth: 20, angle: 0 },
      { kind: "DoorOrWindow" },
    );
    const home = makeHome({ walls: [wall], furniture: [door] });
    const pulled: Pt = [200, -12];
    const slot = wallSlot(home, [straightShape(wall)], null, door, pulled, 10, true);
    expect(slot?.angle).toBeCloseTo(Math.PI);
  });
});
