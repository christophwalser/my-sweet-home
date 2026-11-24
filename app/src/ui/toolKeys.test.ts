import { describe, expect, it } from "vitest";
import {
  SECOND_KEY_MS,
  toolForDigit,
  toolForLetter,
  toolLetters,
  toolShortcut,
  withToolKey,
} from "./toolKeys";

describe("tool keys", () => {
  it("chooses the first tool of a group with its digit", () => {
    expect(toolForDigit(null, "2", 0)).toEqual({
      command: "tool.room",
      state: { group: "2", at: 0 },
    });
    expect(toolForDigit(null, "3", 0)).toEqual({ command: "tool.polyline", state: null });
    expect(toolForDigit(null, "9", 0)).toEqual({ command: null, state: null });
  });

  it("chooses a further variant of the group with a second digit typed right after", () => {
    const first = toolForDigit(null, "2", 1000);
    expect(toolForDigit(first.state, "1", 1500)).toEqual({
      command: "tool.roomauto",
      state: null,
    });
    // Too late, or no such variant: the digit chooses its own group
    expect(toolForDigit(first.state, "1", 1000 + SECOND_KEY_MS + 1).command).toBe("tool.wall");
    expect(toolForDigit(first.state, "2", 1500).command).toBe("tool.room");
    expect(toolForDigit(first.state, "4", 1500).command).toBe("tool.dimension");
    expect(toolForDigit(first.state, "0", 1500).command).toBeNull();
  });

  it("names the shortcuts of the tools: the letter, else the digits", () => {
    expect(toolShortcut("tool.wall")).toBe("W");
    expect(toolShortcut("tool.ruler")).toBe("G");
    expect(toolShortcut("tool.select")).toBe("V");
    expect(toolShortcut("tool.arcwall")).toBe("1, 1");
    expect(toolShortcut("tool.dimchain")).toBe("4, 1");
    expect(toolShortcut("tool.heightdim")).toBe("4, 2");
    expect(toolShortcut("tool.nope")).toBeUndefined();
  });

  it("chooses tools by letter, in either case", () => {
    expect(toolForLetter("W")).toBe("tool.wall");
    expect(toolForLetter("m")).toBe("tool.measure");
    // R rotates and J joins the selection: no tools
    expect(toolForLetter("R")).toBeNull();
    expect(toolForLetter("J")).toBeNull();
  });
});

describe("custom tool letters", () => {
  it("replaces the default letter of a tool", () => {
    const letters = toolLetters({ "tool.wall": "A" });
    expect(letters.A).toBe("tool.wall");
    expect(letters.W).toBeUndefined();
    expect(toolLetters({ "tool.measure": "" }).M).toBeUndefined();
  });

  it("takes a letter from the tool that had it", () => {
    const custom = withToolKey({}, "tool.arcwall", "w");
    expect(custom).toEqual({ "tool.arcwall": "W", "tool.wall": "" });
    expect(toolLetters(custom).W).toBe("tool.arcwall");
  });

  it("refuses reserved letters and anything that is no letter", () => {
    expect(withToolKey({}, "tool.wall", "R")).toEqual({});
    expect(withToolKey({}, "tool.wall", "1")).toEqual({});
    expect(withToolKey({}, "tool.wall", "")).toEqual({ "tool.wall": "" });
  });
});
