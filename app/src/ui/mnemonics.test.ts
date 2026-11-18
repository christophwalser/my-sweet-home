import { describe, expect, it } from "vitest";
import { mnemonics, nextByLetter, splitAtMnemonic } from "./mnemonics";

describe("mnemonics", () => {
  it("gives each label its first free letter", () => {
    expect(mnemonics(["File", "Edit", "View", "Plan", "Levels", "Furniture", "Help"])).toEqual([
      "f",
      "e",
      "v",
      "p",
      "l",
      "u",
      "h",
    ]);
  });

  it("skips digits and spaces and gives up when all letters are taken", () => {
    expect(mnemonics(["3D view", "D"])).toEqual(["d", null]);
  });
});

describe("splitAtMnemonic", () => {
  it("splits around the first occurrence of the key", () => {
    expect(splitAtMnemonic("Furniture", "u")).toEqual(["F", "u", "rniture"]);
    expect(splitAtMnemonic("File", null)).toEqual(["File", "", ""]);
  });
});

describe("nextByLetter", () => {
  const labels = ["Save", "Save as…", "Print", "Close"];

  it("goes round the entries with the letter", () => {
    expect(nextByLetter(labels, -1, "s")).toEqual({ index: 0, unique: false });
    expect(nextByLetter(labels, 0, "S")).toEqual({ index: 1, unique: false });
    expect(nextByLetter(labels, 1, "s")).toEqual({ index: 0, unique: false });
  });

  it("tells when an entry is the only one", () => {
    expect(nextByLetter(labels, -1, "p")).toEqual({ index: 2, unique: true });
    expect(nextByLetter(labels, -1, "x")).toEqual({ index: -1, unique: false });
  });
});
