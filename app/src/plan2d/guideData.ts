// Data of the ruler guides, kept in the home property `mySweetHome.guides`. Separate from
// guides.ts (drawing and picking) so that the magnetism can read them without import cycles.

import type { Home } from "../model";

export type Guide = {
  id: string;
  level: string | null;
  x_start: number;
  y_start: number;
  x_end: number;
  y_end: number;
  /** Line color "#RRGGBB"; missing: the ruler color of the preferences */
  color?: string;
  /** SOLID, DOT, DASH, DASH_DOT or DASH_DOT_DOT; missing: the preferences */
  dash_style?: string;
};

export const GUIDES_PROPERTY = "mySweetHome.guides";

/** All guides of a home (none if the property is missing or unreadable). */
export function homeGuides(home: Home): Guide[] {
  const raw = home.properties?.find((p) => p.name === GUIDES_PROPERTY)?.value;
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? (list as Guide[]) : [];
  } catch {
    return [];
  }
}

/** Guides of a level (homes without levels: all). */
export function levelGuides(home: Home, level: string | null): Guide[] {
  const all = homeGuides(home);
  return home.levels.length === 0 ? all : all.filter((g) => g.level === level);
}
