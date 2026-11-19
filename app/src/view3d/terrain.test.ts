import { describe, expect, it } from "vitest";
import { makeHome, makePiece } from "../testFixtures";
import { groundHoles, groundHolesKey } from "./terrain";

const terrain = (attrs: Record<string, unknown>, flags = ["reference", "terrain"]) =>
  makePiece(
    { width: 2000, depth: 1000, ...attrs },
    { properties: flags.map((f) => ({ name: `mySweetHome.${f}`, value: "true" })) },
  );

describe("holes of the ground under terrain", () => {
  it("is the footprint of each terrain object", () => {
    const home = makeHome({ furniture: [terrain({ id: "t", x: 500, y: 100 })] });
    expect(groundHoles(home)).toEqual([
      [
        [-500, -400],
        [1500, -400],
        [1500, 600],
        [-500, 600],
      ],
    ]);
  });

  it("turns with the object", () => {
    const home = makeHome({ furniture: [terrain({ id: "t", x: 0, y: 0, angle: Math.PI / 2 })] });
    const [ring] = groundHoles(home);
    expect(ring[0][0]).toBeCloseTo(500, 6);
    expect(ring[0][1]).toBeCloseTo(-1000, 6);
  });

  it("leaves the ground as it is for other pieces and hidden terrain", () => {
    const home = makeHome({
      furniture: [
        terrain({ id: "scan" }, ["reference"]),
        terrain({ id: "furniture" }, ["terrain"]),
        terrain({ id: "hidden", visible: false }),
      ],
    });
    expect(groundHoles(home)).toEqual([]);
    expect(groundHolesKey(home)).toBe("[]");
  });

  it("keeps the first of two terrain objects that overlap", () => {
    const home = makeHome({
      furniture: [
        terrain({ id: "a", x: 0, y: 0 }),
        terrain({ id: "b", x: 500, y: 0 }),
        terrain({ id: "c", x: 5000, y: 0 }),
      ],
    });
    expect(groundHoles(home)).toHaveLength(2);
  });
});
