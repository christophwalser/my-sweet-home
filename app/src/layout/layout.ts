// Sizes of the main window's panes, remembered between sessions. The layout is a store, so
// the commands of the View menu and the splitters change the same state.

import { create } from "zustand";

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
  /** The catalog on the left is hidden */
  leftHidden: boolean;
  /** The properties on the right are hidden */
  rightHidden: boolean;
}

export const DEFAULT_LAYOUT: Layout = {
  left: 280,
  right: 250,
  split: 0.5,
  maximized: null,
  leftHidden: false,
  rightHidden: false,
};
export const SIDE_MIN = 180;
export const SIDE_MAX = 640;
/** A side panel dragged narrower than this is hidden. */
export const SIDE_HIDE = 110;
/** Step of the arrow keys on a splitter in px. */
export const SIDE_STEP = 16;
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

/**
 * Width and visibility of a side panel dragged to `width`: far below the minimum width it is
 * hidden (and shown again when dragged out), otherwise the width is kept within its limits.
 */
export function draggedSide(width: number): { width: number | null; hidden: boolean } {
  if (width < SIDE_HIDE) return { width: null, hidden: true };
  return { width: clampSide(width), hidden: false };
}

type LayoutStore = Layout & { update: (patch: Partial<Layout>) => void };

/** Layout state, saved in the WebView's local storage. */
export const useLayoutStore = create<LayoutStore>((set, get) => ({
  ...load(),
  update: (patch) => {
    set(patch);
    const { update: _, ...layout } = get();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Storage not available: the layout is just not remembered
    }
  },
}));

export function useLayout(): [Layout, (patch: Partial<Layout>) => void] {
  const layout = useLayoutStore();
  return [layout, layout.update];
}
