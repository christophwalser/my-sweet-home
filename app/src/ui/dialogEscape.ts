// What Escape does in the dialogs of the catalog, one step per press: in a text field it takes
// back what was typed and leaves the field, with several items selected it goes back to one,
// and only then it closes the dialog - after a question if the dialog was filled in.

import { type RefObject, useEffect, useRef } from "react";
import { t } from "../i18n";
import { askConfirm } from "./ask";
import { keyTarget } from "./keyTarget";

type TextField = HTMLInputElement | HTMLTextAreaElement;

/**
 * - `clear`: empty the search field, the focus stays there
 * - `restore`: the text the field had before, and leave the field
 * - `leave`: leave the field
 * - `ask`: ask before closing
 */
export type EscapeStep = "clear" | "restore" | "leave" | "ask" | "close";

/** The step for the focused text field (null: no text field has the focus). */
export function escapeStep(
  field: { search: boolean; value: string; before: string } | null,
  dirty: boolean,
): EscapeStep {
  if (field) {
    if (field.search) return field.value === "" ? "leave" : "clear";
    return field.value === field.before ? "leave" : "restore";
  }
  return dirty ? "ask" : "close";
}

/** Changes the text of a field so that React sees it like typing. */
function setText(el: TextField, text: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set?.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** State of a form element, to see whether it was changed. */
function stateOf(el: Element): string {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio"))
    return String(el.checked);
  return (el as TextField).value ?? "";
}

/**
 * Escape for the dialog `ref`. With `guard` a filled in dialog asks before it closes: one of its
 * fields was changed by the user, or `changed` says so (for what has no field). `first` may take
 * the key before the dialog closes; `busy` keeps the dialog open.
 */
export function useDialogEscape(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: {
    guard?: boolean;
    changed?: () => boolean;
    first?: () => boolean;
    busy?: boolean;
  } = {},
): void {
  const latest = useRef({ onClose, options });
  latest.current = { onClose, options };

  // The dialog takes the keyboard from what is behind it and gives it back afterwards
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    if (!ref.current?.contains(before)) ref.current?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, [ref]);

  useEffect(() => {
    /** The fields that had the focus, with their state when they first got it */
    const first = new Map<Element, string>();
    /** Text of the focused field when it got the focus */
    let before = "";
    const onFocus = (e: FocusEvent) => {
      const el = e.target as Element;
      if (!ref.current?.contains(el) || !el.matches("input, textarea, select")) return;
      before = stateOf(el);
      if (!first.has(el) && (el as HTMLInputElement).type !== "search") first.set(el, before);
    };
    const dirty = () =>
      !!latest.current.options.guard &&
      (!!latest.current.options.changed?.() ||
        [...first].some(([el, state]) => el.isConnected && stateOf(el) !== state));

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      const { onClose, options } = latest.current;
      const el = document.activeElement as TextField | null;
      const inField = !!el && !!ref.current?.contains(el) && keyTarget(el) === "text";
      const step = escapeStep(
        inField ? { search: el.type === "search", value: el.value, before } : null,
        dirty(),
      );
      e.preventDefault();
      switch (step) {
        case "clear":
          if (el) setText(el, "");
          break;
        case "restore":
          if (el) setText(el, before);
          ref.current?.focus();
          break;
        case "leave":
          ref.current?.focus();
          break;
        default:
          if (options.busy || options.first?.()) return;
          if (step === "close") onClose();
          else
            void askConfirm({
              title: t("Discard your input?"),
              message: t("What you entered in this window is lost."),
              confirm: t("Discard"),
              danger: true,
            }).then((yes) => yes && latest.current.onClose());
      }
    };
    window.addEventListener("focusin", onFocus);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("focusin", onFocus);
      window.removeEventListener("keydown", onKey);
    };
  }, [ref]);
}
