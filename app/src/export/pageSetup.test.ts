import { describe, expect, it } from "vitest";
import { pageParams, paperParam, scaleParam } from "./pageSetup";

describe("page setup of the export dialog", () => {
  it("gives named and custom papers", () => {
    expect(paperParam("a1", 0, 0)).toBe("a1");
    expect(paperParam("custom", 700.4, 500)).toBe("700x500");
    // Out of range sizes are kept within what the export takes
    expect(paperParam("custom", 10, 9000)).toBe("50x5000");
  });

  it("reads scales of one's own", () => {
    expect(scaleParam("fit", "")).toBeUndefined();
    expect(scaleParam("100", "")).toBe(100);
    expect(scaleParam("custom", "1:75")).toBe(75);
    expect(scaleParam("custom", " 1 : 33,3 ")).toBe(33.3);
    expect(scaleParam("custom", "abc")).toBeUndefined();
    expect(scaleParam("custom", "0")).toBeUndefined();
  });

  it("builds the parameters with the title block", () => {
    const tb = { on: true, project: " Villa ", author: "" };
    expect(
      pageParams({ paper: "a2", orientation: "landscape", scale: 50, titleBlock: tb }),
    ).toEqual({ paper: "a2", landscape: true, scale: 50, title_block: { project: "Villa" } });
    expect(
      pageParams({
        paper: "a4",
        orientation: "auto",
        scale: undefined,
        titleBlock: { ...tb, on: false },
      }),
    ).toEqual({ paper: "a4" });
  });
});
