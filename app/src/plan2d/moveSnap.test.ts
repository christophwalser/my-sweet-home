import { describe, expect, it } from "vitest";
import { makeHome, makePiece, makeWall, straightShape } from "../testFixtures";
import { moveTargets, pieceDistances, selectionBox, snapMove } from "./moveSnap";

// A wall along y = 0 (faces at y = ±5) and two pieces: A (0..100 × 100..160), B (300..400 × 100..160)
const wall = makeWall("w", [-100, 0], [600, 0]);
const a = makePiece({ id: "a", x: 50, y: 130, width: 100, depth: 60 });
const b = makePiece({ id: "b", x: 350, y: 130, width: 100, depth: 60 });
const moving = makePiece({ id: "m", x: 200, y: 300, width: 80, depth: 40 });
const home = makeHome({ walls: [wall], furniture: [a, b, moving] });
const shapes = [straightShape(wall)];

describe("snapMove", () => {
  const targets = moveTargets(home, shapes, null, ["m"]);
  const box = selectionBox(home, shapes, ["m"]);
  if (!box) throw new Error("no box");

  it("snaps an edge in line with the edge of a piece", () => {
    // Moved piece: x 160..240, moved by 137 its left edge (297) is near the left edge of B (300)
    const s = snapMove(box, targets, [137, -100], 10);
    expect(s.offset[0]).toBe(140);
    expect(s.note).toContain("in line");
    expect(s.guides.length).toBeGreaterThan(0);
  });

  it("snaps edge to edge beside a piece", () => {
    // The moved piece's left edge (160) near the right edge of A (100)
    const s = snapMove(box, targets, [-57, -170], 10);
    expect(s.offset[0]).toBe(-60);
    expect(s.note).toContain("edge to edge");
  });

  it("snaps to a wall face", () => {
    // Top edge of the moved piece (280) near the lower face of the wall (5)
    const s = snapMove(box, targets, [500, -272], 10);
    expect(s.offset[1]).toBe(-275);
  });

  it("makes equal gaps between two pieces", () => {
    // Between A (right edge 100) and B (left edge 300) a piece 80 wide is centered at 200
    const s = snapMove(box, targets, [4, -170], 10);
    expect(s.offset[0]).toBe(0);
    expect(s.gaps).toHaveLength(2);
    expect(s.gaps[0][2]).toBe("= 60");
  });

  it("leaves the offset when nothing is near", () => {
    const far = snapMove(
      box,
      moveTargets(makeHome({ furniture: [moving] }), [], null, ["m"]),
      [3, 7],
      10,
    );
    expect(far.offset).toEqual([3, 7]);
    expect(far.note).toBeNull();
  });
});

describe("pieceDistances", () => {
  it("measures to the next wall face and piece in every direction", () => {
    const targets = moveTargets(home, shapes, null, ["m"]);
    const d = pieceDistances(moving, [200, 130], 0, targets.segments);
    const byDir = (x: number, y: number) =>
      d.find((g) => Math.abs(g.dir[0] - x) < 1e-6 && Math.abs(g.dir[1] - y) < 1e-6)?.value;
    expect(byDir(1, 0)).toBeCloseTo(60); // to B
    expect(byDir(-1, 0)).toBeCloseTo(60); // to A
    expect(byDir(0, -1)).toBeCloseTo(105); // to the wall face at y = 5
    expect(byDir(0, 1)).toBeUndefined(); // nothing below
  });
});
