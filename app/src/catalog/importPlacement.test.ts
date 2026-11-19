import { describe, expect, it } from "vitest";
import { originPlacement } from "./importPlacement";

describe("placing a model by its zero point", () => {
  // A box of 8 x 5 x 4 m (x, y up, z) that starts at the zero point of its file, in meters
  const center = { x: 4, y: 2.5, z: 2 };
  const extent = { x: 8, y: 5, z: 4 };

  it("puts the middle of the box where the model has it", () => {
    // Imported in its real size: 800 wide, 400 deep, 500 high
    expect(originPlacement(center, extent, [800, 400, 500])).toEqual({
      x: 400,
      y: 200,
      elevation: 0,
    });
  });

  it("follows a size that differs from the model", () => {
    expect(originPlacement(center, extent, [1600, 800, 1000])).toEqual({
      x: 800,
      y: 400,
      elevation: 0,
    });
  });

  it("lifts a model whose box starts above the zero point", () => {
    // The same box 3 m up and 10 m to the back (−z)
    const raised = { x: 4, y: 5.5, z: -8 };
    expect(originPlacement(raised, extent, [800, 400, 500])).toEqual({
      x: 400,
      y: -800,
      elevation: 300,
    });
  });

  it("keeps a flat model where it is", () => {
    const flat = originPlacement({ x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 2 }, [200, 200, 10]);
    expect(flat).toEqual({ x: 100, y: 100, elevation: -5 });
  });
});
