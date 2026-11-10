// User guide (F1): topics on the left with a search field, the chosen topic on the right.
// The guide is one Markdown file per language (`guide.<lang>.md`, English as fallback).

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { language, t } from "../i18n";
import { useUi } from "../ui/uiStore";
import guideDe from "./guide.de.md?raw";
import guideEn from "./guide.en.md?raw";
import { type Inline, parseTopics, searchTopics } from "./markdown";

const GUIDES: Record<string, string> = { en: guideEn, de: guideDe };
/** Topics about the keyboard shortcuts, which offer the shortcut overview. */
const SHORTCUT_TOPICS = ["keyboard-shortcuts", "tastenkurzel"];

function inline(content: Inline[], go: (id: string) => void): ReactNode[] {
  return content.map((c, i) => {
    const key = `${i}-${c.kind}`;
    switch (c.kind) {
      case "bold":
        return <strong key={key}>{c.text}</strong>;
      case "code":
        return <code key={key}>{c.text}</code>;
      case "link":
        return c.href.startsWith("#") ? (
          <button
            key={key}
            type="button"
            className="link-button"
            onClick={() => go(c.href.slice(1))}
          >
            {c.text}
          </button>
        ) : (
          <span key={key}>{c.text}</span>
        );
      default:
        return <span key={key}>{c.text}</span>;
    }
  });
}

export default function HelpDialog({ onClose }: { onClose: () => void }) {
  const topics = useMemo(() => parseTopics(GUIDES[language()] ?? GUIDES.en), []);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(topics[0]?.id ?? "");
  const found = searchTopics(topics, query);
  const topic = topics.find((x) => x.id === current) ?? topics[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop">
      <div className="dialog help-dialog" role="dialog" aria-label={t("User guide")}>
        <header className="dialog-header">
          <h2>{t("User guide")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Close")}>
            ×
          </button>
        </header>
        <div className="help-body">
          <nav className="help-topics" aria-label={t("Topics")}>
            <input
              type="search"
              value={query}
              placeholder={t("Search the guide")}
              aria-label={t("Search the guide")}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
            <ul>
              {found.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    className={x.id === topic?.id ? "active" : ""}
                    onClick={() => setCurrent(x.id)}
                  >
                    {x.title}
                  </button>
                </li>
              ))}
            </ul>
            {found.length === 0 && <p className="muted small">{t("Nothing found.")}</p>}
          </nav>
          <article className="help-topic">
            {topic && (
              <>
                <h3>{topic.title}</h3>
                {topic.blocks.map((b, i) => {
                  const key = `${topic.id}-${i}`;
                  if (b.kind === "heading") {
                    return b.level === 2 ? (
                      <h4 key={key}>{b.text}</h4>
                    ) : (
                      <h5 key={key}>{b.text}</h5>
                    );
                  }
                  if (b.kind === "paragraph")
                    return <p key={key}>{inline(b.content, setCurrent)}</p>;
                  const items = b.items.map((item, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the list is static text
                    <li key={j}>{inline(item, setCurrent)}</li>
                  ));
                  return b.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
                })}
                {SHORTCUT_TOPICS.includes(topic.id) && (
                  <button type="button" onClick={() => useUi.getState().openDialog("shortcuts")}>
                    {t("Keyboard shortcuts")}
                  </button>
                )}
              </>
            )}
          </article>
        </div>
      </div>
    </div>
  );
}
