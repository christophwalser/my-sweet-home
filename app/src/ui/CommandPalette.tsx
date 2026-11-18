// Command search (Ctrl+K): finds any command of the menus by its name, menu or keywords, also
// by letters typed in their order ("rtwl" for "Round walls"). Without a query it lists the
// commands used last.

import { useEffect, useMemo, useRef, useState } from "react";
import { formatShortcut, t } from "../i18n";
import { type Command, isEnabled, MENUS, type MenuEntry, runCommand } from "./commands";
import { queryScore } from "./fuzzy";
import Icon from "./Icon";
import { useUi } from "./uiStore";

type Found = { command: Command; path: string };

const RECENT_KEY = "msh.recentCommands";
/** Number of commands kept as used last. */
const MAX_RECENT = 8;

function loadRecent(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function noteRecent(id: string): void {
  try {
    const next = [id, ...loadRecent().filter((r) => r !== id)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: nothing is remembered
  }
}

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

/** Rank of a command for the query: lower is better, null if it does not match. */
function rank(f: Found, words: string[]): number | null {
  const label = f.command.label.toLowerCase();
  const inLabel = queryScore(label, words);
  // A match in the name counts more than one in the menu path, the keywords or the hint
  if (inLabel !== null) return inLabel;
  const rest = `${label} ${f.path} ${f.command.keywords ?? ""} ${f.command.hint ?? ""}`;
  const elsewhere = queryScore(rest.toLowerCase(), words);
  return elsewhere === null ? null : 100 + elsewhere;
}

export default function CommandPalette() {
  const setOpen = useUi((s) => s.setPaletteOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const all = useMemo(collect, []);
  const recent = useMemo(loadRecent, []);
  const list = useRef<HTMLDivElement>(null);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results =
    words.length === 0
      ? // Nothing typed: the commands used last, then all others
        [
          ...recent.flatMap((id) => all.filter((f) => f.command.id === id)),
          ...all.filter((f) => !recent.includes(f.command.id)),
        ].slice(0, 50)
      : all
          .map((f) => ({ f, rank: rank(f, words) }))
          .filter((r): r is { f: Found; rank: number } => r.rank !== null)
          // Enabled commands first, then the better matches
          .sort(
            (a, b) =>
              (isEnabled(a.f.command) ? 0 : 1) - (isEnabled(b.f.command) ? 0 : 1) ||
              a.rank - b.rank,
          )
          .map((r) => r.f)
          .slice(0, 50);
  const recentShown =
    words.length === 0 ? results.filter((f) => recent.includes(f.command.id)) : [];
  const close = () => setOpen(false);
  const choose = (f: Found | undefined) => {
    if (!f || !isEnabled(f.command)) return;
    noteRecent(f.command.id);
    close();
    runCommand(f.command);
  };

  // The entry chosen with the arrow keys stays in view
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls when the active entry changes
  useEffect(() => {
    list.current?.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active, query]);

  return (
    <div
      className="palette-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="palette" role="dialog" aria-label={t("Search commands")}>
        <label className="palette-search">
          <Icon name="search" size={18} />
          <input
            // biome-ignore lint/a11y/noAutofocus: the search is opened to type into it
            autoFocus
            value={query}
            placeholder={t("Search commands")}
            aria-label={t("Search commands")}
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
        <div className="palette-results" role="listbox" aria-label={t("Commands")} ref={list}>
          {results.length === 0 && <p className="muted palette-empty">{t("No command found")}</p>}
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
              <span className="palette-path">
                {recentShown.includes(f) ? `${t("Used last")} · ${f.path}` : f.path}
              </span>
              <span className="menu-shortcut">
                {f.command.shortcut && formatShortcut(f.command.shortcut)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
