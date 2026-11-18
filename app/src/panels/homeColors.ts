// Colors used in the open home, offered below a color field so that a color chosen once can
// be used again without typing it.

import { forEachPiece, type Home } from "../model";

/** Number of colors offered. */
export const MAX_HOME_COLORS = 24;

/** `#rrggbb` of a typed color ("#abc", "aabbcc", "#AABBCC"), or null if it is none. */
export function parseHex(text: string): string | null {
  const hex = text.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map((c) => c + c).join("")}`;
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

/** Colors of walls, rooms and furniture as `#rrggbb`, the most used first. */
export function homeColors(home: Home | null): string[] {
  if (!home) return [];
  const count = new Map<string, number>();
  const add = (argb: number | null | undefined) => {
    if (argb === null || argb === undefined) return;
    const hex = `#${(argb & 0xffffff).toString(16).padStart(6, "0")}`;
    count.set(hex, (count.get(hex) ?? 0) + 1);
  };
  for (const w of home.walls) {
    add(w.attrs.left_side_color);
    add(w.attrs.right_side_color);
    add(w.attrs.top_color);
    for (const b of w.baseboards ?? []) add(b.attrs.color);
  }
  for (const r of home.rooms) {
    add(r.attrs.floor_color);
    add(r.attrs.ceiling_color);
  }
  forEachPiece(home.furniture, (p) => add(p.attrs.color));
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_HOME_COLORS)
    .map(([hex]) => hex);
}
