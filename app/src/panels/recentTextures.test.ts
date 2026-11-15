import { describe, expect, it } from "vitest";
import { addRecent } from "./recentTextures";

describe("recent textures", () => {
  it("puts the chosen texture first and drops the oldest beyond the maximum", () => {
    let list: string[] = [];
    for (const id of ["a", "b", "c", "d", "e", "f"]) list = addRecent(list, id);
    expect(list).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("keeps a texture chosen again only once, at the front", () => {
    expect(addRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(addRecent(["a"], "")).toEqual(["a"]);
  });
});
