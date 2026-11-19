import { describe, expect, it } from "vitest";
import { makeHome, makePiece } from "../testFixtures";
import { referenceObjects, shownIn, shownOpacity, showParams } from "./referenceObjects";

const scan = (attrs: Record<string, unknown> = {}, flags: Record<string, string> = {}) =>
  makePiece(
    { id: "scan", ...attrs },
    {
      properties: Object.entries({ reference: "true", ...flags }).map(([name, value]) => ({
        name: `mySweetHome.${name}`,
        value,
      })),
    },
  );

describe("reference objects", () => {
  it("lists them, hidden ones too, and no furniture", () => {
    const home = makeHome({
      furniture: [scan(), scan({ id: "hidden", visible: false }), makePiece({ id: "chair" })],
    });
    expect(referenceObjects(home).map((p) => p.attrs.id)).toEqual(["scan", "hidden"]);
    expect(referenceObjects(null)).toEqual([]);
  });

  it("shows in the plan and in 3D unless hidden in one of them", () => {
    expect(shownIn(scan())).toEqual({ plan: true, view3d: true });
    expect(shownIn(scan({}, { planHidden: "true" }))).toEqual({ plan: false, view3d: true });
    expect(shownIn(scan({}, { hidden3d: "true" }))).toEqual({ plan: true, view3d: false });
    expect(shownIn(scan({ visible: false }))).toEqual({ plan: false, view3d: false });
  });

  it("hides one view and leaves the other as it is", () => {
    expect(showParams(scan(), "view3d", false)).toEqual({
      visible: true,
      plan_visible: true,
      view3d_visible: false,
    });
    // The last view hidden: the piece itself is hidden, as Sweet Home 3D does
    expect(showParams(scan({}, { hidden3d: "true" }), "plan", false)).toEqual({
      visible: false,
      plan_visible: true,
      view3d_visible: true,
    });
    // Shown again in the plan only
    expect(showParams(scan({ visible: false }), "plan", true)).toEqual({
      visible: true,
      plan_visible: true,
      view3d_visible: false,
    });
  });

  it("has a faint view from above and full lines of a cut by default", () => {
    expect(shownOpacity(scan())).toBe(35);
    expect(shownOpacity(scan({}, { sectionHeight: "100" }))).toBe(100);
    expect(shownOpacity(scan({}, { sectionHeight: "100", planOpacity: "0.6" }))).toBe(60);
  });
});
