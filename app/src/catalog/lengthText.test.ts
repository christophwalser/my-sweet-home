import { describe, expect, it } from "vitest";
import { lengthsText, lengthsValue, lengthText, lengthValue } from "./lengthText";

describe("lengths of library items", () => {
  it("shows centimeters of the file in the unit", () => {
    expect(lengthText("87.5", "cm")).toBe("87.5");
    expect(lengthText("87.5", "mm")).toBe("875");
    expect(lengthText("87.5", "m")).toBe("0.875");
    expect(lengthText("2.54", "inch")).toBe("1");
    expect(lengthText("", "mm")).toBe("");
    expect(lengthText("auto", "mm")).toBe("auto");
  });

  it("takes a typed length in the unit or with its own", () => {
    expect(lengthValue("875", "mm")).toBe("87.5");
    expect(lengthValue("87,5", "cm")).toBe("87.5");
    expect(lengthValue("1.2 m", "mm")).toBe("120");
    expect(lengthValue(" ", "mm")).toBe("");
    expect(lengthValue("wide", "cm")).toBeNull();
  });

  it("reads and writes lists of lengths", () => {
    expect(lengthsText("38 76.5 114", "mm")).toBe("380 765 1140");
    expect(lengthsValue("380 765 1140", "mm")).toBe("38 76.5 114");
    expect(lengthsValue("38, 76,5; 114", "cm")).toBe("38 76.5 114");
    expect(lengthsValue("", "cm")).toBe("");
    expect(lengthsValue("38 x", "cm")).toBeNull();
  });
});
