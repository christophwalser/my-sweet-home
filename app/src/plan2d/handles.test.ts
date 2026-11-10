import { describe, expect, it } from "vitest";
import type { Home, Pt } from "../model";
import {
  makeDimension,
  makeHome,
  makePiece,
  makePolyline,
  makeRoom,
  makeWall,
  roundPt,
  straightShape,
} from "../testFixtures";
import {
  directionDeg,
  dragHandle,
  elementHandles,
  type Handle,
  handleAt,
  pieceCorners,
  wallOutline,
} from "./handles";

const DEG = Math.PI / 180;
const rotate = ([x, y]: Pt, deg: number): Pt => [
  x * Math.cos(deg * DEG) - y * Math.sin(deg * DEG),
  x * Math.sin(deg * DEG) + y * Math.cos(deg * DEG),
];

function handleOf(home: Home, id: string, kind: Handle["kind"], cmPerPx = 1): Handle {
  const h = elementHandles(home, id, cmPerPx).find((x) => x.kind === kind);
  if (!h) throw new Error(`no ${kind} handle`);
  return h;
}

/** Drags a handle of `id` in `home` to `p`. */
function drag(home: Home, id: string, kind: Handle["kind"], p: Pt, magnetism = true) {
  const shapes = home.walls.map(straightShape);
  return dragHandle(home, shapes, null, handleOf(home, id, kind), p, 10, magnetism);
}

describe("pieceCorners", () => {
  it("lists the corners from the back left, clockwise in the plan", () => {
    expect(pieceCorners(10, 20, 100, 50, 0)).toEqual([
      [-40, -5],
      [60, -5],
      [60, 45],
      [-40, 45],
    ]);
  });

  it("turns the corners with the piece", () => {
    const corners = pieceCorners(0, 0, 100, 50, Math.PI / 2).map((p) => roundPt(p));
    expect(corners[0]).toEqual([25, -50]);
    expect(corners[2]).toEqual([-25, 50]);
  });
});

describe("wallOutline", () => {
  it("is a rectangle for straight walls", () => {
    expect(wallOutline([0, 0], [100, 0], 10, null).map((p) => roundPt(p))).toEqual([
      [0, -5],
      [100, -5],
      [100, 5],
      [0, 5],
    ]);
  });
});

describe("directionDeg", () => {
  it("measures clockwise from the x axis (y down)", () => {
    expect(directionDeg([0, 0], [1, 0])).toBe(0);
    expect(directionDeg([0, 0], [0, 1])).toBe(90);
    expect(directionDeg([0, 0], [-1, 0])).toBe(180);
    expect(directionDeg([0, 0], [0, -1])).toBe(270);
  });

  it("rounds to a tenth of a degree", () => {
    expect(directionDeg([0, 0], [100, 100 * Math.tan(12.34 * DEG)])).toBe(12.3);
  });

  it("wraps directions just below 360° to 0", () => {
    expect(directionDeg([0, 0], [1000, -0.5])).toBe(0);
  });
});

describe("handleAt", () => {
  const handles: Handle[] = [
    { id: "a", kind: "wall-start", index: 0, pos: [0, 0] },
    { id: "a", kind: "wall-end", index: 0, pos: [10, 0] },
  ];

  it("finds the closest handle within the radius", () => {
    expect(handleAt(handles, [7, 1], 5)?.kind).toBe("wall-end");
    expect(handleAt(handles, [2, 0], 5)?.kind).toBe("wall-start");
  });

  it("finds nothing outside the radius or without handles", () => {
    expect(handleAt(handles, [5, 20], 5)).toBeNull();
    expect(handleAt([], [0, 0], 5)).toBeNull();
  });
});

