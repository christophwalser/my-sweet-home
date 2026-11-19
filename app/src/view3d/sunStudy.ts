// Values of the sliders of the 3D settings: time of day and day of the year of the sun
// study, and the range of the horizontal section.

import type { Home } from "../model";

/** Minutes since midnight of a time "HH:MM". */
export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Time "HH:MM" of minutes since midnight. */
export function fromMinutes(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Day of the year (1 = January 1st) of a date "YYYY-MM-DD"; 1 for anything else. */
export function dayOfYear(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return 1;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
}

/** Date "YYYY-MM-DD" of a day of the year in the year of `date` (this year without one). */
export function fromDayOfYear(date: string, day: number): string {
  const year = Number(date.slice(0, 4)) || new Date().getFullYear();
  return new Date(Date.UTC(year, 0, day)).toISOString().slice(0, 10);
}

/** Height a person looks over: where a new horizontal section starts above the floor. */
const SECTION_START = 120;

/**
 * Range of the horizontal section in cm above the ground: up to the top of the highest
 * level, and where a new section starts (above the floor of the selected level).
 */
export function sectionRange(home: Home, level: string | null): { max: number; start: number } {
  const wallHeight = home.attrs.wall_height ?? 250;
  let max = wallHeight;
  let floor = 0;
  for (const l of home.levels) {
    max = Math.max(max, l.attrs.elevation + (l.attrs.height ?? wallHeight));
    if (l.attrs.id === level) floor = l.attrs.elevation;
  }
  max = Math.ceil(max / 5) * 5;
  return { max, start: Math.min(floor + SECTION_START, max) };
}
