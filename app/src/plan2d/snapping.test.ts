import { afterEach, describe, expect, it } from "vitest";
import type { Pt } from "../model";
import { usePreferences } from "../preferences";
import { makeHome, makeRoom, makeWall, roundPt, straightShape } from "../testFixtures";
import {
  offsetOutline,
  pointKey,
  projectOnSegment,
  type SnapContext,
  snapAngleDeg,
  snapContext,
  snapDraw,
  wallAxis,
} from "./snapping";

const DEG = Math.PI / 180;

/** A context without targets; tests add what they need. */
function ctx(parts: Partial<SnapContext> = {}): SnapContext {
  return { radius: 10, points: [], lines: [], refs: [], directions: [], ...parts };
}

/** Point at `length` from `from` in the direction `deg`. */
function polar(from: Pt, deg: number, length: number): Pt {
  return [from[0] + Math.cos(deg * DEG) * length, from[1] + Math.sin(deg * DEG) * length];
}

const angleOf = (from: Pt, to: Pt) => Math.atan2(to[1] - from[1], to[0] - from[0]) / DEG;

afterEach(() => {
  usePreferences.setState({
    angleStep: 5,
    snapAngles: true,
    snapObjects: true,
    snapToRulers: true,
  });
});

describe("pointKey", () => {
  it("rounds to 1/100 cm", () => {
    expect(pointKey([1.234, 5.678])).toBe("123,568");
    expect(pointKey([1.2341, 5.6779])).toBe(pointKey([1.234, 5.678]));
    expect(pointKey([-10, 0])).toBe("-1000,0");
  });
});

describe("snapAngleDeg", () => {
  it("attracts multiples of 45° within ±5°", () => {
    expect(snapAngleDeg(41, false)).toBe(45);
    expect(snapAngleDeg(49, false)).toBe(45);
    expect(snapAngleDeg(88, false)).toBe(90);
    expect(snapAngleDeg(359, false)).toBe(360);
    expect(snapAngleDeg(-2, false) + 0).toBe(0);
  });

  it("uses 5° steps outside the tolerance of the major directions", () => {
    expect(snapAngleDeg(38.4, false)).toBe(40);
    expect(snapAngleDeg(33, false)).toBe(35);
    expect(snapAngleDeg(-21, false)).toBe(-20);
  });

  it("is exactly at the boundary of the major tolerance", () => {
    // 5° from 45° is no longer attracted: 40 is a 5° step anyway
    expect(snapAngleDeg(40, false)).toBe(40);
    expect(snapAngleDeg(50.1, false)).toBe(50);
  });

  it("uses plain 1° steps with fine, also next to 45° multiples", () => {
    expect(snapAngleDeg(43.4, true)).toBe(43);
    expect(snapAngleDeg(44.6, true)).toBe(45);
    expect(snapAngleDeg(1.2, true)).toBe(1);
  });

  it("follows the angle step of the preferences", () => {
    usePreferences.setState({ angleStep: 15 });
    expect(snapAngleDeg(22, false)).toBe(15);
    expect(snapAngleDeg(23, false)).toBe(30);
    // The 45° magnetism still applies first
    expect(snapAngleDeg(42, false)).toBe(45);
  });
});

describe("projectOnSegment", () => {
  const seg: [Pt, Pt] = [
    [0, 0],
    [100, 0],
  ];

  it("projects onto the inside of the segment", () => {
    expect(projectOnSegment([30, 40], seg)).toEqual([30, 0]);
  });

  it("clamps to the ends", () => {
    expect(projectOnSegment([-50, 10], seg)).toEqual([0, 0]);
    expect(projectOnSegment([150, -10], seg)).toEqual([100, 0]);
  });

  it("returns the point of a zero-length segment", () => {
    expect(
      projectOnSegment(
        [5, 5],
        [
          [3, 4],
          [3, 4],
        ],
      ),
    ).toEqual([3, 4]);
  });
});

