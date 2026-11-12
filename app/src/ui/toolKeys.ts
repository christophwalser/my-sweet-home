// Digit keys of the plan tools. A digit chooses the first tool of its group in the tool bar; a
// second digit typed right after it chooses a further variant of the group, counted from 1,
// e.g. 2 then 1 for "Room from walls".

/** Tool command IDs per digit, in the order of the drop-down of their tool bar button. */
export const TOOL_GROUPS: Record<string, string[]> = {
  "1": ["tool.wall", "tool.arcwall"],
  "2": ["tool.room", "tool.roomauto"],
  "3": ["tool.polyline"],
  "4": ["tool.dimension", "tool.heightdim"],
  "5": ["tool.label"],
  "6": ["tool.measure", "tool.ruler"],
};

/** Time in ms in which the second digit counts as choosing an entry of the group. */
export const SECOND_KEY_MS = 1000;

/** Digit typed last and when, while a second digit may still follow it. */
export type ToolKeyState = { group: string; at: number } | null;

/** Shortcut of a tool command as shown in the menus ("2" or "2, 1"), if it has one. */
export function toolShortcut(id: string): string | undefined {
  for (const [digit, ids] of Object.entries(TOOL_GROUPS)) {
    const i = ids.indexOf(id);
    if (i === 0) return digit;
    if (i > 0) return `${digit}, ${i}`;
  }
  return undefined;
}

/**
 * Tool command chosen by a digit typed at `now`, and the state for the next digit. Returns no
 * command for digits without a tool.
 */
export function toolForDigit(
  state: ToolKeyState,
  digit: string,
  now: number,
): { command: string | null; state: ToolKeyState } {
  if (state && now - state.at <= SECOND_KEY_MS) {
    const n = Number(digit);
    const entry = n > 0 ? TOOL_GROUPS[state.group]?.[n] : undefined;
    if (entry) return { command: entry, state: null };
  }
  const group = TOOL_GROUPS[digit];
  if (!group) return { command: null, state: null };
  return { command: group[0], state: group.length > 1 ? { group: digit, at: now } : null };
}
