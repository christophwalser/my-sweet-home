import { describe, expect, it } from "vitest";
import { makeHome, makePiece, makeRoom, makeWall, straightShape } from "../testFixtures";
import { surfaceAt } from "./surfaces";

describe("surfaceAt", () => {
  // A wall along the x axis (left side at y = -5), a room below it with a table
  const wall = makeWall("wall", [0, 0], [400, 0], { thickness: 10 });
  const room = makeRoom(
    [
      [0, 5],
      [400, 5],
      [400, 300],
      [0, 300],
    ],
    { id: "room" },
  );
  const table = makePiece({ id: "table", x: 200, y: 150, width: 80, depth: 60 });
  const home = makeHome({ walls: [wall], rooms: [room], furniture: [table] });
  const shapes = [straightShape(wall)];

  it("finds the side of a wall nearer to the point", () => {
    expect(surfaceAt(home, shapes, null, [100, -3], 2)).toMatchObject({
      id: "wall",
      surface: "left_side",
      closed: false,
    });
    const right = surfaceAt(home, shapes, null, [100, 3], 2);
    expect(right?.surface).toBe("right_side");
    expect(right?.outline).toEqual(shapes[0].right);
  });

  it("finds the floor of a room and a piece standing in it", () => {
    expect(surfaceAt(home, shapes, null, [50, 250], 2)).toMatchObject({
      id: "room",
      surface: "floor",
      closed: true,
    });
    expect(surfaceAt(home, shapes, null, [200, 150], 2)).toMatchObject({
      id: "table",
      surface: "piece",
    });
  });

  it("finds nothing beside the plan", () => {
    expect(surfaceAt(home, shapes, null, [900, 900], 2)).toBeNull();
  });
});
