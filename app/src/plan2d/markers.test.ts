import { describe, expect, it } from "vitest";
import { markerShape, noteText } from "./markers";

describe("markerShape", () => {
  it("tells the kind of snap point", () => {
    expect(markerShape("wall end")).toBe("square");
    expect(markerShape("corner of Bed")).toBe("square");
    expect(markerShape("close")).toBe("square");
    expect(markerShape("wall middle")).toBe("triangle");
    expect(markerShape("wall corner")).toBe("cross");
    expect(markerShape("ruler crossing")).toBe("cross");
    expect(markerShape("flush with wall end")).toBe("cross");
    expect(markerShape("perpendicular")).toBe("perpendicular");
    expect(markerShape("ruler end")).toBe("diamond");
    expect(markerShape("ruler middle")).toBe("diamond");
    expect(markerShape("on ruler")).toBe("circle");
    expect(markerShape("on wall face")).toBe("circle");
    expect(markerShape(null)).toBe("circle");
  });
});

describe("noteText", () => {
  it("keeps unknown parts and translates each part", () => {
    // Tests run in English: the texts stay, names and distances too
    expect(noteText("in line with Bed · 10 cm | 20 cm")).toBe("in line with Bed · 10 cm | 20 cm");
    expect(noteText("perpendicular")).toBe("perpendicular");
  });
});
