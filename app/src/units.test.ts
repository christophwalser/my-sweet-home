import { describe, expect, it } from "vitest";
import {
  formatArea,
  formatFieldValue,
  formatLength,
  formatPrecise,
  fromUnit,
  parseLength,
  rulerLabel,
  rulerSteps,
  toUnit,
  unitSymbol,
} from "./units";

describe("toUnit / fromUnit", () => {
  it("rounds to the decimals of the input fields of each unit", () => {
    expect(toUnit(123.456, "cm")).toBe(123.5);
    expect(toUnit(123.456, "mm")).toBe(1235);
    expect(toUnit(123.456, "m")).toBe(1.235);
    expect(toUnit(123.456, "inch")).toBe(48.6);
  });

  it("converts back to centimeters", () => {
    expect(fromUnit(2, "m")).toBe(200);
    expect(fromUnit(15, "mm")).toBe(1.5);
    expect(fromUnit(1, "inch")).toBe(2.54);
    expect(fromUnit(7, "cm")).toBe(7);
  });

  it("uses the unit of the preferences (cm) by default", () => {
    expect(toUnit(10.04)).toBe(10);
    expect(fromUnit(3)).toBe(3);
    expect(unitSymbol()).toBe("cm");
  });
});

describe("parseLength", () => {
  it("parses plain numbers in the given unit", () => {
    expect(parseLength("42", "cm")).toBe(42);
    expect(parseLength("42", "m")).toBe(4200);
    expect(parseLength(".5", "cm")).toBe(0.5);
    expect(parseLength("-3", "cm")).toBe(-3);
  });

  it("accepts a decimal comma and surrounding spaces", () => {
    expect(parseLength("  1,5 m ", "cm")).toBe(150);
  });

  it("accepts an explicit unit that overrides the field unit", () => {
    expect(parseLength("12 mm", "m")).toBeCloseTo(1.2);
    expect(parseLength("1.5m", "cm")).toBe(150);
    expect(parseLength("8 in", "cm")).toBeCloseTo(20.32);
    expect(parseLength('8"', "cm")).toBeCloseTo(20.32);
    expect(parseLength("8 inch", "cm")).toBeCloseTo(20.32);
    expect(parseLength("-.5 m", "cm")).toBe(-50);
  });

  it("parses feet and inches", () => {
    expect(parseLength("5'3\"", "cm")).toBeCloseTo(63 * 2.54);
    expect(parseLength("5' 3", "cm")).toBeCloseTo(63 * 2.54);
    expect(parseLength("5ft 3in", "cm")).toBeCloseTo(63 * 2.54);
    expect(parseLength("5 ft", "cm")).toBeCloseTo(60 * 2.54);
  });

  it("subtracts the inches of negative feet", () => {
    expect(parseLength("-5'3\"", "cm")).toBeCloseTo(-63 * 2.54);
  });

  it("returns null for text that is no length", () => {
    expect(parseLength("", "cm")).toBeNull();
    expect(parseLength("   ", "cm")).toBeNull();
    expect(parseLength("abc", "cm")).toBeNull();
    expect(parseLength("12 km", "cm")).toBeNull();
    expect(parseLength("1e3", "cm")).toBeNull();
    expect(parseLength("1.2.3", "cm")).toBeNull();
  });
});

describe("formatLength", () => {
  it("formats in each unit", () => {
    expect(formatLength(420, "m")).toBe("4.20 m");
    expect(formatLength(42.5, "cm")).toBe("42.5 cm");
    expect(formatLength(42.55, "mm")).toBe("426 mm");
  });

  it("stays in centimeters above one meter", () => {
    expect(formatLength(316, "cm")).toBe("316 cm");
  });

  it("formats feet and inches with 1/8 inch precision", () => {
    expect(formatLength(165 * 2.54, "inch")).toBe("13'9\"");
    expect(formatLength(2.54, "inch")).toBe('1"');
    expect(formatLength(1.27, "inch")).toBe('0.5"');
    expect(formatLength(-30.48, "inch")).toBe("-1'0\"");
  });

  it("carries inches that round up to 12 into the feet", () => {
    // 11.996 in rounds to 12 in: 1'0" rather than 0'12"
    expect(formatLength(30.47, "inch")).toBe("1'0\"");
  });

  it("uses the unit of the preferences by default", () => {
    expect(formatLength(100)).toBe("100 cm");
  });
});

describe("formatPrecise / formatFieldValue", () => {
  it("shows the precision of the input fields", () => {
    expect(formatPrecise(316.3, "cm")).toBe("316.3 cm");
    expect(formatPrecise(316.3, "m")).toBe("3.163 m");
    expect(formatPrecise(316.3, "mm")).toBe("3163 mm");
    expect(formatPrecise(2.54 * 124.5, "inch")).toBe("10'4.5\"");
  });

  it("formats field values without grouping", () => {
    expect(formatFieldValue(12345.67, "cm")).toBe("12345.7");
    expect(formatFieldValue(1.23456, "m")).toBe("1.235");
    expect(formatFieldValue(10, "mm")).toBe("10");
  });
});

describe("formatArea", () => {
  it("shows square meters with two decimals", () => {
    expect(formatArea(100000, "cm")).toBe("10.00 m²");
    expect(formatArea(0, "m")).toBe("0.00 m²");
  });

  it("shows the absolute value of negative (clockwise) areas", () => {
    expect(formatArea(-25000, "cm")).toBe("2.50 m²");
  });

  it("shows square feet with the inch unit", () => {
    expect(formatArea(30.48 * 30.48, "inch")).toBe("1.0 ft²");
  });
});

describe("rulers", () => {
  it("has ascending steps for metric units", () => {
    const steps = rulerSteps("cm");
    expect(steps[0]).toBe(0.1);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it("has steps in whole inches for the inch unit", () => {
    const steps = rulerSteps("inch");
    expect(steps[0]).toBeCloseTo(2.54);
    expect(steps[3]).toBeCloseTo(30.48);
  });

  it("labels marks in the unit, feet marks with '", () => {
    expect(rulerLabel(150, "m")).toBe("1.5");
    expect(rulerLabel(0.1, "cm")).toBe("0.1");
    expect(rulerLabel(5, "mm")).toBe("50");
    expect(rulerLabel(30.48, "inch")).toBe("1'");
    expect(rulerLabel(5 * 2.54, "inch")).toBe('5"');
  });

  it("uses 'in' as symbol of the inch unit", () => {
    expect(unitSymbol("inch")).toBe("in");
    expect(unitSymbol("mm")).toBe("mm");
  });
});
