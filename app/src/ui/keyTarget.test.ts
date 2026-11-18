import { describe, expect, it } from "vitest";
import { keyTarget } from "./keyTarget";

describe("keyTarget", () => {
  it("treats text fields as typing", () => {
    expect(keyTarget({ tagName: "INPUT", type: "text" })).toBe("text");
    expect(keyTarget({ tagName: "INPUT" })).toBe("text");
    expect(keyTarget({ tagName: "INPUT", type: "search" })).toBe("text");
    expect(keyTarget({ tagName: "TEXTAREA" })).toBe("text");
    expect(keyTarget({ tagName: "DIV", isContentEditable: true })).toBe("text");
  });

  it("leaves Ctrl shortcuts to the app in check boxes and drop-downs", () => {
    expect(keyTarget({ tagName: "INPUT", type: "checkbox" })).toBe("control");
    expect(keyTarget({ tagName: "INPUT", type: "Color" })).toBe("control");
    expect(keyTarget({ tagName: "INPUT", type: "range" })).toBe("control");
    expect(keyTarget({ tagName: "SELECT" })).toBe("control");
  });

  it("gives all keys of other elements to the app", () => {
    expect(keyTarget({ tagName: "BUTTON" })).toBe("other");
    expect(keyTarget({ tagName: "CANVAS" })).toBe("other");
    expect(keyTarget(null)).toBe("other");
  });
});
