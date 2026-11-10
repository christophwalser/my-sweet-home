// A small Markdown reader for the help pages: topics (`# `), headings (`##`, `###`),
// paragraphs, bullet and numbered lists, **bold**, `code` and links. It builds a tree of
// plain objects; the help dialog turns it into elements (no HTML strings, so nothing in the
// text can inject markup).

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

export type Topic = { id: string; title: string; blocks: Block[]; text: string };

/** Id of a topic from its title: lower case words joined by "-". */
export function slug(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Inline formatting of one line or paragraph. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    else out.push({ kind: "link", text: m[3], href: m[4] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** The topics of a help file: each `# ` heading starts one. */
export function parseTopics(source: string): Topic[] {
  const topics: Topic[] = [];
  let topic: Topic | null = null;
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!topic) return;
    if (paragraph.length) {
      topic.blocks.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
    if (list) {
      topic.blocks.push({
        kind: "list",
        ordered: list.ordered,
        items: list.items.map(parseInline),
      });
      list = null;
    }
  };
  for (const raw of source.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{1,3}) +(.*)$/.exec(line);
    const bullet = /^[-*] +(.*)$/.exec(line);
    const numbered = /^\d+\. +(.*)$/.exec(line);
    if (h) {
      flush();
      if (h[1].length === 1) {
        topic = { id: slug(h[2]), title: h[2], blocks: [], text: "" };
        topics.push(topic);
      } else if (topic) {
        topic.blocks.push({ kind: "heading", level: h[1].length as 2 | 3, text: h[2] });
      }
    } else if (bullet || numbered) {
      if (paragraph.length) flush();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flush();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)?.[1] ?? "");
    } else if (line === "") {
      flush();
    } else if (list && /^ {2,}\S/.test(raw)) {
      // Continuation of the last list item
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      if (list) flush();
      paragraph.push(line.trim());
    }
    if (topic) topic.text += `${line}\n`;
  }
  flush();
  return topics;
}

/** Topics whose title or text contain all words of `query` (case-insensitive). */
export function searchTopics(topics: Topic[], query: string): Topic[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return topics;
  return topics.filter((t) => {
    const text = `${t.title}\n${t.text}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