describe("elementHandles", () => {
  const wall = makeWall("w", [0, 0], [200, 0]);

  it("gives walls their end, arc, thickness and rotation handles", () => {
    const handles = elementHandles(makeHome({ walls: [wall] }), "w", 2);
    expect(handles.map((h) => h.kind)).toEqual([
      "wall-start",
      "wall-end",
      "wall-arc",
      "wall-thickness",
      "wall-rotate",
    ]);
    expect(handles[2].pos).toEqual([100, 0]);
    // Beyond the end by 22 px
    expect(handles[4].pos).toEqual([244, 0]);
    // On the left side (y < 0), outside the wall
    expect(handles[3].pos[1]).toBeLessThan(-5);
  });

  it("puts the arc handle on the arc of a curved wall", () => {
    const arc = makeWall("w", [0, 0], [200, 0], { arc_extent: Math.PI / 2 });
    const mid = handleOf(makeHome({ walls: [arc] }), "w", "wall-arc").pos;
    expect(Math.abs(mid[1])).toBeCloseTo(200 / Math.SQRT2 - 100);
  });

  it("gives rooms their points and label handles", () => {
    const pts: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    const room = makeRoom(pts, { id: "r", name: "Kitchen", area_visible: true });
    const kinds = elementHandles(makeHome({ rooms: [room] }), "r", 1).map((h) => h.kind);
    expect(kinds).toEqual(["room-point", "room-point", "room-point", "room-name", "room-area"]);
  });

  it("gives degenerate rooms no label handles", () => {
    const room = makeRoom(
      [
        [0, 0],
        [100, 0],
      ],
      { id: "r", name: "Line", area_visible: true },
    );
    expect(elementHandles(makeHome({ rooms: [room] }), "r", 1)).toHaveLength(2);
  });

  it("gives polylines and dimension lines their points", () => {
    const pl = makePolyline(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      { id: "p" },
    );
    const dim = makeDimension([0, 0], [50, 0], { id: "d" });
    const home = makeHome({ polylines: [pl], dimension_lines: [dim] });
    expect(elementHandles(home, "p", 1).map((h) => h.index)).toEqual([0, 1, 2]);
    expect(elementHandles(home, "d", 1).map((h) => h.kind)).toEqual([
      "dimension-start",
      "dimension-end",
    ]);
  });

  it("gives resizable pieces four handles and others two", () => {
    const piece = makePiece({ id: "p" });
    expect(elementHandles(makeHome({ furniture: [piece] }), "p", 1)).toHaveLength(4);
    const fixed = makePiece({ id: "p", resizable: false });
    expect(elementHandles(makeHome({ furniture: [fixed] }), "p", 1).map((h) => h.kind)).toEqual([
      "piece-rotate",
      "piece-elevation",
    ]);
    const tilted = makePiece({ id: "p", roll: 0.2 });
    expect(elementHandles(makeHome({ furniture: [tilted] }), "p", 1)).toHaveLength(2);
  });

  it("places the piece icons outside the corners", () => {
    const piece = makePiece({ id: "p", width: 100, depth: 50 });
    const rotateHandle = handleOf(makeHome({ furniture: [piece] }), "p", "piece-rotate");
    expect(rotateHandle.anchor).toEqual([-50, -25]);
    expect(rotateHandle.pos[0]).toBeLessThan(-50);
    expect(rotateHandle.pos[1]).toBeLessThan(-25);
  });

  it("gives the compass a rotation and a size handle", () => {
    const home = makeHome({
      compass: {
        attrs: {
          x: 0,
          y: 0,
          diameter: 100,
          north_direction: 0,
          latitude: null,
          longitude: null,
          visible: true,
        },
      },
    });
    const handles = elementHandles(home, "compass", 1);
    expect(handles.map((h) => h.kind)).toEqual(["compass-rotate", "compass-resize"]);
    // Above the tip of the north arrow
    expect(handles[0].pos[0]).toBeCloseTo(0);
    expect(handles[0].pos[1]).toBeLessThan(-50);
  });

  it("has no handles for unknown elements", () => {
    expect(elementHandles(makeHome(), "nothing", 1)).toEqual([]);
  });
});

