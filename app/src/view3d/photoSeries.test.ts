import { describe, expect, it } from "vitest";
import { seriesFilePath } from "./photoSeries";

describe("seriesFilePath", () => {
  it("names each photo after the home and the point of view, safe and unique", () => {
    const used = new Set<string>();
    expect(seriesFilePath("C:\\Photos", "Haus", "Kitchen", used)).toBe(
      "C:\\Photos\\Haus - Kitchen.png",
    );
    expect(seriesFilePath("C:\\Photos\\", "Haus", "Living: east/west?", used)).toBe(
      "C:\\Photos\\Haus - Living_ east_west_.png",
    );
    expect(seriesFilePath("C:\\Photos", "Haus", "kitchen", used)).toBe(
      "C:\\Photos\\Haus - kitchen (2).png",
    );
    expect(seriesFilePath("D:", "", "...", used)).toBe("D:\\photo - photo.png");
    expect(seriesFilePath("D:", "Haus", "Kitchen", new Set(), "jpg")).toBe(
      "D:\\Haus - Kitchen.jpg",
    );
  });
});
