// State of the window's UI that menus, tool bar and command search share: the open dialog,
// the theme, the variants remembered by split buttons, and whether the 3D view is detached.

import { useEffect, useState } from "react";
import { create } from "zustand";

/** Dialogs and panels that commands can open. Only one is open at a time. */
export type DialogName =
  | "preferences"
  | "export"
  | "importFurniture"
  | "libraries"
  | "backgroundImport"
  | "backgroundModify"
  | "photo"
  | "video"
  | "settings3d"
  | "shortcuts"
  | "about"
  | "plugins";

/** Color theme: following the system, or fixed. */
export type ThemeChoice = "system" | "light" | "dark";

type UiState = {
  dialog: DialogName | null;
  /** Argument of the open dialog, e.g. the file to import */
  dialogArg: string | null;
  openDialog: (dialog: DialogName, arg?: string) => void;
  closeDialog: () => void;
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
  /** Variant last chosen per split button of the tool bar (button ID → command ID) */
  variants: Record<string, string>;
  setVariant: (button: string, command: string) => void;
};

const THEME_KEY = "msh.theme";
const VARIANTS_KEY = "msh.toolVariants";

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
  openDialog: (dialog, arg) => set({ dialog, dialogArg: arg ?? null }),
  closeDialog: () => set({ dialog: null }),
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
  variants: loadJson<Record<string, string>>(VARIANTS_KEY, {}),
  setVariant: (button, command) => {
    const variants = { ...get().variants, [button]: command };
    set({ variants });
    saveJson(VARIANTS_KEY, variants);
  },
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
