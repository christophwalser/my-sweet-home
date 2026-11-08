// Context menu of the plan (right click in the select mode).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatShortcut } from "../i18n";

export type MenuItem =
  | { label: string; shortcut?: string; disabled?: boolean; action: () => void }
  | { separator: true }
  | { heading: string };

export default function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  /** Position in CSS pixels inside the positioned parent */
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu inside its parent: open to the left or upwards near the edges
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      left: x + w > parent.clientWidth ? Math.max(0, x - w) : x,
      top: y + h > parent.clientHeight ? Math.max(0, parent.clientHeight - h) : y,
    });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
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
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
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
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: static list per opening
            key={i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.action();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="context-menu-shortcut">{formatShortcut(item.shortcut)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
