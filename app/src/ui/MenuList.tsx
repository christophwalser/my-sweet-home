// Drop-down list of menu entries (menu bar, tool bar drop-downs), with fly-out submenus.

import { useState } from "react";
import { type Command, isEnabled, type MenuEntry, runCommand } from "./commands";
import Icon from "./Icon";

/** One command row: icon, label, check mark, shortcut. */
function CommandItem({ command, onDone }: { command: Command; onDone: () => void }) {
  const enabled = isEnabled(command);
  const checked = command.checked?.();
  const content = (
    <>
      {command.icon ? <Icon name={command.icon} size={18} /> : <span className="icon-blank" />}
      <span className="menu-label">{command.label}</span>
      {checked && <Icon name="check" size={16} className="menu-check" />}
      <span className="menu-shortcut">{command.shortcut}</span>
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

export default function MenuList({
  entries,
  label,
  onDone,
  className,
}: {
  entries: MenuEntry[];
  label: string;
  /** Called when a command was chosen: the menu closes */
  onDone: () => void;
  className?: string;
}) {
  const [openSub, setOpenSub] = useState<number | null>(null);
  return (
    <div role="menu" aria-label={label} className={`menu-popup ${className ?? ""}`}>
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
                className="menu-sub"
                onPointerEnter={() => setOpenSub(i)}
                onPointerLeave={() => setOpenSub((s) => (s === i ? null : s))}
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={openSub === i}
                  className="menu-item"
                  onClick={() => setOpenSub(openSub === i ? null : i)}
                >
                  {entry.icon ? (
                    <Icon name={entry.icon} size={18} />
                  ) : (
                    <span className="icon-blank" />
                  )}
                  <span className="menu-label">{entry.label}</span>
                  <Icon name="chevright" size={16} className="menu-chevron" />
                </button>
                {openSub === i && (
                  <MenuList
                    entries={entry.entries()}
                    label={entry.label}
                    onDone={onDone}
                    className="menu-flyout"
                  />
                )}
              </div>
            );
          default:
            return (
              <div key={key} onPointerEnter={() => setOpenSub(null)}>
                <CommandItem command={entry.command} onDone={onDone} />
              </div>
            );
        }
      })}
    </div>
  );
}
