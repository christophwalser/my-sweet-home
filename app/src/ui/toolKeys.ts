// Keys of the plan tools. A letter chooses a tool directly, as usual in drawing programs. A
// digit chooses the first tool of its group in the tool bar; a second digit typed right after
// it chooses a further variant of the group, counted from 1, e.g. 2 then 1 for "Room from
// walls". The letters can be changed in the preferences.

import { prefs } from "../preferences";

/**
 * Tool command IDs per letter. R (rotate) and J (join walls) act on the selection and are
 * taken, so rooms have F like "floor".
 */
export const TOOL_LETTERS: Record<string, string> = {
  V: "tool.select",
  H: "tool.pan",
  W: "tool.wall",
  F: "tool.room",
  L: "tool.polyline",
  D: "tool.dimension",
  T: "tool.label",
  M: "tool.measure",
  G: "tool.ruler",
};

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

/** Letters that act on the selection in the plan (rotate, join walls): no tool takes them. */
export const RESERVED_LETTERS = ["R", "J"];

/**
 * Letter → tool command ID: the default letters with the changes of the user (`custom`: tool
 * command ID → letter, "" for no letter).
 */
export function toolLetters(
  custom: Record<string, string> = prefs().toolKeys,
): Record<string, string> {
  const byTool = new Map<string, string>();
  for (const [letter, id] of Object.entries(TOOL_LETTERS)) byTool.set(id, letter);
  for (const [id, letter] of Object.entries(custom)) {
    if (letter) byTool.set(id, letter.toUpperCase());
    else byTool.delete(id);
  }
  const out: Record<string, string> = {};
  for (const [id, letter] of byTool) {
    if (!(letter in out)) out[letter] = id;
  }
  return out;
}

/**
 * The changes of the user after giving a tool a letter ("" takes its letter away). A tool that
 * had the letter loses it; letters that are no single letter or are reserved change nothing.
 */
export function withToolKey(
  custom: Record<string, string>,
  id: string,
  letter: string,
): Record<string, string> {
  const key = letter.trim().toUpperCase();
  if (key && (!/^\p{L}$/u.test(key) || RESERVED_LETTERS.includes(key))) return custom;
  const next = { ...custom, [id]: key };
  const other = key ? toolLetters(custom)[key] : undefined;
  if (other && other !== id) next[other] = "";
  return next;
}

/** Shortcut of a tool command as shown in the menus ("2" or "2, 1"), if it has one. */
export function toolShortcut(id: string): string | undefined {
  for (const [letter, tool] of Object.entries(toolLetters())) {
    if (tool === id) return letter;
  }
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

/** Tool command chosen by a plain letter key, if it has one. */
export function toolForLetter(key: string): string | null {
  return toolLetters()[key.toUpperCase()] ?? null;
}