describe("snapDraw without a previous point", () => {
  it("snaps to the closest point within the radius", () => {
    const s = snapDraw(
      [3, 4],
      null,
      ctx({
        points: [
          [8, 4],
          [0, 0],
        ],
      }),
    );
    expect(s.pt).toEqual([0, 0]);
    expect(s.marker).toEqual([0, 0]);
  });

  it("names a labeled point", () => {
    const labels = new Map([[pointKey([0, 0]), "wall end"]]);
    expect(snapDraw([1, 1], null, ctx({ points: [[0, 0]], labels })).note).toBe("wall end");
  });

  it("ignores points outside the radius and rounds to whole centimeters", () => {
    const s = snapDraw([30.4, 40.6], null, ctx({ points: [[0, 0]] }));
    expect(s.pt).toEqual([30, 41]);
    expect(s.marker).toBeNull();
    expect(s.guides).toEqual([]);
  });

  it("projects onto lines with the line label", () => {
    const s = snapDraw(
      [50.3, 4],
      null,
      ctx({
        lines: [
          [
            [0, 0],
            [100, 0],
          ],
        ],
        lineLabel: "on edge",
      }),
    );
    expect(s.pt).toEqual([50.3, 0]);
    expect(s.note).toBe("on edge");
  });

  it("aligns with reference points and draws guides", () => {
    const s = snapDraw(
      [102, 197],
      null,
      ctx({
        refs: [
          [100, 0],
          [0, 200],
        ],
      }),
    );
    expect(s.pt).toEqual([100, 200]);
    expect(s.guides).toEqual([
      [
        [100, 0],
        [100, 200],
      ],
      [
        [0, 200],
        [100, 200],
      ],
    ]);
  });
});

describe("snapDraw with a previous point", () => {
  const origin: Pt = [0, 0];

  it("does not snap back onto the previous point", () => {
    const s = snapDraw([2, 0], origin, ctx({ points: [origin] }));
    expect(s.marker).toBeNull();
  });

  it("snaps the direction to 0° and rounds the length", () => {
    const s = snapDraw([100.4, 3], origin, ctx());
    expect(roundPt(s.pt)).toEqual([100, 0]);
    expect(s.note).toBeNull();
  });

  it("snaps a direction close to 45°", () => {
    const s = snapDraw(polar(origin, 43, 100), origin, ctx());
    expect(angleOf(origin, s.pt)).toBeCloseTo(45);
    expect(Math.hypot(...s.pt)).toBeCloseTo(100);
  });

  it("snaps a direction close to 360° to the x axis", () => {
    const s = snapDraw(polar(origin, -2, 100), origin, ctx());
    expect(roundPt(s.pt)).toEqual([100, 0]);
  });

  it("uses 1° steps with fine", () => {
    const s = snapDraw(polar(origin, 3.2, 100), origin, ctx({ fine: true }));
    expect(angleOf(origin, s.pt)).toBeCloseTo(3);
    expect(s.note).toBe("1° steps");
  });

  it("counts fine steps from the wall at the corner", () => {
    const base = 10.5;
    const s = snapDraw(
      polar(origin, base + 20.2, 100),
      origin,
      ctx({ fine: true, corner: [base * DEG] }),
    );
    expect(angleOf(origin, s.pt)).toBeCloseTo(base + 20);
    expect(s.note).toBe("1° steps to wall");
  });

  it("prefers right angles to the wall at the corner", () => {
    const wall = 12 * DEG;
    const s = snapDraw(polar(origin, 12 + 83, 100), origin, ctx({ corner: [wall] }));
    expect(angleOf(origin, s.pt)).toBeCloseTo(102);
    expect(s.note).toBe("90° to wall");
  });

  it("continues the wall at the corner in a straight line", () => {
    const wall = 12 * DEG;
    const s = snapDraw(polar(origin, 12 + 175, 100), origin, ctx({ corner: [wall] }));
    expect(angleOf(origin, s.pt)).toBeCloseTo(192 - 360);
    expect(s.note).toBe("in line with wall");
  });

  it("snaps parallel and perpendicular to nearby walls", () => {
    const wall = 33 * DEG;
    const parallel = snapDraw(polar(origin, 34.5, 100), origin, ctx({ directions: [wall] }));
    expect(angleOf(origin, parallel.pt)).toBeCloseTo(33);
    expect(parallel.note).toBe("∥ wall");
    const perpendicular = snapDraw(polar(origin, 124, 100), origin, ctx({ directions: [wall] }));
    expect(angleOf(origin, perpendicular.pt)).toBeCloseTo(123);
    expect(perpendicular.note).toBe("⊥ wall");
  });

  it("keeps a 45° multiple that is closer than a wall direction", () => {
    const s = snapDraw(polar(origin, 44.5, 100), origin, ctx({ directions: [42 * DEG] }));
    expect(angleOf(origin, s.pt)).toBeCloseTo(45);
  });

  it("stops at a line crossed along the direction", () => {
    const s = snapDraw(
      [97, 0.5],
      origin,
      ctx({
        lines: [
          [
            [100, -50],
            [100, 50],
          ],
        ],
        lineLabel: "on wall axis",
      }),
    );
    expect(roundPt(s.pt)).toEqual([100, 0]);
    expect(s.marker).not.toBeNull();
    expect(s.note).toBe("on wall axis");
  });

  it("stops at the alignment guide of a reference point", () => {
    const s = snapDraw([97, 1], origin, ctx({ refs: [[100, 300]] }));
    expect(roundPt(s.pt)).toEqual([100, 0]);
    expect(s.marker).toBeNull();
    expect(s.guides).toHaveLength(1);
    expect(s.guides[0][0]).toEqual([100, 300]);
  });
});

