import { describe, expect, it } from "vitest";
import { stepLabel } from "./undoLabels";

describe("stepLabel", () => {
  it("names what a command changed and how", () => {
    expect(stepLabel("wall_update")).toBe("Wall: changed");
    expect(stepLabel("wall_add_path")).toBe("Wall: added");
    expect(stepLabel("furniture_add_in_wall")).toBe("Furniture: added");
    expect(stepLabel("edit_delete")).toBe("Selection: deleted");
    expect(stepLabel("edit_paste_style")).toBe("Selection: style pasted");
    expect(stepLabel("edit_paste")).toBe("Selection: copied");
    expect(stepLabel("level_duplicate")).toBe("Level: copied");
    expect(stepLabel("guide_clear")).toBe("Guide line: deleted");
    expect(stepLabel("background_image_remove")).toBe("Background image: deleted");
    expect(stepLabel("room_walls_update")).toBe("Room: changed");
    expect(stepLabel("furniture_ungroup")).toBe("Furniture: ungrouped");
    expect(stepLabel("dimension_add_height")).toBe("Dimension: added");
  });

  it("shows the name of a command it does not know", () => {
    expect(stepLabel("something_else")).toBe("something_else");
    expect(stepLabel("wall_frobnicate")).toBe("wall_frobnicate");
  });
});
