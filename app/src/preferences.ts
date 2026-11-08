// User preferences of the app (first version of Sweet Home 3D's preferences), kept in the
// WebView's local storage. The full preferences dialog with units and defaults follows in P12.

import { create } from "zustand";

export type Preferences = {
  /** Rulers along the top and left edge of the plan */
  rulers: boolean;
  /** Grid in the plan */
  grid: boolean;
  /** Magnetism while drawing and dragging; Alt inverts it temporarily */
  magnetism: boolean;
  /** Furniture in the plan seen from above (rendered from the model) instead of its icon */
  furnitureTopView: boolean;
};

const KEY = "msh.preferences";
export const DEFAULT_PREFERENCES: Preferences = {
  rulers: true,
  grid: true,
  magnetism: true,
  furnitureTopView: true,
};

function load(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Preferences>;
    return { ...DEFAULT_PREFERENCES, ...saved };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

type Store = Preferences & { update: (changes: Partial<Preferences>) => void };

export const usePreferences = create<Store>((set, get) => ({
  ...load(),
  update: (changes) => {
    set(changes);
    const { rulers, grid, magnetism, furnitureTopView } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ rulers, grid, magnetism, furnitureTopView }));
    } catch {
      // Storage unavailable: the preference applies until the app is closed
    }
  },
}));

/** Whether magnetism applies to a pointer event: the preference, inverted while Alt is held. */
export function magnetismActive(altKey: boolean): boolean {
  return usePreferences.getState().magnetism !== altKey;
}
