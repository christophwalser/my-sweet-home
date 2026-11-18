// State of the window's UI that menus, tool bar and command search share: the open dialog,
// the theme, the variants remembered by split buttons, and whether the 3D view is detached.

import { useEffect, useState } from "react";
import { create } from "zustand";
import type { CatalogDragData } from "../api";
import { addRecent } from "../panels/recentTextures";

/** Dialogs and panels that commands can open. Only one is open at a time. */
export type DialogName =
  | "preferences"
  | "export"
  | "importFurniture"
  | "importTexture"
  | "online"
  | "libraries"
  | "backgroundImport"
  | "backgroundModify"
  | "photo"
  | "video"
  | "settings3d"
  | "shortcuts"
  | "rotate"
  | "move"
  | "duplicateLevel"
  | "help"
  | "about"
  | "plugins";

/** Color theme: following the system, or fixed. */
export type ThemeChoice = "system" | "light" | "dark";

type UiState = {
  dialog: DialogName | null;
  /** Argument of the open dialog, e.g. the file to import */
  dialogArg: string | null;
  /** Further values for the open dialog, e.g. category and creator of a catalog item */
  dialogExtra: Record<string, string> | null;
  /** Dialog to show again when the open one closes (e.g. the online catalogs) */
  returnTo: DialogName | null;
  openDialog: (
    dialog: DialogName,
    arg?: string,
    returnTo?: DialogName,
    extra?: Record<string, string>,
  ) => void;
  closeDialog: () => void;
  /** Counts finished furniture imports, so a dialog that opened one learns it succeeded */
  importCount: number;
  noteImport: () => void;
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
  /** Sun shadows in the 3D view (they cost a second render pass) */
  shadows: boolean;
  setShadows: (on: boolean) => void;
  /** Command search (Ctrl+K) */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** The 3D view is shown in its own window */
  detached: boolean;
  setDetached: (detached: boolean) => void;
  /** Level whose name is edited in its tab */
  editingLevel: string | null;
  setEditingLevel: (id: string | null) => void;
  /** Library new catalog items go to (chosen in the library editor; null: the own one) */
  libraryTarget: string | null;
  setLibraryTarget: (path: string | null) => void;
  /** Variant last chosen per split button of the tool bar (button ID → command ID) */
  variants: Record<string, string>;
  setVariant: (button: string, command: string) => void;
  /** Furniture keeps its proportions when its size changes (properties and plan handles) */
  keepProportions: boolean;
  setKeepProportions: (on: boolean) => void;
  /** Search text of the texture chooser, kept from one element to the next */
  textureQuery: string;
  setTextureQuery: (query: string) => void;
  /** Catalog IDs of the textures chosen last, newest first */
  recentTextures: string[];
  noteTexture: (catalogId: string) => void;
  /** The next click on a surface of the plan is handed to `onPick` (pipette) */
  pick: SurfacePick | null;
  setPick: (pick: SurfacePick | null) => void;
  /** Catalog piece that the next click in the plan places (Shift+click: several) */
  placing: { data: CatalogDragData; icon: HTMLImageElement | null } | null;
  setPlacing: (placing: UiState["placing"]) => void;
};

/** A click awaited in the plan, with the hint shown meanwhile. */
export type SurfacePick = {
  label: string;
  onPick: (from: { id: string; surface: string }) => void;
};

const THEME_KEY = "msh.theme";
const VARIANTS_KEY = "msh.toolVariants";
const PROPORTIONS_KEY = "msh.keepProportions";
const RECENT_TEXTURES_KEY = "msh.recentTextures";

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the choice applies until the window is closed
  }
}

export const useUi = create<UiState>((set, get) => ({
  dialog: null,
  dialogArg: null,
  dialogExtra: null,
  returnTo: null,
  openDialog: (dialog, arg, returnTo, extra) =>
    set({ dialog, dialogArg: arg ?? null, returnTo: returnTo ?? null, dialogExtra: extra ?? null }),
  closeDialog: () =>
    set({ dialog: get().returnTo, dialogArg: null, returnTo: null, dialogExtra: null }),
  importCount: 0,
  noteImport: () => set({ importCount: get().importCount + 1 }),
  theme: loadJson<ThemeChoice>(THEME_KEY, "system"),
  setTheme: (theme) => {
    set({ theme });
    saveJson(THEME_KEY, theme);
    applyTheme(theme);
  },
  shadows: false,
  setShadows: (shadows) => set({ shadows }),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  detached: false,
  setDetached: (detached) => set({ detached }),
  editingLevel: null,
  setEditingLevel: (editingLevel) => set({ editingLevel }),
  libraryTarget: null,
  setLibraryTarget: (libraryTarget) => set({ libraryTarget }),
  variants: loadJson<Record<string, string>>(VARIANTS_KEY, {}),
  setVariant: (button, command) => {
    const variants = { ...get().variants, [button]: command };
    set({ variants });
    saveJson(VARIANTS_KEY, variants);
  },
  keepProportions: loadJson<boolean>(PROPORTIONS_KEY, false),
  setKeepProportions: (keepProportions) => {
    set({ keepProportions });
    saveJson(PROPORTIONS_KEY, keepProportions);
  },
  textureQuery: "",
  setTextureQuery: (textureQuery) => set({ textureQuery }),
  recentTextures: loadJson<string[]>(RECENT_TEXTURES_KEY, []),
  noteTexture: (catalogId) => {
    const recentTextures = addRecent(get().recentTextures, catalogId);
    set({ recentTextures });
    saveJson(RECENT_TEXTURES_KEY, recentTextures);
  },
  pick: null,
  setPick: (pick) => set({ pick, placing: null }),
  placing: null,
  setPlacing: (placing) => set({ placing, pick: null }),
}));

/** Sets the theme on the document; "system" lets the CSS follow `prefers-color-scheme`. */
export function applyTheme(theme: ThemeChoice): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

/** Whether the window shows the dark theme right now. */
export function isDark(): boolean {
  const theme = useUi.getState().theme;
  if (theme !== "system") return theme === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Applies the stored theme and follows changes made in other windows of the app (they share
 * the local storage). Returns a function that stops following.
 */
export function initTheme(): () => void {
  applyTheme(useUi.getState().theme);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY) return;
    const theme = loadJson<ThemeChoice>(THEME_KEY, "system");
    useUi.setState({ theme });
    applyTheme(theme);
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/** Whether the dark theme is shown, following the theme choice and the system setting. */
export function useDarkMode(): boolean {
  const theme = useUi((s) => s.theme);
  const query = "(prefers-color-scheme: dark)";
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return theme === "system" ? systemDark : theme === "dark";
}
