// Menu bar: the categories of the commands. A click opens a menu; while one is open,
// pointing at another category opens that one, like a native menu bar. Keyboard as in
// Windows: Alt or F10 goes to the bar and shows the access keys, Alt+letter opens a menu, the
// arrow keys move between and inside the menus, Escape goes back.

import { useEffect, useMemo, useRef, useState } from "react";
import { formatShortcut, t } from "../i18n";
import { MENUS } from "./commands";
import Icon from "./Icon";
import { modalOpen } from "./keyTarget";
import MenuList, { menuItems } from "./MenuList";
import { mnemonics, splitAtMnemonic } from "./mnemonics";
import { useUi } from "./uiStore";

export default function MenuBar() {
  /** Open menu, and whether the keyboard opened it (its first entry takes the focus) */
  const [open, setOpen] = useState<{ index: number; byKey: boolean } | null>(null);
  /** The bar is used with the keyboard: the access keys are underlined */
  const [keys, setKeys] = useState(false);
  const ref = useRef<HTMLElement>(null);
  /** Element that had the focus before the bar took it */
  const before = useRef<HTMLElement | null>(null);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const accessKeys = useMemo(() => mnemonics(MENUS.map((m) => m.label)), []);

  const category = (i: number) =>
    ref.current?.querySelectorAll<HTMLButtonElement>(".menu-category")[i];
  /** Leaves the bar: the focus goes back to where it was. */
  const leave = () => {
    setOpen(null);
    setKeys(false);
    if (ref.current?.contains(document.activeElement)) {
      // The body cannot take the focus: the bar gives it up instead
      const back = before.current;
      if (back && back !== document.body && back.isConnected) back.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
    }
    before.current = null;
  };
  const enter = () => {
    if (!ref.current?.contains(document.activeElement)) {
      before.current = document.activeElement as HTMLElement | null;
    }
    setKeys(true);
  };

  // Alt alone or F10 goes to the menu bar, Alt+letter opens a menu
  // biome-ignore lint/correctness/useExhaustiveDependencies: the handlers read the current state through refs and setters
  useEffect(() => {
    /** Alt went down and nothing else happened since */
    let altAlone = false;
    let buttons = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      if (modalOpen()) return;
      if (e.key === "Alt") {
        // AltGr comes as Ctrl+Alt: it types, it is no menu key. Alt held while dragging is
        // the magnetism switch of the plan.
        altAlone = !e.repeat && !e.ctrlKey && buttons === 0;
        return;
      }
      altAlone = false;
      if (e.key === "F10" && !e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        enter();
        category(0)?.focus();
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey || e.key.length !== 1) return;
      const i = accessKeys.indexOf(e.key.toLowerCase());
      if (i < 0) return;
      e.preventDefault();
      enter();
      setOpen({ index: i, byKey: true });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Alt" || !altAlone) return;
      altAlone = false;
      e.preventDefault();
      if (ref.current?.contains(document.activeElement)) leave();
      else {
        enter();
        category(0)?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      buttons = e.buttons;
      altAlone = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("pointerup", onPointer, true);
    // Alt held while the pointer moves inverts the magnetism of the plan: no menu key either
    const onMove = () => {
      altAlone = false;
    };
    window.addEventListener("pointermove", onMove, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("pointerup", onPointer, true);
    };
  }, [accessKeys]);

  // Close on a click elsewhere, Escape or when the window loses the focus
  // biome-ignore lint/correctness/useExhaustiveDependencies: leave reads refs
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(null);
        setKeys(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const step = (by: number) =>
        setOpen((o) =>
          o === null ? o : { index: (o.index + by + MENUS.length) % MENUS.length, byKey: true },
        );
      if (e.key === "Escape") {
        // Back to the category of the menu, as in Windows; the next Escape leaves the bar
        const i = open.index;
        setOpen(null);
        if (keys) category(i)?.focus();
        else leave();
      } else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        // A menu opened with the mouse: the arrows go into it
        const items = menuItems(ref.current?.querySelector(".menu-anchor > .menu-popup") ?? null);
        items[e.key === "ArrowDown" ? 0 : items.length - 1]?.focus();
      } else {
        // An open menu takes the keyboard: no key reaches the plan or the shortcuts behind it
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    const onBlur = () => {
      setOpen(null);
      setKeys(false);
    };
    // On the document: after the open menu itself (which handles its own keys and stops them)
    // and before the listeners of the window (the plan, the shortcuts)
    window.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [open, keys]);

  return (
    <nav className="menu-bar" aria-label={t("Menu")} ref={ref}>
      {MENUS.map((menu, i) => {
        const [head, key, tail] = splitAtMnemonic(menu.label, keys ? accessKeys[i] : null);
        return (
          <div key={menu.label} className="menu-anchor">
            <button
              type="button"
              className={`menu-category ${open?.index === i ? "on" : ""}`}
              aria-haspopup="menu"
              aria-expanded={open?.index === i}
              aria-keyshortcuts={accessKeys[i] ? `Alt+${accessKeys[i]?.toUpperCase()}` : undefined}
              // A click without pointer coordinates comes from Enter or Space
              onClick={(e) =>
                setOpen(open?.index === i ? null : { index: i, byKey: e.detail === 0 })
              }
              onPointerEnter={() => {
                if (open !== null) setOpen({ index: i, byKey: false });
              }}
              onKeyDown={(e) => {
                if (open !== null) return;
                const move = (by: number) =>
                  category((i + by + MENUS.length) % MENUS.length)?.focus();
                if (e.key === "ArrowRight") move(1);
                else if (e.key === "ArrowLeft") move(-1);
                else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  setOpen({ index: i, byKey: true });
                } else if (e.key === "Escape") leave();
                else return;
                // Not keys of the plan (the arrows would move the selection there)
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              {head}
              {key && <u>{key}</u>}
              {tail}
            </button>
            {open?.index === i && (
              <MenuList
                // A menu reached with the arrow keys opens anew, so its first entry is focused
                key={open.byKey ? "keys" : "pointer"}
                entries={menu.entries()}
                label={menu.label}
                autoFocus={open.byKey}
                onDone={() => {
                  setOpen(null);
                  setKeys(false);
                }}
              />
            )}
          </div>
        );
      })}
      <span className="spacer" />
      <button
        type="button"
        className="menu-search"
        onClick={() => setPaletteOpen(true)}
        title={t("Search all commands (Ctrl+K)")}
      >
        <Icon name="search" size={16} />
        <span>{t("Search commands")}</span>
        <kbd>{formatShortcut("Ctrl+K")}</kbd>
      </button>
    </nav>
  );
}
