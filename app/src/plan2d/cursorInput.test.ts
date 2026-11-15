import { describe, expect, it } from "vitest";
import { type CursorInput, inputKey, inputPoint, inputText } from "./cursorInput";

const type = (keys: string[]): CursorInput | null => {
  let input: CursorInput | null = null;
  for (const k of keys) {
    const next = inputKey(input, k);
    if (next !== undefined) input = next;
  }
  return input;
};

const near = (p: [number, number] | null, x: number, y: number) => {
  expect(p).not.toBeNull();
  expect(p?.[0]).toBeCloseTo(x, 2);
  expect(p?.[1]).toBeCloseTo(y, 2);
};

describe("inputKey", () => {
  it("starts with digits and ignores other keys before", () => {
    expect(inputKey(null, "a")).toBeUndefined();
    expect(inputKey(null, "+")).toBeUndefined();
    expect(type(["3", "0", "0"])).toEqual({ length: "300", angle: null, field: "length" });
    expect(type([","])?.length).toBe("0.");
  });

  it("switches to the angle with Tab and back with Backspace", () => {
    const i = type(["2", "0", "0", "Tab", "4", "5"]);
    expect(i).toEqual({ length: "200", angle: "45", field: "angle" });
    expect(type(["2", "Tab", "4", "Backspace", "Backspace"])).toEqual({
      length: "2",
      angle: null,
      field: "length",
    });
    expect(type(["Tab", "9", "0"])).toEqual({ length: "", angle: "90", field: "angle" });
    expect(type(["5", "Backspace", "Backspace"])).toBeNull();
  });

  it("separates the coordinates of a point by a comma", () => {
    expect(type(["@", "1", "0", ",", "-", "5"])?.length).toBe("@10;-5");
    expect(type(["1", ",", "5"])?.length).toBe("1.5");
    // A point has no angle field
    expect(type(["#", "1", "Tab"])?.field).toBe("length");
  });
});

describe("inputPoint", () => {
  const unit = "cm" as const;
  it("goes the typed length toward the cursor", () => {
    near(inputPoint(type(["3", "0", "0"]) as CursorInput, [0, 0], [10, 0], unit), 300, 0);
    near(inputPoint(type(["1", "m"]) as CursorInput, [10, 10], [10, 50], unit), 10, 110);
  });

  it("takes the typed angle, clockwise from the x axis", () => {
    near(
      inputPoint(type(["1", "0", "0", "Tab", "9", "0"]) as CursorInput, [0, 0], [-5, 0], unit),
      0,
      100,
    );
    near(
      inputPoint(type(["1", "0", "0", "<", "1", "8", "0"]) as CursorInput, [0, 0], null, unit),
      -100,
      0,
    );
    // Only an angle: the length of the cursor
    near(inputPoint(type(["Tab", "9", "0"]) as CursorInput, [0, 0], [30, 40], unit), 0, 50);
  });

  it("takes relative and absolute points", () => {
    near(
      inputPoint(type(["@", "1", "0", ",", "-", "5"]) as CursorInput, [100, 100], null, unit),
      110,
      95,
    );
    near(
      inputPoint(type(["#", "1", "m", ",", "2", "0"]) as CursorInput, [100, 100], null, unit),
      100,
      20,
    );
  });

  it("gives no point for incomplete input", () => {
    expect(inputPoint(type(["2", "+"]) as CursorInput, [0, 0], [1, 0], unit)).toBeNull();
    expect(inputPoint(type(["@", "2"]) as CursorInput, [0, 0], [1, 0], unit)).toBeNull();
    expect(inputPoint(type(["0"]) as CursorInput, [0, 0], [1, 0], unit)).toBeNull();
  });
});

describe("inputText", () => {
  const labels = { length: "Length", angle: "Angle", point: "Point" };
  it("marks the field being typed", () => {
    expect(inputText(type(["2"]) as CursorInput, "cm", labels)).toBe("Length: 2▏ cm");
    expect(inputText(type(["2", "Tab", "4"]) as CursorInput, "cm", labels)).toBe(
      "Length: 2 cm · Angle: 4▏°",
    );
    expect(inputText(type(["@", "1"]) as CursorInput, "cm", labels)).toBe("Point: @1▏");
  });
});
