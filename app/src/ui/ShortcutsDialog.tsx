// Overview of the keyboard shortcuts (F1): those of the commands and those of the views.

import { useEffect } from "react";
import { MENUS, type MenuEntry } from "./commands";

/** Keys of the plan and the 3D view that are no commands of the menus. */
const VIEW_KEYS: [string, string][] = [
  ["Arrow keys", "Move the selection by 1 cm (Shift: 10 cm)"],
  ["Shift+R", "Rotate the selected furniture by -15°"],
  ["Enter / double-click", "Finish the drawing"],
  ["Backspace", "Remove the last point while drawing"],
  ["Digits + Enter", "Length of the next wall or line segment"],
  ["Alt (held)", "Invert magnetism"],
  ["Shift (held)", "Angles in 1° steps; add to the selection"],
  ["Right mouse button", "Pan the plan; context menu"],
  ["Mouse wheel", "Zoom the plan or the 3D view"],
  ["W A S D / arrows", "Walk in the virtual visit"],
  ["Q / E", "Move down / up in the virtual visit"],
];

function shortcuts(): [string, string][] {
  const rows: [string, string][] = [];
  const seen = new Set<string>();
  const walk = (entries: MenuEntry[]) => {
    for (const e of entries) {
      if (e.kind === "command" && e.command.shortcut && !seen.has(e.command.id)) {
        seen.add(e.command.id);
        rows.push([e.command.shortcut, e.command.label]);
      } else if (e.kind === "submenu") {
        walk(e.entries());
      }
    }
  };
  for (const m of MENUS) walk(m.entries());
  return rows;
}

export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const table = (rows: [string, string][]) => (
    <table className="shortcut-table">
      <tbody>
        {rows.map(([key, what]) => (
          <tr key={`${key}-${what}`}>
            <td>
              <kbd>{key}</kbd>
            </td>
            <td>{what}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="dialog-backdrop">
      <div className="dialog shortcuts-dialog" role="dialog" aria-label="Keyboard shortcuts">
        <header className="dialog-header">
          <h2>Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="dialog-body shortcuts-columns">
          <section>
            <h3>Commands</h3>
            {table(shortcuts())}
          </section>
          <section>
            <h3>Plan and 3D view</h3>
            {table(VIEW_KEYS)}
          </section>
        </div>
      </div>
    </div>
  );
}
