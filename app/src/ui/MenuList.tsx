// Drop-down list of menu entries (menu bar, tool bar drop-downs), with fly-out submenus.
// Keyboard: arrow keys up and down, Home and End walk the entries, the right arrow or Enter
// opens a submenu, the left arrow or Escape closes it, a letter goes to the entries starting
// with it (and runs the only one). Submenus open and close after a short delay, so a pointer
// moved diagonally towards a submenu does not close it.

import { useEffect, useRef, useState } from "react";
import { formatShortcut } from "../i18n";
import { type Command, isEnabled, type MenuEntry, runCommand } from "./commands";
import Icon from "./Icon";
import { nextByLetter } from "./mnemonics";

/** Delay in ms before a submenu opens or closes under the pointer. */
const SUBMENU_DELAY_MS = 250;

/** One command row: icon, label, check mark, shortcut. */
function CommandItem({ command, onDone }: { command: Command; onDone: () => void }) {
  const enabled = isEnabled(command);
  const checked = command.checked?.();
  const content = (
    <>
      {command.icon ? <Icon name={command.icon} size={18} /> : <span className="icon-blank" />}
      <span className="menu-label">{command.label}</span>
      {checked && <Icon name="check" size={16} className="menu-check" />}
      <span className="menu-shortcut">{command.shortcut && formatShortcut(command.shortcut)}</span>
    </>
  );
  const choose = () => {
    onDone();
    runCommand(command);
  };
  return checked === undefined ? (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      disabled={!enabled}
      title={command.hint}
      onClick={choose}
    >
      {content}
    </button>
  ) : (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className="menu-item"
      disabled={!enabled}
      title={command.hint}
      onClick={choose}
    >
      {content}
    </button>
  );
}

/** Enabled entries of a menu, without those of its submenus. */
export function menuItems(popup: HTMLElement | null): HTMLButtonElement[] {
  return popup
    ? [...popup.querySelectorAll<HTMLButtonElement>(":scope > div > .menu-item:not(:disabled)")]
    : [];
}

export default function MenuList({
  entries,
  label,
  onDone,
  className,
  autoFocus,
  onLeave,
}: {
  entries: MenuEntry[];
  label: string;
  /** Called when a command was chosen: the menu closes */
  onDone: () => void;
  className?: string;
  /** Opened with the keyboard: the first entry takes the focus */
  autoFocus?: boolean;
  /** A submenu: called when the left arrow or Escape closes it */
  onLeave?: () => void;
}) {
  /** Open submenu, and whether the keyboard opened it (its first entry takes the focus) */
  const [openSub, setOpenSub] = useState<{ index: number; byKey: boolean } | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the menu opens
  useEffect(() => {
    if (autoFocus) menuItems(popup.current)[0]?.focus();
  }, []);

  /** Opens (or with null closes) a submenu under the pointer after the delay. */
  const hover = (index: number | null) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => setOpenSub(index === null ? null : { index, byKey: false }),
      SUBMENU_DELAY_MS,
    );
  };
  const openNow = (index: number | null, byKey: boolean) => {
    window.clearTimeout(timer.current);
    setOpenSub(index === null ? null : { index, byKey });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const items = menuItems(popup.current);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus();
    const active = items[current];
    const sub = active?.getAttribute("aria-haspopup") === "menu" ? active : null;
    if (e.key === "ArrowDown") focus(current + 1);
    else if (e.key === "ArrowUp") focus(current < 0 ? -1 : current - 1);
    else if (e.key === "Home") focus(0);
    else if (e.key === "End") focus(-1);
    else if (sub && (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ")) {
      openNow(Number(sub.dataset.index), true);
      // Also when the pointer or a letter had opened it already: the focus goes into it
      const parent = sub.parentElement;
      requestAnimationFrame(() =>
        menuItems(parent?.querySelector<HTMLElement>(":scope > .menu-popup") ?? null)[0]?.focus(),
      );
    } else if (onLeave && (e.key === "ArrowLeft" || e.key === "Escape")) onLeave();
    else if (e.key.length === 1 && e.key !== " ") {
      const next = nextByLetter(
        items.map((i) => i.querySelector(".menu-label")?.textContent ?? ""),
        current,
        e.key,
      );
      if (next.index < 0) return;
      items[next.index].focus();
      if (next.unique) items[next.index].click();
    } else return;
    // Handled here: not a key of the menu around this one, the menu bar or the plan
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      role="menu"
      aria-label={label}
      className={`menu-popup ${className ?? ""}`}
      ref={popup}
      onKeyDown={onKeyDown}
    >
      {entries.map((entry, i) => {
        const key = `${i}-${entry.kind}`;
        switch (entry.kind) {
          case "separator":
            return <hr key={key} className="menu-separator" />;
          case "heading":
            return (
              <div key={key} className="menu-heading">
                {entry.label}
              </div>
            );
          case "submenu":
            return (
              <div
                key={key}
                className={`menu-sub ${openSub?.index === i ? "open" : ""}`}
                onPointerEnter={() => hover(i)}
                onPointerLeave={() => hover(null)}
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={openSub?.index === i}
                  className="menu-item"
                  data-index={i}
                  onClick={() => openNow(openSub?.index === i ? null : i, false)}
                >
                  {entry.icon ? (
                    <Icon name={entry.icon} size={18} />
                  ) : (
                    <span className="icon-blank" />
                  )}
                  <span className="menu-label">{entry.label}</span>
                  <Icon name="chevright" size={16} className="menu-chevron" />
                </button>
                {openSub?.index === i && (
                  <MenuList
                    entries={entry.entries()}
                    label={entry.label}
                    onDone={onDone}
                    className="menu-flyout"
                    autoFocus={openSub.byKey}
                    onLeave={() => {
                      openNow(null, false);
                      popup.current
                        ?.querySelector<HTMLButtonElement>(`:scope > div > [data-index="${i}"]`)
                        ?.focus();
                    }}
                  />
                )}
              </div>
            );
          default:
            return (
              <div key={key} onPointerEnter={() => hover(null)}>
                <CommandItem command={entry.command} onDone={onDone} />
              </div>
            );
        }
      })}
    </div>
  );
}
