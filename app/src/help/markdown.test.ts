import { describe, expect, it } from "vitest";
import { parseInline, parseTopics, searchTopics, slug } from "./markdown";

describe("help markdown", () => {
  it("splits topics and reads headings, paragraphs and lists", () => {
    const topics = parseTopics(
      [
        "# Getting started",
        "",
        "First line",
        "continues here.",
        "",
        "## Walls",
        "- one",
        "- two **bold**",
        "  more of two",
        "1. first",
        "",
        "# Walls & rooms",
        "Text with `code` and [a link](#getting-started).",
      ].join("\n"),
    );
    expect(topics.map((t) => t.id)).toEqual(["getting-started", "walls-rooms"]);
    const [a, b] = topics;
    expect(a.blocks[0]).toEqual({
      kind: "paragraph",
      content: [{ kind: "text", text: "First line continues here." }],
    });
    expect(a.blocks[1]).toEqual({ kind: "heading", level: 2, text: "Walls" });
    expect(a.blocks[2]).toMatchObject({ kind: "list", ordered: false });
    const list = a.blocks[2] as { items: unknown[][] };
    expect(list.items[1]).toEqual([
      { kind: "text", text: "two " },
      { kind: "bold", text: "bold" },
      { kind: "text", text: " more of two" },
    ]);
    expect(a.blocks[3]).toMatchObject({ kind: "list", ordered: true });
    expect(b.blocks[0]).toMatchObject({ kind: "paragraph" });
  });

  it("reads inline formatting and makes ids", () => {
    expect(parseInline("a `b` [c](#d)")).toEqual([
      { kind: "text", text: "a " },
      { kind: "code", text: "b" },
      { kind: "text", text: " " },
      { kind: "link", text: "c", href: "#d" },
    ]);
    expect(slug("Möbel & Räume")).toBe("mobel-raume");
  });

  it("finds topics by all words", () => {
    const topics = parseTopics("# Plan\nDraw walls\n# Photo\nRender a photo of walls");
    expect(searchTopics(topics, "walls").length).toBe(2);
    expect(searchTopics(topics, "render walls").map((t) => t.id)).toEqual(["photo"]);
    expect(searchTopics(topics, "").length).toBe(2);
  });
});
