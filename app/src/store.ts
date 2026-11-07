// Global UI state (zustand).

import { create } from "zustand";
import { api, type CatalogData } from "./api";
import type { OpenedHome } from "./model";

type ViewMode = "aerial" | "observer";

type State = {
  opened: OpenedHome | null;
  selectedLevel: string | null;
  error: string | null;
  loading: boolean;
  viewMode: ViewMode;
  catalog: CatalogData | null;
  catalogLoading: boolean;
  openHome: (path: string) => Promise<void>;
  selectLevel: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  loadCatalog: (lang: string) => Promise<void>;
  clearError: () => void;
};

export const useStore = create<State>((set, get) => ({
  opened: null,
  selectedLevel: null,
  error: null,
  loading: false,
  viewMode: "aerial",
  catalog: null,
  catalogLoading: false,

  openHome: async (path) => {
    set({ loading: true, error: null });
    try {
      const previous = get().opened;
      const opened = await api.openHome(path);
      const levels = opened.home.levels;
      const selected =
        levels.find((l) => l.attrs.id === opened.home.attrs.selected_level)?.attrs.id ??
        levels[0]?.attrs.id ??
        null;
      set({
        opened,
        selectedLevel: selected,
        viewMode: opened.home.attrs.camera === "observerCamera" ? "observer" : "aerial",
      });
      if (previous) void api.closeHome(previous.id);
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ loading: false });
    }
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
