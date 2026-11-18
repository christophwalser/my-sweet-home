// What the catalog remembers per user: favorites, the pieces placed last, the open categories
// and the size of the entries. Kept in the local storage of the window.

import { create } from "zustand";
import { addRecent } from "../panels/recentTextures";

/** Number of furniture items kept as "used last". */
export const RECENT_ITEMS = 12;

type Stored = {
  /** Catalog IDs of the favorites (furniture and textures) */
  favorites: string[];
  /** Catalog IDs of the furniture placed last, newest first */
  recent: string[];
  /** Open categories as "<kind>:<category>" */
  open: string[];
  /** Entries as large tiles instead of a list */
  tiles: boolean;
};

type CatalogPrefs = Stored & {
  toggleFavorite: (catalogId: string) => void;
  noteUsed: (catalogId: string) => void;
  toggleOpen: (key: string) => void;
  setTiles: (tiles: boolean) => void;
};

const KEY = "msh.catalog";
const DEFAULTS: Stored = { favorites: [], recent: [], open: [], tiles: false };

/** The list with `value` added, or without it if it was in the list. */
export function toggledIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Stored>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export const useCatalogPrefs = create<CatalogPrefs>((set, get) => {
  const change = (values: Partial<Stored>) => {
    set(values);
    const { favorites, recent, open, tiles } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ favorites, recent, open, tiles }));
    } catch {
      // Storage unavailable: remembered until the window is closed
    }
  };
  return {
    ...load(),
    toggleFavorite: (id) => change({ favorites: toggledIn(get().favorites, id) }),
    noteUsed: (id) => change({ recent: addRecent(get().recent, id, RECENT_ITEMS) }),
    toggleOpen: (key) => change({ open: toggledIn(get().open, key) }),
    setTiles: (tiles) => change({ tiles }),
  };
});
