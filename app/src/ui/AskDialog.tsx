// Shows the open question of ui/ask.ts above everything else. It takes the whole keyboard:
// Escape cancels only the question, Tab stays in it, and no key reaches the dialog behind it.

import { useEffect, useRef, useState } from "react";
import { useAsk } from "./ask";

export default function AskDialog() {
  const open = useAsk((s) => s.open);
  // A new question starts with its own text
  return open ? <Ask key={`${open.title}|${open.message ?? ""}`} /> : null;
}

function Ask() {
  const open = useAsk((s) => s.open);
  const [text, setText] = useState(open?.input?.value ?? "");
  const form = useRef<HTMLFormElement>(null);
  const answer = open?.answer;

  // The focus goes to the text or the button that goes on, and back afterwards
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const field = form.current?.querySelector<HTMLInputElement>("input");
    if (field) {
      field.focus();
      field.select();
    } else form.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        answer?.(null);
      } else if (e.key === "Tab") {
        e.preventDefault();
        const stops = [
          ...(form.current?.querySelectorAll<HTMLElement>(
            "input, .dialog-actions button:not(:disabled)",
          ) ?? []),
        ];
        const at = stops.indexOf(document.activeElement as HTMLElement);
        const next = at < 0 ? 0 : at + (e.shiftKey ? -1 : 1);
        stops[(next + stops.length) % stops.length]?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [answer]);

  if (!open) return null;
  const missing = !!open.input && text.trim() === "";
  const [first, ...others] = open.buttons;
  return (
    <div className="dialog-backdrop ask">
      <form
        ref={form}
        className="dialog ask-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={open.title}
        aria-describedby={open.message ? "ask-message" : undefined}
        onSubmit={(e) => {
          e.preventDefault();
          if (!missing) open.answer({ id: first.id, text });
        }}
      >
        <header className="dialog-header">
          <h2>{open.title}</h2>
        </header>
        {open.message && <p id="ask-message">{open.message}</p>}
        {open.input && (
          <label className="prop-row">
            <span className="prop-label">{open.input.label}</span>
            <input
              type="text"
              value={text}
              spellCheck={false}
              onChange={(e) => setText(e.currentTarget.value)}
            />
          </label>
        )}
        <div className="dialog-actions">
          <button
            type="submit"
            className={first.danger ? "primary danger" : "primary"}
            disabled={missing}
          >
            {first.label}
          </button>
          {others.map((b) => (
            <button
              key={b.id}
              type="button"
              className={b.danger ? "danger" : undefined}
              onClick={() => open.answer({ id: b.id, text })}
            >
              {b.label}
            </button>
          ))}
          {open.cancel !== null && (
            <button type="button" onClick={() => open.answer(null)}>
              {open.cancel}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