describe("snapContext", () => {
  const w1 = makeWall("w1", [0, 0], [200, 0]);
  const w2 = makeWall("w2", [0, 300], [200, 300]);
  const home = makeHome({ walls: [w1, w2] });
  const shapes = [straightShape(w1), straightShape(w2)];

  it("collects wall ends, middles and flush points for walls", () => {
    const c = snapContext("wall", home, shapes, null, 10, { thickness: 20 });
    expect(c.points).toContainEqual([0, 0]);
    expect(c.points).toContainEqual([100, 0]);
    expect(c.points).toContainEqual([10, 0]);
    expect(c.points).toContainEqual([190, 0]);
    expect(c.labels?.get(pointKey([100, 0]))).toBe("wall middle");
    expect(c.labels?.get(pointKey([10, 0]))).toBe("flush with wall end");
    expect(c.lines).toHaveLength(2);
    expect(c.lineLabel).toBe("on wall axis");
  });

  it("adds the faces, face corners and perpendicular feet of nearby walls for walls", () => {
    const c = snapContext("wall", home, shapes, null, 10, {
      near: [100, 20],
      anchor: [50, 100],
    });
    const t = w1.attrs.thickness / 2;
    // The faces of the near wall are lines with their own label
    const faces = c.lines.filter((_, i) => c.lineLabels?.[i] === "on wall face");
    expect(faces).toHaveLength(2);
    expect(c.labels?.get(pointKey([0, -t]))).toBe("wall corner");
    // Perpendicular from the previous point onto the axis and both faces of w1
    expect(c.labels?.get(pointKey([50, 0]))).toBe("perpendicular");
    expect(c.labels?.get(pointKey([50, t]))).toBe("perpendicular");
    // The far wall gives none
    expect(c.labels?.get(pointKey([50, 300]))).toBeUndefined();
    expect(snapDraw([51, 3], [50, 100], c).note).toBe("perpendicular");
  });

  it("lets a new wall start on a face flush with the corner of a nearby wall", () => {
    const c = snapContext("wall", home, shapes, null, 10, { near: [205, 0], thickness: 4 });
    const t = w1.attrs.thickness / 2;
    // On the end face, 2 cm (half the new wall) from each corner
    expect(c.labels?.get(pointKey([200, t - 2]))).toBe("flush with wall corner");
    expect(c.labels?.get(pointKey([200, -t + 2]))).toBe("flush with wall corner");
    // On the side faces too
    expect(c.labels?.get(pointKey([198, t]))).toBe("flush with wall corner");
    expect(snapDraw([201, t - 2.5], null, c).pt).toEqual([200, t - 2]);
    // Without the thickness of the new wall there are none
    const plain = snapContext("wall", home, shapes, null, 10, { near: [205, 0] });
    expect([...(plain.labels?.values() ?? [])]).not.toContain("flush with wall corner");
  });

  it("keeps the face points of a thick wall when zoomed in (small snap radius)", () => {
    const thick = makeWall("t", [0, 0], [200, 0], { thickness: 40 });
    const h = makeHome({ walls: [thick] });
    // The cursor on the face, 20 cm from the axis; the radius is only 0.5 cm
    const c = snapContext("wall", h, [straightShape(thick)], null, 0.5, {
      near: [100, 20],
      thickness: 10,
    });
    expect(c.labels?.get(pointKey([200, 15]))).toBe("flush with wall corner");
    expect(c.hints?.length).toBeGreaterThan(0);
    expect(snapDraw([199.8, 15.2], null, c).note).toBe("flush with wall corner");
  });

  it("leaves out the element being edited and the point being moved", () => {
    const c = snapContext("wall", home, shapes, null, 10, {
      excludeId: "w1",
      excludePoint: [0, 300],
    });
    expect(c.points).not.toContainEqual([0, 0]);
    expect(c.points).not.toContainEqual([0, 300]);
    expect(c.points).toContainEqual([200, 300]);
  });

  it("uses the wall side corners and edges for rooms", () => {
    const c = snapContext("room", home, shapes, null, 10);
    expect(c.points).toContainEqual([0, -5]);
    expect(c.points).toContainEqual([200, 5]);
    expect(c.lineLabel).toBe("on edge");
    expect(c.lines).toHaveLength(4);
  });

  it("names the room corners for dimensions and adds no axis refs", () => {
    const room = makeRoom([
      [0, 0],
      [50, 0],
      [50, 50],
    ]);
    const c = snapContext(
      "dimension",
      makeHome({ walls: [w1], rooms: [room] }),
      [shapes[0]],
      null,
      10,
    );
    expect(c.labels?.get(pointKey([0, -5]))).toBe("wall corner");
    // The wall axis end is no guide, its side corners are
    expect(c.refs).not.toContainEqual([200, 0]);
    expect(c.refs).toContainEqual([200, -5]);
    expect(c.points).toContainEqual([50, 50]);
  });

  it("has no wall targets for polylines", () => {
    const c = snapContext("polyline", home, shapes, null, 10);
    expect(c.points).toEqual([]);
    expect(c.refs).toEqual([]);
    expect(c.lineLabel).toBeUndefined();
  });

  it("closes the path at its first point", () => {
    const path: Pt[] = [
      [500, 500],
      [600, 500],
    ];
    expect(
      snapContext("room", home, shapes, null, 10, { path }).labels?.get(pointKey(path[0])),
    ).toBe("finish room");
    expect(
      snapContext("wall", home, shapes, null, 10, { path }).labels?.get(pointKey(path[0])),
    ).toBe("close");
  });

  it("takes the corner directions from walls at the anchor and the previous segment", () => {
    const c = snapContext("wall", home, shapes, null, 10, {
      anchor: [200, 0],
      path: [
        [0, 500],
        [0, 600],
      ],
    });
    expect(c.corner).toHaveLength(2);
    expect(c.corner?.[0]).toBeCloseTo(0);
    expect(c.corner?.[1]).toBeCloseTo(Math.PI / 2);
  });

  it("drops axis-aligned and duplicate wall directions", () => {
    const a = makeWall("a", [0, 0], polar([0, 0], 30, 100));
    const b = makeWall("b", [0, 0], polar([0, 0], 120, 100));
    const walls = [w1, a, b];
    const c = snapContext("wall", makeHome({ walls }), walls.map(straightShape), null, 10);
    expect(c.directions).toHaveLength(1);
    expect(c.directions[0]).toBeCloseTo(30 * DEG);
  });
});

