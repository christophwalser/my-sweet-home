import { describe, expect, it } from "vitest";
import { errorText } from "./errorText";

describe("error text", () => {
  it("explains known errors of the core", () => {
    expect(errorText("parallel walls cannot be joined")).toBe(
      "Parallel walls cannot be joined: their axes never meet.",
    );
    expect(errorText("unknown wall 'wall-1'")).toMatch(/no longer exists/);
    expect(errorText("Error: thickness must be positive")).toBe(
      "The value must be greater than zero.",
    );
    expect(errorText("invalid parameters for 'wall_update': speed must be a number")).toBe(
      "Enter a number.",
    );
    expect(errorText("address search failed: timeout")).toMatch(/\(timeout\)$/);
  });

  it("keeps the reason of unknown errors", () => {
    expect(errorText("something odd")).toBe("The action failed: something odd");
  });
});
