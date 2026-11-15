import { describe, expect, it } from "vitest";
import { evalLength, evalNumber } from "./expression";

const close = (a: number | null, b: number) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThan(1e-6);
};

describe("evalLength", () => {
  it("reads plain lengths with and without units", () => {
    close(evalLength("240", "cm"), 240);
    close(evalLength("12,5", "cm"), 12.5);
    close(evalLength("-50", "cm"), -50);
    close(evalLength("35 mm", "cm"), 3.5);
    close(evalLength("2", "m"), 200);
    close(evalLength("5'3\"", "cm"), 160.02);
  });

  it("calculates with the unit of the field and plain factors", () => {
    close(evalLength("240+11.5", "cm"), 251.5);
    close(evalLength("3m - 12cm", "cm"), 288);
    close(evalLength("(120-2*1.5)/2", "cm"), 58.5);
    close(evalLength("2 * 60", "mm"), 12);
    close(evalLength("1.2 + 35mm", "m"), 123.5);
    close(evalLength('5\' 3" + 1"', "cm"), 162.56);
  });

  it("changes the current value relatively", () => {
    close(evalLength("+5", "cm", 100), 105);
    close(evalLength("+-2.5", "cm", 100), 97.5);
    close(evalLength("*2", "cm", 80), 160);
    close(evalLength("/4", "cm", 80), 20);
    close(evalLength("+10mm", "cm", 100), 101);
    // A leading minus stays absolute
    close(evalLength("-5", "cm", 100), -5);
    // Without a current value "+5" is just 5
    close(evalLength("+5", "cm"), 5);
  });

  it("rejects text that is no length", () => {
    for (const text of ["", "abc", "3 kg", "2*", "(3", "4/0", "2 * 3cm", "*2"]) {
      expect(evalLength(text, "cm"), text).toBeNull();
    }
  });
});

describe("evalNumber", () => {
  it("calculates angles and other numbers", () => {
    close(evalNumber("90"), 90);
    close(evalNumber("45°"), 45);
    close(evalNumber("360/8"), 45);
    close(evalNumber("+15", 30), 45);
    close(evalNumber("*2", 30), 60);
    expect(evalNumber("90cm")).toBeNull();
  });
});
