import { describe, expect, it } from "vitest";
import { clampSide, draggedSide, SIDE_MAX, SIDE_MIN } from "./layout";

describe("draggedSide", () => {
  it("keeps the width within the limits", () => {
    expect(draggedSide(300)).toEqual({ width: 300, hidden: false });
    expect(draggedSide(150)).toEqual({ width: SIDE_MIN, hidden: false });
    expect(draggedSide(2000)).toEqual({ width: SIDE_MAX, hidden: false });
  });

  it("hides a panel dragged almost shut and keeps its width", () => {
    expect(draggedSide(60)).toEqual({ width: null, hidden: true });
    expect(draggedSide(-5)).toEqual({ width: null, hidden: true });
  });
});

describe("clampSide", () => {
  it("rounds to whole pixels", () => {
    expect(clampSide(250.6)).toBe(251);
  });
});
