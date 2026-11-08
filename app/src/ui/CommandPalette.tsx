// Command search (Ctrl+K): finds any command of the menus by its name, menu or keywords.

import { useMemo, useState } from "react";
import { type Command, isEnabled, MENUS, type MenuEntry, runCommand } from "./commands";
import Icon from "./Icon";
import { useUi } from "./uiStore";

type Found = { command: Command; path: string };

/** All commands of the menus with the menu path they are in. */
function collect(): Found[] {
  const found: Found[] = [];
  const seen = new Set<string>();
  const walk = (entries: MenuEntry[], path: string) => {
    for (const e of entries) {
      if (e.kind === "command" && !seen.has(e.command.id)) {
        seen.add(e.command.id);
        found.push({ command: e.command, path });
      } else if (e.kind === "submenu") {
        walk(e.entries(), `${path} › ${e.label}`);
      }
    }
  };
  for (const m of MENUS) walk(m.entries(), m.label);
  return found;
}

/** Whether all words of the query occur in the command's texts. */
function matches(f: Found, words: string[]): boolean {
  const text =
    `${f.command.label} ${f.path} ${f.command.keywords ?? ""} ${f.command.hint ?? ""}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

export default function CommandPalette() {
  const setOpen = useUi((s) => s.setPaletteOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const all = useMemo(collect, []);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = all
    .filter((f) => matches(f, words))
    // Enabled commands and label matches first
    .sort((a, b) => {
      const ea = isEnabled(a.command) ? 0 : 1;
      const eb = isEnabled(b.command) ? 0 : 1;
      const la = words.every((w) => a.command.label.toLowerCase().includes(w)) ? 0 : 1;
      const lb = words.every((w) => b.command.label.toLowerCase().includes(w)) ? 0 : 1;
      return ea - eb || la - lb;
    })
    .slice(0, 50);
  const close = () => setOpen(false);
  const choose = (f: Found | undefined) => {
    if (!f || !isEnabled(f.command)) return;
    close();
    runCommand(f.command);
  };

  return (
    <div
      className="palette-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="palette" role="dialog" aria-label="Search commands">
        <label className="palette-search">
          <Icon name="search" size={18} />
          <input
            // biome-ignore lint/a11y/noAutofocus: the search is opened to type into it
            autoFocus
            value={query}
            placeholder="Search commands"
            aria-label="Search commands"
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
              else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
              else if (e.key === "Enter") choose(results[active]);
              else return;
              e.preventDefault();
            }}
          />
        </label>
        <div className="palette-results" role="listbox" aria-label="Commands">
          {results.length === 0 && <p className="muted palette-empty">No command found</p>}
          {results.map((f, i) => (
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              key={f.command.id}
              className={`palette-item ${i === active ? "active" : ""}`}
              disabled={!isEnabled(f.command)}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(f)}
            >
              {f.command.icon ? (
                <Icon name={f.command.icon} size={18} />
              ) : (
                <span className="icon-blank" />
              )}
              <span className="menu-label">{f.command.label}</span>
              <span className="palette-path">{f.path}</span>
              <span className="menu-shortcut">{f.command.shortcut}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
