// Sizes of the main window's panes, remembered between sessions.

import { useCallback, useEffect, useState } from "react";

/** Pane that fills the center (the other one is collapsed), or null for both visible. */
export type Maximized = "plan" | "3d" | null;

export interface Layout {
  /** Width of the catalog on the left in px */
  left: number;
  /** Width of the properties panel on the right in px */
  right: number;
  /** Share of the plan in the height of the center (0..1) */
  split: number;
  maximized: Maximized;
}

export const DEFAULT_LAYOUT: Layout = { left: 280, right: 250, split: 0.5, maximized: null };
export const SIDE_MIN = 180;
export const SIDE_MAX = 640;
const STORAGE_KEY = "msh.layout";

function load(): Layout {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Layout>;
    return { ...DEFAULT_LAYOUT, ...stored };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function clampSide(width: number): number {
  return Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, width)));
}

/** Layout state, saved in the WebView's local storage. */
export function useLayout(): [Layout, (patch: Partial<Layout>) => void] {
  const [layout, setLayout] = useState<Layout>(load);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Storage not available: the layout is just not remembered
    }
  }, [layout]);
  const update = useCallback(
    (patch: Partial<Layout>) => setLayout((l) => ({ ...l, ...patch })),
    [],
  );
  return [layout, update];
}