describe("wallAxis", () => {
  it("is the straight segment without an arc", () => {
    expect(wallAxis([0, 0], [100, 0], null)).toEqual([
      [0, 0],
      [100, 0],
    ]);
    expect(wallAxis([0, 0], [100, 0], 1e-5)).toHaveLength(2);
  });

  it("runs on a circle from the start to the end for arcs", () => {
    const pts = wallAxis([0, 0], [200, 0], Math.PI / 2);
    expect(pts).toHaveLength(9);
    expect(roundPt(pts[0])).toEqual([0, 0]);
    expect(roundPt(pts[pts.length - 1])).toEqual([200, 0]);
    // A quarter circle over a 200 cm chord: radius 200/√2, sagitta r − 100
    const r = 200 / Math.SQRT2;
    const mid = pts[4];
    expect(Math.abs(mid[1])).toBeCloseTo(r - 100);
  });

  it("uses at least 4 segments for flat arcs", () => {
    expect(wallAxis([0, 0], [200, 0], 0.1)).toHaveLength(5);
  });
});

describe("offsetOutline", () => {
  it("is empty for fewer than two points", () => {
    expect(offsetOutline([], 5)).toEqual([]);
    expect(offsetOutline([[0, 0]], 5)).toEqual([]);
  });

  it("is a rectangle around a straight segment", () => {
    const out = offsetOutline(
      [
        [0, 0],
        [100, 0],
      ],
      5,
    ).map((p) => roundPt(p));
    expect(out).toEqual([
      [0, -5],
      [100, -5],
      [100, 5],
      [0, 5],
    ]);
  });

  it("miters a right-angle corner", () => {
    const out = offsetOutline(
      [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
      5,
    );
    // Corner points lie half / cos(45°) away from the corner
    expect(Math.hypot(out[1][0] - 100, out[1][1])).toBeCloseTo(5 * Math.SQRT2);
    expect(roundPt(out[1])).toEqual([105, -5]);
  });

  it("limits the miter of very sharp angles", () => {
    const out = offsetOutline(
      [
        [0, 0],
        [100, 0],
        [0, 1],
      ],
      5,
    );
    expect(Math.hypot(out[1][0] - 100, out[1][1])).toBeLessThanOrEqual(5 / 0.2 + 1e-9);
  });
});

describe("ruler guides and the snap switches", () => {
  const wall = makeWall("w", [0, 0], [400, 0]);
  const guides = [
    { id: "g1", level: null, x_start: 100, y_start: -100, x_end: 100, y_end: 300 },
    { id: "g2", level: null, x_start: -50, y_start: 200, x_end: 450, y_end: 200 },
  ];
  const home = makeHome({
    walls: [wall],
    properties: [{ name: "mySweetHome.guides", value: JSON.stringify(guides) }],
  } as never);
  const shapes = [straightShape(wall)];

  it("snaps to the ends, middles, crossings and lines of rulers", () => {
    const c = snapContext("wall", home, shapes, null, 10);
    expect(c.points).toContainEqual([100, 300]);
    expect(c.labels?.get(pointKey([100, 100]))).toBe("guide line middle");
    // Crossing of the two rulers and of a ruler with the wall axis
    expect(c.labels?.get(pointKey([100, 200]))).toBe("guide line crossing");
    expect(c.labels?.get(pointKey([100, 0]))).toBe("guide line crossing");
    const s = snapDraw([104, 150], null, c);
    expect(s.pt).toEqual([100, 150]);
    expect(s.note).toBe("on guide line");
  });

  it("leaves rulers, objects or angles out when they are switched off", () => {
    usePreferences.setState({ snapToRulers: false });
    expect(snapContext("wall", home, shapes, null, 10).labels?.get(pointKey([100, 200]))).toBe(
      undefined,
    );
    usePreferences.setState({ snapToRulers: true, snapObjects: false });
    const c = snapContext("wall", home, shapes, null, 10);
    expect(c.points).not.toContainEqual([0, 0]);
    expect(c.points).toContainEqual([100, 300]);
    usePreferences.setState({ snapObjects: true, snapAngles: false });
    const free = snapDraw(
      polar([0, 100], 3, 150),
      [0, 100],
      snapContext("room", home, shapes, null, 1),
    );
    expect(angleOf([0, 100], free.pt)).toBeCloseTo(3);
  });
});
