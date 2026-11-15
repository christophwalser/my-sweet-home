// Text typed directly in the plan, at the position of the text: for new texts and for changing
// a text with a double-click. Enter finishes (Shift+Enter starts a new line), Esc cancels,
// clicking elsewhere finishes too.

import { useEffect, useRef } from "react";
import { t } from "../i18n";

export type TextEdit = {
  /** Position of the text in the plan (cm): bottom center of the text, like a label */
  at: [number, number];
  /** Label changed, or null for a new text */
  id: string | null;
  text: string;
  /** Font size in cm */
  size: number;
};

export default function TextEditor({
  left,
  top,
  fontPx,
  initial,
  onCommit,
  onCancel,
}: {
  /** Bottom center of the text in CSS pixels in the plan area */
  left: number;
  top: number;
  fontPx: number;
  initial: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Finished once: Enter, then the blur caused by unmounting must not commit again
  const done = useRef(false);
  useEffect(() => {
    // After the click that opened the editor has moved the focus
    const timer = window.setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(ref.current?.value ?? "");
    else onCancel();
  };
  const lines = Math.max(1, (ref.current?.value ?? initial).split("\n").length);
  return (
    <textarea
      ref={ref}
      className="plan-text-editor"
      aria-label={t("Label text")}
      defaultValue={initial}
      rows={lines}
      spellCheck={false}
      style={{
        left,
        top,
        fontSize: Math.max(10, Math.min(72, fontPx)),
      }}
      onInput={(e) => {
        e.currentTarget.rows = Math.max(1, e.currentTarget.value.split("\n").length);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        }
      }}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
