// Which keys of the window a focused element takes for itself.

/**
 * - `text`: typing happens here (text field, text area, editable text); all plain keys and the
 *   editing shortcuts (Ctrl+Z, Ctrl+C, ...) belong to the element.
 * - `control`: a check box, drop-down, slider or the like; it takes plain keys (Space, arrows,
 *   letters for type-ahead) but no Ctrl shortcuts, so Ctrl+Z or Ctrl+S still reach the app.
 * - `other`: anything else; all keys are for the app.
 */
export type KeyTarget = "text" | "control" | "other";

/** Input types that take no text. */
const CONTROL_INPUTS = new Set([
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "button",
  "submit",
  "reset",
  "image",
]);

export function keyTarget(
  el: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined,
): KeyTarget {
  if (!el) return "other";
  if (el.isContentEditable) return "text";
  switch (el.tagName) {
    case "TEXTAREA":
      return "text";
    case "SELECT":
      return "control";
    case "INPUT":
      return CONTROL_INPUTS.has((el.type ?? "text").toLowerCase()) ? "control" : "text";
    default:
      return "other";
  }
}

/** A modal dialog is open: keys must not reach the plan or the commands behind it. */
export function modalOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector(".dialog-backdrop") !== null;
}
