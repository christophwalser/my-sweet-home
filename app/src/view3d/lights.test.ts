import { describe, expect, it } from "vitest";
import { makeHome } from "../testFixtures";
import { visitLampLevels } from "./lights";

describe("visitLampLevels", () => {
  const level = (id: string) => ({ attrs: { id } });

  it("lights the visit with the lamps of the level the visitor stands on", () => {
    // The lamps under the ceiling of the level below would shine through the floor
    const home = makeHome({ levels: [level("ug"), level("eg")] as never });
    const shown = new Set<string | null>(["ug", "eg"]);
    expect([...visitLampLevels(home, "eg", shown)]).toEqual(["eg"]);
    expect([...visitLampLevels(home, "ug", shown)]).toEqual(["ug"]);
  });

  it("keeps a level dark that is not shown", () => {
    const home = makeHome({ levels: [level("ug"), level("eg")] as never });
    expect(visitLampLevels(home, "eg", new Set(["ug"])).size).toBe(0);
  });

  it("uses all lamps of a home without levels", () => {
    const shown = new Set<string | null>([null]);
    expect(visitLampLevels(makeHome(), null, shown)).toBe(shown);
  });
});
