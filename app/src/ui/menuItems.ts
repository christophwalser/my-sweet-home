// Context menu entries made from the commands of the registry, so that a context menu shows
// the same label, shortcut and state as the menus.

import type { MenuItem } from "../plan2d/ContextMenu";
import { command, isEnabled, runCommand } from "./commands";

export function commandItem(id: string): MenuItem {
  const c = command(id);
  return {
    label: c.label,
    shortcut: c.shortcut,
    note: c.checked?.() ? "✓" : undefined,
    disabled: !isEnabled(c),
    action: () => runCommand(c),
  };
}
