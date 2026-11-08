// Global UI state (zustand).

import { listen } from "@tauri-apps/api/event";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { api, type CatalogData, HOME_CHANGED_EVENT } from "./api";
import { forEachGroup, forEachPiece, type OpenedHome } from "./model";

export type ViewMode = "aerial" | "observer";

/** Tool of the 2D plan. */
export type Tool = "select" | "wall" | "room" | "polyline" | "dimension" | "label" | "measure";

type State = {
  opened: OpenedHome | null;
  selectedLevel: string | null;
  /** IDs of the selected elements */
  selection: string[];
  tool: Tool;
  /** Thickness of new walls drawn in the plan (cm) */
  wallThickness: number;
  /** Incremented to ask the plan to fit the view (e.g. after importing a background image) */
  fitRequest: number;
  requestFit: () => void;
  /** Wall side emphasized in the plan while its properties are hovered */
  highlightSide: "left" | "right" | null;
  setHighlightSide: (side: "left" | "right" | null) => void;
  setSelection: (ids: string[]) => void;
  setTool: (tool: Tool) => void;
  setWallThickness: (cm: number) => void;
  error: string | null;
  loading: boolean;
  viewMode: ViewMode;
  catalog: CatalogData | null;
  catalogLoading: boolean;
  openHome: (path: string) => Promise<void>;
  /** Runs a registry command; errors are shown in the error bar. */
  run: (command: string, params?: Record<string, unknown>) => Promise<unknown>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  save: (saveAs?: boolean) => Promise<void>;
  selectLevel: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  loadCatalog: (lang: string) => Promise<void>;
  clearError: () => void;
};

/** Level to select after the home changed: keep the current one if it still exists. */
function levelAfterChange(
  next: OpenedHome,
  prev: OpenedHome | null,
  current: string | null,
): string | null {
  const levels = next.home.levels;
  const homeSelected = next.home.attrs.selected_level;
  // A command selected another level (e.g. level_add): follow it
  if (homeSelected && homeSelected !== prev?.home.attrs.selected_level) return homeSelected;
  if (current && levels.some((l) => l.attrs.id === current)) return current;
  return levels.find((l) => l.attrs.id === homeSelected)?.attrs.id ?? levels[0]?.attrs.id ?? null;
}

export const useStore = create<State>((set, get) => ({
  opened: null,
  selectedLevel: null,
  selection: [],
  tool: "select",
  wallThickness: 10,
  highlightSide: null,
  fitRequest: 0,
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  setHighlightSide: (highlightSide) => set({ highlightSide }),
  setSelection: (selection) => set({ selection }),
  setTool: (tool) => set({ tool }),
  setWallThickness: (wallThickness) => set({ wallThickness }),
  error: null,
  loading: false,
  viewMode: "aerial",
  catalog: null,
  catalogLoading: false,

  openHome: async (path) => {
    set({ loading: true, error: null });
    try {
      // The backend also emits HOME_CHANGED_EVENT; applying the result here avoids waiting for it
      applyHome(await api.openHome(path));
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ loading: false });
    }
  },

  run: async (command, params = {}) => {
    try {
      return await api.execute(command, params);
    } catch (e) {
      set({ error: String(e) });
      return undefined;
    }
  },

  undo: async () => {
    if (get().opened?.canUndo) await get().run("edit_undo");
  },

  redo: async () => {
    if (get().opened?.canRedo) await get().run("edit_redo");
  },

  save: async (saveAs = false) => {
    const opened = get().opened;
    if (!opened) return;
    let path = opened.path?.toLowerCase().endsWith(".sh3d") ? opened.path : null;
    if (saveAs || !path) {
      const chosen = await saveDialog({
        defaultPath: path ?? `${opened.home.attrs.name ?? "Home"}.sh3d`,
        filters: [{ name: "Sweet Home 3D", extensions: ["sh3d"] }],
      });
      if (!chosen) return;
      path = chosen;
    }
    await get().run("home_save", { path });
  },

  selectLevel: (id) => set({ selectedLevel: id }),
  setViewMode: (viewMode) => set({ viewMode }),

  loadCatalog: async (lang) => {
    if (get().catalogLoading) return;
    set({ catalogLoading: true });
    try {
      set({ catalog: await api.catalogLoad(lang) });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ catalogLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));

/** Applies a new state of the home (opened here or changed by the UI, CLI or MCP). */
export function applyHome(next: OpenedHome): void {
  const { opened: prev, selectedLevel, viewMode, selection } = useStore.getState();
  const newHome = prev?.id !== next.id;
  // Keep only selected elements that still exist (e.g. after undo or delete)
  const ids = newHome ? new Set<string>() : allIds(next);
  useStore.setState({
    opened: next,
    selection: selection.filter((id) => ids.has(id)),
    selectedLevel: levelAfterChange(next, newHome ? null : prev, newHome ? null : selectedLevel),
    viewMode: newHome
      ? next.home.attrs.camera === "observerCamera"
        ? "observer"
        : "aerial"
      : viewMode,
  });
}

/** IDs of all elements of a home. */
function allIds(opened: OpenedHome): Set<string> {
  const ids = new Set<string>();
  const h = opened.home;
  forEachPiece(h.furniture, (p) => {
    if (p.attrs.id) ids.add(p.attrs.id);
  });
  forEachGroup(h.furniture, (g) => {
    if (g.attrs.id) ids.add(g.attrs.id);
  });
  for (const w of h.walls) ids.add(w.attrs.id);
  for (const x of [...h.rooms, ...h.labels, ...h.dimension_lines, ...h.polylines]) {
    const id = (x.attrs as { id?: string | null }).id;
    if (id) ids.add(id);
  }
  // The compass is selectable in the plan while it is visible
  if (h.compass && h.compass.attrs.visible !== false) ids.add("compass");
  return ids;
}

/** Event of the backend after libraries were imported or removed. */
const CATALOG_CHANGED_EVENT = "catalog-changed";

/**
 * Subscribes to home changes and catalog changes (library import/removal) from the
 * backend. Returns the unsubscribe function.
 */
export async function subscribeToHomeChanges(): Promise<() => void> {
  const offHome = await listen<OpenedHome>(HOME_CHANGED_EVENT, (e) => applyHome(e.payload));
  const offCatalog = await listen(CATALOG_CHANGED_EVENT, () => {
    void useStore.getState().loadCatalog(navigator.language.split("-")[0] || "en");
  });
  return () => {
    offHome();
    offCatalog();
  };
}
