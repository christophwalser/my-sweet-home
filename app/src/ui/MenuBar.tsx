// Menu bar: the categories of the commands. A click opens a menu; while one is open,
// pointing at another category opens that one, like a native menu bar.

import { useEffect, useRef, useState } from "react";
import { MENUS } from "./commands";
import Icon from "./Icon";
import MenuList from "./MenuList";
import { useUi } from "./uiStore";

export default function MenuBar() {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLElement>(null);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);

  // Close on a click elsewhere, Escape or when the window loses the focus
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      else if (e.key === "ArrowRight") setOpen((o) => (o === null ? o : (o + 1) % MENUS.length));
      else if (e.key === "ArrowLeft")
        setOpen((o) => (o === null ? o : (o + MENUS.length - 1) % MENUS.length));
    };
    const onBlur = () => setOpen(null);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  return (
    <nav className="menu-bar" aria-label="Menu" ref={ref}>
      {MENUS.map((menu, i) => (
        <div key={menu.label} className="menu-anchor">
          <button
            type="button"
            className={`menu-category ${open === i ? "on" : ""}`}
            aria-haspopup="menu"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? null : i)}
            onPointerEnter={() => {
              if (open !== null) setOpen(i);
            }}
          >
            {menu.label}
          </button>
          {open === i && (
            <MenuList entries={menu.entries()} label={menu.label} onDone={() => setOpen(null)} />
          )}
        </div>
      ))}
      <span className="spacer" />
      <button
        type="button"
        className="menu-search"
        onClick={() => setPaletteOpen(true)}
        title="Search all commands (Ctrl+K)"
      >
        <Icon name="search" size={16} />
        <span>Search commands</span>
        <kbd>Ctrl+K</kbd>
      </button>
    </nav>
  );
}
