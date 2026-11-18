import { describe, expect, it } from "vitest";
import { toggledIn } from "./catalogPrefs";

describe("toggledIn", () => {
  it("adds a missing value at the end and removes a present one", () => {
    expect(toggledIn(["a"], "b")).toEqual(["a", "b"]);
    expect(toggledIn(["a", "b"], "a")).toEqual(["b"]);
  });
});
