import { describe, expect, it } from "vitest";
import { fuzzyScore, queryScore } from "./fuzzy";

describe("fuzzyScore", () => {
  it("prefers the start of the text, then the start of a word, then the inside", () => {
    expect(fuzzyScore("round walls", "round")).toBe(0);
    expect(fuzzyScore("round walls", "walls")).toBe(1);
    expect(fuzzyScore("round walls", "all")).toBe(2);
  });

  it("finds letters in their order and counts the gaps", () => {
    expect(fuzzyScore("round walls", "rw")).toBe(3 + 5);
    expect(fuzzyScore("round walls", "rdw")).toBeGreaterThan(3);
    expect(fuzzyScore("round walls", "wr")).toBeNull();
    expect(fuzzyScore("round walls", "x")).toBeNull();
  });
});

describe("queryScore", () => {
  it("needs every word and adds the scores", () => {
    expect(queryScore("zoom to the selection", ["zoom", "sel"])).toBe(1);
    expect(queryScore("zoom to the selection", ["zoom", "wall"])).toBeNull();
    expect(queryScore("anything", [])).toBe(0);
  });
});
