// Context menu (right click in the plan, catalog items, library editor). An entry with
// `items` opens its sub-entries below it, indented (e.g. "Move to" with the categories).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatShortcut } from "../i18n";

export type MenuItem =
  | {
      label: string;
      shortcut?: string;
      disabled?: boolean;
      /** Shown in the warning color (e.g. delete) */
      danger?: boolean;
      /** Muted note on the right instead of a shortcut (e.g. "current") */
      note?: string;
      action: () => void;
    }
  | { label: string; disabled?: boolean; items: MenuItem[] }
  | { separator: true }
  | { heading: string };

function Entries({
  items,
  onClose,
  depth,
}: {
  items: MenuItem[];
  onClose: () => void;
  depth: number;
}) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      {items.map((item, i) => {
        if ("separator" in item) {
          // biome-ignore lint/suspicious/noArrayIndexKey: static list per opening
          return <hr key={i} />;
        }
        if ("heading" in item) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list per opening
            <div key={i} className="context-menu-heading">
              {item.heading}
            </div>
          );
        }
        if ("items" in item) {
          const expanded = open === i;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list per opening
            <div key={i} className="context-menu-group">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={expanded}
                disabled={item.disabled}
                className={expanded ? "open" : undefined}
                onClick={() => setOpen(expanded ? null : i)}
              >
                <span>{item.label}</span>
                <span className="context-menu-shortcut">{expanded ? "▾" : "▸"}</span>
              </button>
              {expanded && (
                <div className="context-menu-sub" role="menu">
                  <Entries items={item.items} onClose={onClose} depth={depth + 1} />
                </div>
              )}
            </div>
          );
        }
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: static list per opening
            key={i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={item.danger ? "danger" : undefined}
            onClick={() => {
              onClose();
              item.action();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut ? (
              <span className="context-menu-shortcut">{formatShortcut(item.shortcut)}</span>
            ) : (
              item.note && <span className="context-menu-shortcut">{item.note}</span>
            )}
          </button>
        );
      })}
    </>
  );
}

/** The entries that can take the focus, in the order shown. */
function enabledItems(menu: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(
    menu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [],
  );
}

export default function ContextMenu({
  x,
  y,
  items,
  onClose,
  fixed = false,
}: {
  /** Position in CSS pixels inside the positioned parent (or the window when `fixed`) */
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  /** Positioned in the window, e.g. for menus of scrolling lists */
  fixed?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu inside its parent (or the window): open to the left or upwards near the edges
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || (!parent && !fixed)) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const width = fixed ? window.innerWidth : (parent?.clientWidth ?? 0);
    const height = fixed ? window.innerHeight : (parent?.clientHeight ?? 0);
    setPos({
      left: x + w > width ? Math.max(0, x - w) : x,
      top: y + h > height ? Math.max(0, height - h) : y,
    });
  }, [x, y, fixed]);

  // The menu takes the keyboard while it is open and gives the focus back afterwards
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    enabledItems(ref.current)[0]?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // No key reaches the plan or the commands behind the menu
      e.stopPropagation();
      const items = enabledItems(ref.current);
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const focus = (i: number) => items[(i + items.length) % items.length]?.focus();
      const current = at >= 0 ? items[at] : null;
      switch (e.key) {
        case "Escape":
        case "Tab":
          onClose();
          break;
        case "ArrowDown":
          focus(at + 1);
          break;
        case "ArrowUp":
          focus(at < 0 ? -1 : at - 1);
          break;
        case "Home":
          focus(0);
          break;
        case "End":
          focus(-1);
          break;
        case "ArrowRight":
          // Opens the sub-entries and goes to the first one
          if (current?.getAttribute("aria-haspopup") && current.ariaExpanded !== "true") {
            current.click();
            requestAnimationFrame(() => {
              const next = enabledItems(ref.current);
              next[next.indexOf(current) + 1]?.focus();
            });
          }
          break;
        case "ArrowLeft": {
          // Back to the entry of the open sub-entries, closing them
          const parent = current
            ?.closest(".context-menu-sub")
            ?.parentElement?.querySelector<HTMLButtonElement>(":scope > button");
          if (parent) {
            parent.click();
            parent.focus();
          }
          break;
        }
        default:
          // Enter and Space press the focused entry themselves
          return;
      }
      e.preventDefault();
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top, position: fixed ? "fixed" : undefined }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Entries items={items} onClose={onClose} depth={0} />
    </div>
  );
}
