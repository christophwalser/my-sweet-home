import { describe, expect, it } from "vitest";
import type { Home } from "../model";
import {
  formatDuration,
  formatExtension,
  isJpegPath,
  loadPhotoSettings,
  pathForFormat,
  presetOf,
  remainingSeconds,
} from "./photoPresets";
import { dayOfYear, fromDayOfYear, fromMinutes, sectionRange, toMinutes } from "./sunStudy";

describe("time of day", () => {
  it("converts between HH:MM and minutes", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("13:45")).toBe(825);
    expect(fromMinutes(825)).toBe("13:45");
    expect(fromMinutes(5)).toBe("00:05");
  });
  it("wraps around midnight", () => {
    expect(fromMinutes(1440)).toBe("00:00");
    expect(fromMinutes(1445)).toBe("00:05");
    expect(fromMinutes(-10)).toBe("23:50");
  });
});

describe("day of the year", () => {
  it("counts from January 1st", () => {
    expect(dayOfYear("2026-01-01")).toBe(1);
    expect(dayOfYear("2026-06-21")).toBe(172);
    expect(dayOfYear("2026-12-31")).toBe(365);
    expect(dayOfYear("")).toBe(1);
  });
  it("gives the date back in the same year", () => {
    expect(fromDayOfYear("2026-03-05", 172)).toBe("2026-06-21");
    expect(fromDayOfYear("2026-03-05", 1)).toBe("2026-01-01");
    // Leap year: day 60 is February 29th
    expect(fromDayOfYear("2028-01-01", 60)).toBe("2028-02-29");
  });
});

describe("sectionRange", () => {
  const home = (levels: [string, number, number | null][], wallHeight: number | null) =>
    ({
      attrs: { wall_height: wallHeight },
      levels: levels.map(([id, elevation, height]) => ({ attrs: { id, elevation, height } })),
    }) as unknown as Home;

  it("reaches the wall height in a home without levels", () => {
    expect(sectionRange(home([], 260), null)).toEqual({ max: 260, start: 120 });
    expect(sectionRange(home([], null), null)).toEqual({ max: 250, start: 120 });
  });

  it("reaches the top of the highest level and starts above the selected floor", () => {
    const h = home(
      [
        ["l0", 0, 250],
        ["l1", 262, 240],
      ],
      250,
    );
    expect(sectionRange(h, "l1")).toEqual({ max: 505, start: 382 });
    expect(sectionRange(h, "l0")).toEqual({ max: 505, start: 120 });
  });
});

describe("photo settings", () => {
  it("names the preset of a size", () => {
    expect(presetOf(1920, 1080, false)).toBe("fullhd");
    expect(presetOf(3508, 2480, false)).toBe("a4landscape");
    expect(presetOf(1000, 700, false)).toBe("custom");
    expect(presetOf(1920, 1080, true)).toBe("view");
  });

  it("falls back to the defaults without stored or with broken settings", () => {
    const fallback = { width: 1600, height: 800, keepAspect: true, quality: "good", format: "png" };
    expect(loadPhotoSettings(2, null)).toEqual(fallback);
    expect(loadPhotoSettings(2, "{")).toEqual(fallback);
    expect(loadPhotoSettings(2, '{"width":5,"height":100}')).toEqual(fallback);
  });

  it("keeps a fixed size and fits the height to the view otherwise", () => {
    const fixed =
      '{"width":3840,"height":2160,"keepAspect":false,"quality":"best","format":"jpeg"}';
    expect(loadPhotoSettings(2, fixed)).toEqual({
      width: 3840,
      height: 2160,
      keepAspect: false,
      quality: "best",
      format: "jpeg",
    });
    const follows = '{"width":2000,"height":900,"keepAspect":true,"quality":"nope"}';
    expect(loadPhotoSettings(2, follows)).toEqual({
      width: 2000,
      height: 1000,
      keepAspect: true,
      quality: "good",
      format: "png",
    });
  });

  it("estimates the remaining time once enough is done", () => {
    expect(remainingSeconds(1000, 0.5)).toBeNull();
    expect(remainingSeconds(10_000, 0.01)).toBeNull();
    expect(remainingSeconds(10_000, 0.25)).toBe(30);
    expect(remainingSeconds(10_000, 1)).toBeNull();
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(185)).toBe("3:05 min");
  });

  it("gives a saved photo the extension of its format", () => {
    // The dialog of Windows keeps a typed ".png" when JPEG is the format
    expect(pathForFormat("C:\\p\\Home.png", "jpeg")).toBe("C:\\p\\Home.jpg");
    expect(pathForFormat("C:\\p\\Home", "jpeg")).toBe("C:\\p\\Home.jpg");
    expect(pathForFormat("C:\\p\\Home.JPEG", "jpeg")).toBe("C:\\p\\Home.JPEG");
    expect(pathForFormat("C:\\p\\Home.jpg", "png")).toBe("C:\\p\\Home.png");
    expect(pathForFormat("C:\\p\\Home.png", "png")).toBe("C:\\p\\Home.png");
    expect(formatExtension("jpeg")).toBe("jpg");
  });

  it("recognizes JPEG file names", () => {
    expect(isJpegPath("C:\\photos\\Home.JPG")).toBe(true);
    expect(isJpegPath("home.jpeg")).toBe(true);
    expect(isJpegPath("home.png")).toBe(false);
  });
});
