import { describe, expect, it } from "vitest";
import { SECOND_KEY_MS, toolForDigit, toolShortcut } from "./toolKeys";

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

  it("names the shortcuts of the tools", () => {
    expect(toolShortcut("tool.wall")).toBe("1");
    expect(toolShortcut("tool.ruler")).toBe("6, 1");
    expect(toolShortcut("tool.select")).toBeUndefined();
  });
});
