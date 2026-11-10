import { describe, expect, it } from "vitest";
import guideDe from "./guide.de.md?raw";
import guideEn from "./guide.en.md?raw";
import { parseTopics, type Topic } from "./markdown";

describe("user guide", () => {
  it("has the same topics and sections in every language", () => {
    const en = parseTopics(guideEn);
    const de = parseTopics(guideDe);
    expect(en.length).toBeGreaterThan(8);
    expect(de.length).toBe(en.length);
    const headings = (t: Topic) => t.blocks.filter((b) => b.kind === "heading").length;
    en.forEach((topic, i) => {
      expect(headings(de[i]), topic.title).toBe(headings(topic));
    });
    expect(new Set(en.map((t) => t.id)).size).toBe(en.length);
  });
});
