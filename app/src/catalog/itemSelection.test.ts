import { describe, expect, it } from "vitest";
import {
  afterRemoval,
  clickItem,
  NO_ITEMS,
  selectAll,
  selectOnly,
  sharedValue,
  walkItems,
} from "./itemSelection";

const ORDER = ["a", "b", "c", "d", "e"];

describe("clickItem", () => {
  it("selects one item without modifiers", () => {
    const sel = clickItem({ keys: ["a", "b"], primary: "b", anchor: "a" }, ORDER, "d", {});
    expect(sel).toEqual({ keys: ["d"], primary: "d", anchor: "d" });
  });

  it("adds and takes out with Ctrl", () => {
    const two = clickItem(selectOnly("a"), ORDER, "c", { ctrlKey: true });
    expect(two).toEqual({ keys: ["a", "c"], primary: "c", anchor: "c" });
    const one = clickItem(two, ORDER, "c", { ctrlKey: true });
    expect(one).toEqual({ keys: ["a"], primary: "a", anchor: "c" });
    expect(clickItem(one, ORDER, "a", { ctrlKey: true }).primary).toBeNull();
  });

  it("selects the range from the anchor with Shift, in both directions", () => {
    const down = clickItem(selectOnly("b"), ORDER, "d", { shiftKey: true });
    expect(down).toEqual({ keys: ["b", "c", "d"], primary: "d", anchor: "b" });
    const up = clickItem(down, ORDER, "a", { shiftKey: true });
    expect(up).toEqual({ keys: ["a", "b"], primary: "a", anchor: "b" });
  });

  it("adds a range with Ctrl and Shift", () => {
    const sel = clickItem({ keys: ["a", "c"], primary: "c", anchor: "c" }, ORDER, "e", {
      ctrlKey: true,
      shiftKey: true,
    });
    expect(sel.keys).toEqual(["a", "c", "d", "e"]);
  });

  it("selects one item when the anchor is not in the list any more", () => {
    const sel = clickItem(selectOnly("x"), ORDER, "c", { shiftKey: true });
    expect(sel.keys).toEqual(["c"]);
  });
});

describe("walkItems", () => {
  it("goes up and down and stops at the ends", () => {
    expect(walkItems(selectOnly("b"), ORDER, "down", false).keys).toEqual(["c"]);
    expect(walkItems(selectOnly("b"), ORDER, "up", false).keys).toEqual(["a"]);
    expect(walkItems(selectOnly("e"), ORDER, "down", false).keys).toEqual(["e"]);
    expect(walkItems(selectOnly("a"), ORDER, "last", false).keys).toEqual(["e"]);
    expect(walkItems(NO_ITEMS, ORDER, "down", false).keys).toEqual(["a"]);
    expect(walkItems(NO_ITEMS, [], "down", false)).toBe(NO_ITEMS);
  });

  it("extends the range with Shift and shrinks it again", () => {
    const two = walkItems(selectOnly("b"), ORDER, "down", true);
    expect(two.keys).toEqual(["b", "c"]);
    const three = walkItems(two, ORDER, "down", true);
    expect(three.keys).toEqual(["b", "c", "d"]);
    expect(walkItems(three, ORDER, "up", true).keys).toEqual(["b", "c"]);
  });
});

describe("the rest of the selection", () => {
  it("selects all items of the list", () => {
    expect(selectAll(ORDER, selectOnly("c"))).toEqual({ keys: ORDER, primary: "c", anchor: "a" });
    expect(selectAll([], selectOnly("c"))).toBe(NO_ITEMS);
  });

  it("goes to the next item after deleting, else to the one before", () => {
    expect(afterRemoval(ORDER, ["b", "c"])).toBe("d");
    expect(afterRemoval(ORDER, ["a", "c"])).toBe("b");
    expect(afterRemoval(ORDER, ["d", "e"])).toBe("c");
    expect(afterRemoval(ORDER, ORDER)).toBeNull();
    expect(afterRemoval(ORDER, ["x"])).toBeNull();
  });

  it("finds the value the items share", () => {
    expect(sharedValue([{ c: "CC0" }, { c: "CC0" }], (i) => i.c)).toBe("CC0");
    expect(sharedValue([{ c: "CC0" }, { c: "" }], (i) => i.c)).toBeNull();
    expect(sharedValue([], () => "x")).toBeNull();
  });
});
