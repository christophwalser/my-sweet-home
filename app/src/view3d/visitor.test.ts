import { describe, expect, it } from "vitest";
import type { Pt } from "../model";
import { makeHome, makeLevel, makePiece, makeWall, roundPt, straightShape } from "../testFixtures";
import {
  blocked,
  buildColliders,
  clearance,
  collide,
  groundAt,
  levelOfEye,
  stairTopAt,
  VISITOR_RADIUS,
} from "./visitor";

const flat = (_level: string | null) => 0;

/** A wall along the y axis at x = 100 (thickness 10, height 250). */
function wallHome(furniture = [] as ReturnType<typeof makePiece>[]) {
  const wall = makeWall("w", [100, -500], [100, 500]);
  return { home: makeHome({ walls: [wall], furniture }), shapes: [straightShape(wall)] };
}

describe("levelOfEye", () => {
  const home = makeHome({ levels: [makeLevel("first", 250), makeLevel("ground", 0)] });

  it("is null without levels", () => {
    expect(levelOfEye(makeHome(), 170)).toBeNull();
  });

  it("is the highest level at least 60 cm below the eyes", () => {
    expect(levelOfEye(home, 170)).toBe("ground");
    expect(levelOfEye(home, 309)).toBe("ground");
    expect(levelOfEye(home, 310)).toBe("first");
  });

  it("falls back to the lowest level below all floors", () => {
    expect(levelOfEye(home, -100)).toBe("ground");
  });
});

describe("clearance and collisions", () => {
  it("is infinite without walls", () => {
    const { home } = { home: makeHome() };
    expect(clearance(buildColliders(home, [], flat), [0, 0], 170)).toBe(Number.POSITIVE_INFINITY);
  });

  it("measures the distance to the nearest wall side, negative inside", () => {
    const { home, shapes } = wallHome();
    const c = buildColliders(home, shapes, flat);
    expect(clearance(c, [50, 0], 170)).toBeCloseTo(45);
    expect(clearance(c, [100, 0], 170)).toBeCloseTo(-5);
  });

  it("is blocked closer than the visitor radius", () => {
    const { home, shapes } = wallHome();
    const c = buildColliders(home, shapes, flat);
    expect(blocked(c, [95 - VISITOR_RADIUS - 1, 0], 170)).toBe(false);
    expect(blocked(c, [95 - VISITOR_RADIUS + 1, 0], 170)).toBe(true);
  });

  it("ignores walls below the knees and above the head", () => {
    const low = makeWall("w", [100, -500], [100, 500], { height: 20 });
    const c = buildColliders(makeHome({ walls: [low] }), [straightShape(low)], flat);
    expect(clearance(c, [100, 0], 170)).toBe(Number.POSITIVE_INFINITY);
  });

  it("lets the visitor through doors reaching the floor", () => {
    const door = makePiece(
      { x: 100, y: 0, width: 90, depth: 10, height: 210, angle: Math.PI / 2 },
      { kind: "DoorOrWindow" },
    );
    const { home, shapes } = wallHome([door]);
    const c = buildColliders(home, shapes, flat);
    expect(c.passages).toHaveLength(1);
    expect(clearance(c, [100, 0], 170)).toBe(Number.POSITIVE_INFINITY);
    const end = collide(c, [0, 0], [200, 0], 170);
    expect(roundPt(end)).toEqual([200, 0]);
  });

  it("does not make passages of windows or low openings", () => {
    const window = makePiece(
      { x: 100, y: 0, height: 120, elevation: 90 },
      { kind: "DoorOrWindow" },
    );
    const { home, shapes } = wallHome([window]);
    expect(buildColliders(home, shapes, flat).passages).toEqual([]);
  });

  it("stops at a wall", () => {
    const { home, shapes } = wallHome();
    const c = buildColliders(home, shapes, flat);
    const end = collide(c, [0, 0], [200, 0], 170);
    expect(end[0]).toBeLessThan(95 - VISITOR_RADIUS + 1e-6);
    expect(end[0]).toBeGreaterThan(95 - VISITOR_RADIUS - VISITOR_RADIUS / 2);
  });

  it("slides along a wall instead of stopping", () => {
    const { home, shapes } = wallHome();
    const c = buildColliders(home, shapes, flat);
    const end = collide(c, [70, 0], [120, 100], 170);
    expect(end[0]).toBeLessThan(95 - VISITOR_RADIUS + 1e-6);
    expect(end[1]).toBeCloseTo(100);
  });

  it("does not move for a zero-length step", () => {
    const { home, shapes } = wallHome();
    const c = buildColliders(home, shapes, flat);
    const p: Pt = [0, 0];
    expect(collide(c, p, p, 170)).toEqual(p);
  });
});

describe("floors and staircases", () => {
  const levels = [makeLevel("ground", 0), makeLevel("first", 250)];
  const elevation = (id: string | null) => (id === "first" ? 250 : 0);
  // Staircase 100 × 300 rising towards −y (its back), up to the first floor
  const stairs = makePiece({
    id: "stairs",
    level: "ground",
    x: 0,
    y: 0,
    width: 100,
    depth: 300,
    height: 260,
    staircase_cut_out_shape: "M0,0 L1,0 L1,1 L0,1 Z",
  });
  const home = makeHome({ levels, furniture: [stairs] });

  it("collects the floors and ramps", () => {
    const c = buildColliders(home, [], elevation);
    expect(c.floors).toEqual([0, 250]);
    expect(c.ramps).toHaveLength(1);
    expect(c.ramps[0].top).toBe(250);
    expect(c.ramps[0].holes).toHaveLength(1);
  });

  it("stands on the floor away from staircases", () => {
    const c = buildColliders(home, [], elevation);
    expect(groundAt(c, [500, 500], 170, 0)).toBe(0);
    expect(groundAt(c, [500, 500], 420, 250)).toBe(250);
  });

  it("rises along the ramp of a staircase", () => {
    const c = buildColliders(home, [], elevation);
    expect(groundAt(c, [0, 150], 170, 0)).toBeCloseTo(0);
    expect(groundAt(c, [0, 0], 170, 100)).toBeCloseTo(125);
    expect(groundAt(c, [0, -150], 400, 240)).toBeCloseTo(250);
  });

  it("does not jump onto a ramp far above or below", () => {
    const c = buildColliders(home, [], elevation);
    // In the middle of the staircase, but coming from the floor 125 cm below
    expect(groundAt(c, [0, 0], 170, 0)).toBe(0);
  });

  it("reports the level a staircase leads to while on its steps", () => {
    const c = buildColliders(home, [], elevation);
    expect(stairTopAt(c, [0, 0], 125)).toBe(250);
    expect(stairTopAt(c, [0, 0], 0)).toBeNull();
    expect(stairTopAt(c, [500, 0], 125)).toBeNull();
  });

  it("prefers the steps of the model when they are loaded", () => {
    const c = { ...buildColliders(home, [], elevation), stepSurfaces: () => [17, 34, 51] };
    expect(groundAt(c, [0, 100], 170, 20)).toBe(34);
  });
});