describe("dragHandle on walls", () => {
  const home = makeHome({ walls: [makeWall("w", [0, 0], [200, 0])] });

  it("snaps a dragged wall end to the x axis and rounds its length", () => {
    const d = drag(home, "w", "wall-end", [300.3, 4]);
    expect(d?.command).toBe("wall_update");
    expect(d?.params.x_end).toBeCloseTo(300);
    expect(d?.params.y_end as number).toBeCloseTo(0);
    expect(d?.info).toBe("300 cm · 0°");
  });

  it("moves the wall end freely without magnetism", () => {
    const d = drag(home, "w", "wall-end", [300.3, 4], false);
    expect(d?.params).toEqual({ id: "w", x_end: 300.3, y_end: 4 });
  });

  it("refuses walls shorter than 1 cm", () => {
    expect(drag(home, "w", "wall-end", [0.5, 0], false)).toBeNull();
  });

  it("changes the thickness by the distance from the axis", () => {
    // The handle sits 22 px · 0.6 beside the wall side (cmPerPx 1)
    const d = drag(home, "w", "wall-thickness", [100, -(5 + 13.2 + 5)]);
    expect(d?.params).toEqual({ id: "w", thickness: 20 });
    expect(d?.info).toBe("Thickness 20 cm");
  });

  it("keeps a minimal thickness", () => {
    const d = drag(home, "w", "wall-thickness", [100, 0]);
    expect(d?.params.thickness).toBe(1);
  });

  it("bends the wall into an arc from the sagitta", () => {
    const h = 100 * Math.tan(22.5 * DEG);
    const d = drag(home, "w", "wall-arc", [100, -h]);
    expect(d?.params).toEqual({ id: "w", arc_extent_deg: 90 });
    expect(d?.info).toBe("Arc 90°");
  });

  it("straightens the wall for tiny bends", () => {
    const d = drag(home, "w", "wall-arc", [100, -0.2], false);
    expect(d?.params.arc_extent_deg).toBe(0);
    expect(d?.info).toBe("Straight");
  });

  it("rotates the wall around its center in angle steps", () => {
    const d = drag(home, "w", "wall-rotate", [150, 52]);
    expect(d?.info).toBe("45°");
    const r = 100 / Math.SQRT2;
    expect(d?.params).toEqual({
      id: "w",
      x_start: Math.round((100 - r) * 100) / 100,
      y_start: Math.round(-r * 100) / 100,
      x_end: Math.round((100 + r) * 100) / 100,
      y_end: Math.round(r * 100) / 100,
    });
  });

  it("returns null for walls that no longer exist", () => {
    const handle: Handle = { id: "gone", kind: "wall-end", index: 0, pos: [0, 0] };
    expect(dragHandle(home, [], null, handle, [1, 1], 10, true)).toBeNull();
  });
});

describe("dragHandle on rooms, polylines and dimensions", () => {
  const square = makeRoom(
    [
      [0, 0],
      [200, 0],
      [200, 200],
      [0, 200],
    ],
    { id: "r", name: "Hall", area_visible: true },
  );

  it("snaps the room name back to its automatic position", () => {
    const d = drag(makeHome({ rooms: [square] }), "r", "room-name", [102, 62]);
    expect(d?.snap).toEqual([100, 60]);
    expect(d?.params).toEqual({ id: "r", reset_name_position: true });
    expect(d?.info).toBe("automatic position");
  });

  it("stores the label offset from the bounding box center", () => {
    const d = drag(makeHome({ rooms: [square] }), "r", "room-area", [150.4, 149.6]);
    expect(d?.params).toEqual({ id: "r", area_x_offset: 50, area_y_offset: 50 });
    expect(d?.text?.text).toBe("4.00 m²");
  });

  it("moves a room corner", () => {
    const home = makeHome({ rooms: [square] });
    const handle = elementHandles(home, "r", 1)[2];
    const d = dragHandle(home, [], null, handle, [250, 260], 10, false);
    expect(d?.params.points).toEqual([
      [0, 0],
      [200, 0],
      [250, 260],
      [0, 200],
    ]);
  });

  it("moves a polyline point and measures from the previous one", () => {
    const pl = makePolyline(
      [
        [0, 0],
        [100, 0],
      ],
      { id: "p" },
    );
    const handle = elementHandles(makeHome({ polylines: [pl] }), "p", 1)[1];
    const d = dragHandle(makeHome({ polylines: [pl] }), [], null, handle, [150, 0], 10, false);
    expect(d?.params.points).toEqual([
      [0, 0],
      [150, 0],
    ]);
    expect(d?.info).toBe("150 cm");
  });

  it("moves the end of a dimension line", () => {
    const dim = makeDimension([0, 0], [100, 0], { id: "d" });
    const d = drag(makeHome({ dimension_lines: [dim] }), "d", "dimension-end", [120, 30], false);
    expect(d?.params).toEqual({ id: "d", x_end: 120, y_end: 30 });
    expect(d?.preview[0].pts).toEqual([
      [0, 0],
      [120, 30],
    ]);
  });
});

