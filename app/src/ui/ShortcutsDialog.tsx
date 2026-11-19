// Overview of the keyboard shortcuts (Help menu): those of the commands and those of the views.

import { useEffect } from "react";
import { formatShortcut, t } from "../i18n";
import { MENUS, type MenuEntry } from "./commands";

/** Keys of the plan and the 3D view that are no commands of the menus. */
const VIEW_KEYS: [string, string][] = [
  [t("Arrow keys"), t("Move the selection by 1 cm (Shift: 10 cm, Alt: 1 mm)")],
  [formatShortcut("Shift+R"), t("Rotate the selection by -15°")],
  [t("Enter / double-click"), t("Finish the drawing")],
  ["Esc", t("Discard the drawing; end the pipette or the placing of a piece")],
  ["Alt / F10", t("Go to the menu bar; Alt and a letter opens a menu")],
  ["F6 / F4", t("Show or hide the catalog / the properties")],
  [t("Backspace"), t("Remove the last point while drawing")],
  [
    t("Digits + Enter (while drawing)"),
    t("Length of the next segment, also with units and arithmetic; @dx,dy relative, #x,y absolute"),
  ],
  [
    "Tab",
    t("While drawing: switch between length and angle; otherwise: next element under the mouse"),
  ],
  [t("Alt (held)"), t("Invert magnetism")],
  [t("Shift (held)"), t("Angles in 1° steps while drawing; move on one axis while dragging")],
  [t("Shift+click / Ctrl+click"), t("Add to the selection or take out of it")],
  [t("Space (held) + drag"), t("Pan the plan")],
  [t("Right mouse button"), t("Pan the plan; context menu")],
  [t("Mouse wheel"), t("Zoom the plan or the 3D view")],
  [t("Click in the 3D view"), t("Select furniture, a wall or a room (Ctrl or Shift: add)")],
  [t("Arrow keys in the aerial view"), t("Turn the view (Shift: move it; + and -: zoom)")],
  [t("W A S D / arrows"), t("Walk in the virtual visit")],
  ["Q / E", t("Move down / up in the virtual visit")],
];

function shortcuts(): [string, string][] {
  const rows: [string, string][] = [];
  const seen = new Set<string>();
  const walk = (entries: MenuEntry[]) => {
    for (const e of entries) {
      if (e.kind === "command" && e.command.shortcut && !seen.has(e.command.id)) {
        seen.add(e.command.id);
        rows.push([formatShortcut(e.command.shortcut), e.command.label]);
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
      <div className="dialog shortcuts-dialog" role="dialog" aria-label={t("Keyboard shortcuts")}>
        <header className="dialog-header">
          <h2>{t("Keyboard shortcuts")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Close")}>
            ×
          </button>
        </header>
        <div className="dialog-body shortcuts-columns">
          <section>
            <h3>{t("Commands")}</h3>
            {table(shortcuts())}
          </section>
          <section>
            <h3>{t("Plan and 3D view")}</h3>
            {table(VIEW_KEYS)}
          </section>
        </div>
      </div>
    </div>
  );
}
