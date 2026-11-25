import { describe, expect, it } from "vitest";
import { escapeStep } from "./dialogEscape";

const field = (value: string, before: string, search = false) => ({ value, before, search });

describe("escapeStep", () => {
  it("takes back what was typed before anything closes", () => {
    expect(escapeStep(field("Sofa 2", "Sofa"), false)).toBe("restore");
    expect(escapeStep(field("Sofa 2", "Sofa"), true)).toBe("restore");
  });

  it("only leaves an unchanged text field", () => {
    expect(escapeStep(field("Sofa", "Sofa"), false)).toBe("leave");
    expect(escapeStep(field("Sofa", "Sofa"), true)).toBe("leave");
  });

  it("empties a search before leaving it", () => {
    expect(escapeStep(field("oak", "oak", true), false)).toBe("clear");
    expect(escapeStep(field("", "oak", true), false)).toBe("leave");
  });

  it("closes outside of text fields, with a question if something was entered", () => {
    expect(escapeStep(null, false)).toBe("close");
    expect(escapeStep(null, true)).toBe("ask");
  });
});
