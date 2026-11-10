// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type I18n = typeof import("./index");

/** Loads the module afresh: the language is resolved when it loads. */
async function load(choice: string | null, system = "en-US"): Promise<I18n> {
  localStorage.clear();
  if (choice !== null) localStorage.setItem("msh.language", choice);
  Object.defineProperty(navigator, "language", { value: system, configurable: true });
  vi.resetModules();
  return import("./index");
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  Object.defineProperty(navigator, "language", { value: "en-US", configurable: true });
});

describe("language choice", () => {
  it("is 'system' without a stored choice", async () => {
    const i18n = await load(null);
    expect(i18n.languageChoice()).toBe("system");
  });

  it("ignores unknown stored languages", async () => {
    const i18n = await load("fr");
    expect(i18n.languageChoice()).toBe("system");
    expect(i18n.language()).toBe("en");
  });

  it("follows a German system language", async () => {
    const i18n = await load(null, "de-CH");
    expect(i18n.language()).toBe("de");
  });

  it("prefers a stored choice over the system language", async () => {
    const i18n = await load("en", "de-DE");
    expect(i18n.languageChoice()).toBe("en");
    expect(i18n.language()).toBe("en");
  });
});

describe("t", () => {
  it("returns the English key in English", async () => {
    const { t } = await load("en");
    expect(t("Straight")).toBe("Straight");
  });

  it("translates known texts in German", async () => {
    const { t } = await load("de");
    expect(t("Straight")).toBe("Gerade");
  });

  it("falls back to the English text for missing translations", async () => {
    const { t } = await load("de");
    expect(t("A text nobody translated")).toBe("A text nobody translated");
  });

  it("fills placeholders after translating", async () => {
    const { t } = await load("de");
    expect(t("Arc {deg}°", { deg: 45 })).toBe("Bogen 45°");
  });

  it("fills placeholders in English, also zero and repeated ones", async () => {
    const { t } = await load("en");
    expect(t("Saved {pages} pages", { pages: 3 })).toBe("Saved 3 pages");
    expect(t("{n} of {n}", { n: 0 })).toBe("0 of 0");
  });

  it("keeps placeholders without a value", async () => {
    const { t } = await load("en");
    expect(t("Hello {name}, {missing}", { name: "Ann" })).toBe("Hello Ann, {missing}");
    expect(t("Hello {name}")).toBe("Hello {name}");
  });

  it("does not interpret replacement patterns in values", async () => {
    const { t } = await load("en");
    expect(t("File {name}", { name: "$&-$1" })).toBe("File $&-$1");
  });
});

describe("locale and number formats", () => {
  it("keeps the system region when it speaks the language", async () => {
    const i18n = await load(null, "de-CH");
    expect(i18n.locale()).toBe("de-CH");
  });

  it("uses a default region for another language", async () => {
    const english = await load("en", "de-DE");
    expect(english.locale()).toBe("en-US");
    const german = await load("de", "en-GB");
    expect(german.locale()).toBe("de-DE");
  });

  it("formats numbers with a decimal comma in German, without grouping", async () => {
    const { formatNumber } = await load("de", "de-DE");
    expect(formatNumber(1234.5)).toBe("1234,5");
  });

  it("formats numbers in English with the given decimals", async () => {
    const { formatNumber } = await load("en");
    expect(formatNumber(1234567.891)).toBe("1234567.89");
    expect(formatNumber(1.23456, 3)).toBe("1.235");
    expect(formatNumber(2, 2, 2)).toBe("2.00");
    expect(formatNumber(2.5, 0)).toBe("3");
  });

  it("formats like toLocaleString with the same options (cached formats)", async () => {
    const { formatNumber } = await load("de", "de-CH");
    for (const value of [0, -0, 1.005, -12.345, 99999.999, 1e-7, 123456789.5]) {
      for (const [max, min] of [
        [2, 0],
        [1, 1],
        [0, 0],
        [3, 2],
      ]) {
        const expected = value.toLocaleString("de-CH", {
          maximumFractionDigits: max,
          minimumFractionDigits: min,
          useGrouping: false,
        });
        expect(formatNumber(value, max, min)).toBe(expected);
        expect(formatNumber(value, max, min)).toBe(expected);
      }
    }
  });
});

describe("formatShortcut", () => {
  it("keeps the English key names", async () => {
    const { formatShortcut } = await load("en");
    expect(formatShortcut("Ctrl+Shift+S")).toBe("Ctrl+Shift+S");
  });

  it("names the keys in German", async () => {
    const { formatShortcut } = await load("de");
    expect(formatShortcut("Ctrl+Shift+S")).toBe("Strg+Umschalt+S");
    expect(formatShortcut("Del")).toBe("Entf");
    expect(formatShortcut("Space")).toBe("Leertaste");
  });

  it("keeps the plus key at the end", async () => {
    const { formatShortcut } = await load("de");
    expect(formatShortcut("Ctrl++")).toBe("Strg++");
  });
});