describe("dragHandle on furniture and the compass", () => {
  const piece = makePiece({ id: "p", width: 100, depth: 50, height: 80 });

  it("rotates a piece by the angle of its back left corner", () => {
    const d = drag(makeHome({ furniture: [piece] }), "p", "piece-rotate", rotate([-50, -25], 31));
    expect(d?.params).toEqual({ id: "p", angle_deg: 30 });
  });

  it("wraps a rotation of almost 360° to 0°", () => {
    const d = drag(makeHome({ furniture: [piece] }), "p", "piece-rotate", rotate([-50, -25], -1));
    expect(d?.params.angle_deg).toBe(0);
  });

  it("resizes a piece and keeps its back left corner", () => {
    const home = makeHome({ furniture: [piece] });
    const h = handleOf(home, "p", "piece-resize");
    const offset: Pt = [h.pos[0] - 50, h.pos[1] - 25];
    const d = dragHandle(home, [], null, h, [70 + offset[0], 35 + offset[1]], 10, true);
    expect(d?.params).toEqual({ id: "p", x: 10, y: 5, width: 120, depth: 60 });
  });

  it("resizes proportional pieces in all directions", () => {
    const fixed = makePiece({ id: "p", width: 100, depth: 50, height: 80, deformable: false });
    const home = makeHome({ furniture: [fixed] });
    const h = handleOf(home, "p", "piece-resize");
    const offset: Pt = [h.pos[0] - 50, h.pos[1] - 25];
    const d = dragHandle(home, [], null, h, [70 + offset[0], 25 + offset[1]], 10, true);
    expect(d?.params).toMatchObject({ width: 120, depth: 60, height: 96 });
  });

  it("changes the height by the vertical drag distance", () => {
    const home = makeHome({ furniture: [piece] });
    const h = handleOf(home, "p", "piece-height");
    const d = dragHandle(home, [], null, h, [h.pos[0], h.pos[1] - 20.4], 10, true);
    expect(d?.params).toEqual({ id: "p", height: 100 });
  });

  it("scales proportional pieces with their height", () => {
    const fixed = makePiece({ id: "p", width: 100, depth: 50, height: 80, deformable: false });
    const home = makeHome({ furniture: [fixed] });
    const h = handleOf(home, "p", "piece-height");
    const d = dragHandle(home, [], null, h, [h.pos[0], h.pos[1] - 20], 10, true);
    expect(d?.params).toEqual({ id: "p", height: 100, width: 125, depth: 62.5 });
  });

  it("does not lower a piece below the floor", () => {
    const home = makeHome({ furniture: [piece] });
    const h = handleOf(home, "p", "piece-elevation");
    const d = dragHandle(home, [], null, h, [h.pos[0], h.pos[1] + 50], 10, true);
    expect(d?.params).toEqual({ id: "p", elevation: 0 });
  });

  it("snaps the elevation to the top of the furniture below", () => {
    const vase = makePiece({ id: "vase", width: 10, depth: 10, height: 30 });
    const table = makePiece({ id: "table", name: "Table", width: 150, depth: 80, height: 75 });
    const home = makeHome({ furniture: [table, vase] });
    const h = handleOf(home, "vase", "piece-elevation");
    const d = dragHandle(home, [], null, h, [h.pos[0], h.pos[1] - 73], 10, true);
    expect(d?.params).toEqual({ id: "vase", elevation: 75 });
    expect(d?.info).toBe("Elevation 75 cm · on Table");
  });

  const compassHome = makeHome({
    compass: {
      attrs: {
        x: 0,
        y: 0,
        diameter: 100,
        north_direction: 0,
        latitude: null,
        longitude: null,
        visible: true,
      },
    },
  });

  it("turns north towards the pointer, clockwise from the top", () => {
    const right = drag(compassHome, "compass", "compass-rotate", [100, 0]);
    expect(right?.params).toEqual({ north_direction_deg: 90 });
    expect(right?.info).toBe("North 90°");
    const left = drag(compassHome, "compass", "compass-rotate", [-100, -1]);
    expect(left?.params).toEqual({ north_direction_deg: 270 });
  });

  it("resizes the compass with a minimum diameter", () => {
    const d = drag(compassHome, "compass", "compass-resize", [0, 0]);
    expect(d?.params).toEqual({ diameter: 10 });
  });
});
