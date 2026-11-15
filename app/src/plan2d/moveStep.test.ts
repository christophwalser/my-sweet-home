import { describe, expect, it } from "vitest";
import { dragStep, lockAxis, nudgeStep, roundTo } from "./moveStep";

describe("move precision", () => {
  it("rounds drags finer when zoomed in", () => {
    expect(dragStep(3, true)).toBe(1);
    expect(dragStep(0.8, true)).toBe(1);
    expect(dragStep(0.4, true)).toBe(0.5);
    expect(dragStep(0.15, true)).toBe(0.2);
    expect(dragStep(0.02, true)).toBe(0.1);
    expect(dragStep(3, false)).toBe(0.01);
  });

  it("rounds without floating point noise", () => {
    expect(roundTo(0.31, 0.1)).toBe(0.3);
    expect(roundTo(12.26, 0.2)).toBe(12.2);
    expect(roundTo(-7.6, 1)).toBe(-8);
  });

  it("locks a drag to the closer axis", () => {
    expect(lockAxis([30, 4])).toEqual([30, 0]);
    const [lx, ly] = lockAxis([-3, -25]);
    expect(Math.abs(lx)).toBe(0);
    expect(ly).toBe(-25);
    // Along a piece turned by 45°
    const [x, y] = lockAxis([10, 2], Math.PI / 4);
    expect(x).toBeCloseTo(6);
    expect(y).toBeCloseTo(6);
  });

  it("moves by 1 mm, 1 cm or 10 cm with the arrow keys", () => {
    expect(nudgeStep(true, false)).toBe(0.1);
    expect(nudgeStep(false, false)).toBe(1);
    expect(nudgeStep(false, true)).toBe(10);
  });
});
