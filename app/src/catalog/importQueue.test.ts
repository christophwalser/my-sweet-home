import { describe, expect, it } from "vitest";
import { modelQueue } from "./importQueue";

describe("modelQueue", () => {
  it("takes the models by name and leaves out what belongs to them", () => {
    expect(
      modelQueue([
        "C:\\m\\chair 10.obj",
        "C:\\m\\chair 10.mtl",
        "C:\\m\\oak.jpg",
        "C:\\m\\chair 2.obj",
        "C:\\m\\lib.sh3f",
      ]),
    ).toEqual(["C:\\m\\chair 2.obj", "C:\\m\\chair 10.obj"]);
  });

  it("takes a model in several formats once, in the best one", () => {
    expect(
      modelQueue(["C:\\m\\Sofa.obj", "C:\\m\\sofa.GLB", "C:\\m\\sofa.stl", "C:\\n\\sofa.obj"]),
    ).toEqual(["C:\\m\\sofa.GLB", "C:\\n\\sofa.obj"]);
  });

  it("takes archives with a model along", () => {
    expect(modelQueue(["/m/table.ply"], ["/m/bed.zip"])).toEqual(["/m/bed.zip", "/m/table.ply"]);
    expect(modelQueue([])).toEqual([]);
  });
});
