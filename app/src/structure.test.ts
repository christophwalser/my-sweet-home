import { describe, expect, it } from "vitest";
import { shareStructure } from "./structure";

const piece = (id: string, x: number) => ({ attrs: { id, x }, tags: ["a", "b"] });

describe("shareStructure", () => {
  it("returns the previous value when nothing differs", () => {
    const prev = { walls: [piece("w1", 0)], name: "Home" };
    const next = structuredClone(prev);
    expect(shareStructure(prev, next)).toBe(prev);
  });

  it("keeps the unchanged elements of a list and replaces the changed one", () => {
    const prev = { furniture: [piece("a", 0), piece("b", 0)], walls: [piece("w", 0)] };
    const next = structuredClone(prev);
    next.furniture[1].attrs.x = 5;
    const shared = shareStructure(prev, next);
    expect(shared).not.toBe(prev);
    expect(shared.furniture).not.toBe(prev.furniture);
    expect(shared.furniture[0]).toBe(prev.furniture[0]);
    expect(shared.furniture[1]).not.toBe(prev.furniture[1]);
    expect(shared.furniture[1].attrs.x).toBe(5);
    // Untouched parts of the changed element and whole untouched lists are shared too
    expect(shared.furniture[1].tags).toBe(prev.furniture[1].tags);
    expect(shared.walls).toBe(prev.walls);
  });

  it("matches elements by their ID when one is added in front or deleted", () => {
    const prev = [piece("a", 0), piece("b", 0)];
    const added = shareStructure(prev, [piece("new", 1), piece("a", 0), piece("b", 0)]);
    expect(added[1]).toBe(prev[0]);
    expect(added[2]).toBe(prev[1]);
    const deleted = shareStructure(prev, [piece("b", 0)]);
    expect(deleted).not.toBe(prev);
    expect(deleted[0]).toBe(prev[1]);
  });

  it("matches lists without IDs by position", () => {
    const prev = [
      [0, 0],
      [1, 1],
    ];
    const shared = shareStructure(prev, [
      [0, 0],
      [2, 2],
    ]);
    expect(shared[0]).toBe(prev[0]);
    expect(shared[1]).toEqual([2, 2]);
  });

  it("takes the new value when the kind of value changes", () => {
    expect(shareStructure<unknown>({ a: 1 }, null)).toBeNull();
    expect(shareStructure<unknown>([1], { 0: 1 })).toEqual({ 0: 1 });
    expect(shareStructure<unknown>({ a: 1 }, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    expect(shareStructure<unknown>(null, { a: 1 })).toEqual({ a: 1 });
  });
});
