// User preferences of the app, kept in the WebView's local storage and shared by all windows
// of the app (they follow changes made in another window). The theme is kept in the UI store.

import { create } from "zustand";
import type { LengthUnit } from "./units";

/** A catalog server of the user (msh-catalog feed, see docs/CATALOG_FEED.md). */
export type CatalogFeed = { id: string; name: string; url: string; token: string };

/** The level shown as an underlay of the plan: the one below, the one above or none. */
export type Underlay = "below" | "above" | "off";

export type Preferences = {
  // Plan
  /** Rulers along the top and left edge of the plan */
  rulers: boolean;
  /** Grid in the plan */
  grid: boolean;
  /** Magnetism while drawing and dragging; Alt inverts it temporarily */
  magnetism: boolean;
  /** Angle steps of the magnetism in degrees (between the attracting multiples of 45°) */
  angleStep: number;
  /** Magnetism to angles: 45° multiples, angle steps, right angles to walls */
  snapAngles: boolean;
  /** Magnetism to the points and lines of walls, rooms and furniture */
  snapObjects: boolean;
  /** Magnetism to the ruler guides: their ends, middles, lines and crossings */
  snapToRulers: boolean;
  /** Radius of the magnetism in screen pixels */
  snapRadius: number;
  /** Level shown faded under the plan of the shown level, and attracting the pointer */
  underlay: Underlay;
  /** Furniture in the plan seen from above (rendered from the model) instead of its icon */
  furnitureTopView: boolean;
  /** Rooms in the plan: their floor color or texture, or one neutral color */
  roomRendering: "floor" | "monochrome";
  /** Colors of the marks of the left and right wall sides */
  leftSideColor: string;
  rightSideColor: string;
  /** Online catalogs (Sweet Home 3D libraries, ambientCG, Poly Haven) may be searched */
  onlineSources: boolean;
  /** The user's own catalog servers */
  catalogs: CatalogFeed[];
  /** Larger preview of catalog items while the mouse points at them */
  catalogPreview: boolean;
  /** Unit of lengths shown and typed (internally always cm) */
  unit: LengthUnit;
  // Tools
  /** Color of new ruler guides (#RRGGBB, "" for the default of the theme) */
  rulerColor: string;
  /** Dash style of new ruler guides (SOLID, DOT, DASH, DASH_DOT, DASH_DOT_DOT) */
  rulerDashStyle: string;
  /** Color of the measuring tool (#RRGGBB, "" for the default of the theme) */
  measureColor: string;
  // New elements
  /** Thickness of new walls in cm */
  newWallThickness: number;
  /** Wall height of new homes in cm */
  newWallHeight: number;
  /** Plan pattern of new walls */
  newWallPattern: string;
  /** Colors of the sides of new walls (#RRGGBB, "" for none) */
  newWallLeftColor: string;
  newWallRightColor: string;
  /** Floor color of new rooms (#RRGGBB, "" for none) */
  newRoomFloorColor: string;
  /** Floor thickness of new levels in cm */
  newFloorThickness: number;
  /** Font size of new texts in cm */
  newTextSize: number;
  // 3D view
  /** Rendering quality of the 3D view: resolution, antialiasing and shadow detail */
  quality3d: "low" | "medium" | "high";
  /** Walking speed of the virtual visit in km/h */
  walkingSpeed: number;
  // Files
  /** Minutes between autosaves of changed homes; 0: off */
  autosaveMinutes: number;
  // Prices (like Sweet Home 3D: without a currency, prices are not shown)
  /** ISO 4217 code of the currency of furniture prices, "" for none */
  currency: string;
  /** Prices with value added tax: VAT % in the furniture dialog and VAT columns in the list */
  vatEnabled: boolean;
  /** VAT in percent given to pieces whose price is set without one */
  defaultVatPercent: number;
};

const KEY = "msh.preferences";
export const DEFAULT_PREFERENCES: Preferences = {
  rulers: true,
  grid: true,
  magnetism: true,
  angleStep: 5,
  snapAngles: true,
  snapObjects: true,
  snapToRulers: true,
  snapRadius: 10,
  underlay: "below",
  furnitureTopView: true,
  roomRendering: "floor",
  leftSideColor: "#e8913a",
  rightSideColor: "#2bb3a3",
  catalogPreview: true,
  onlineSources: true,
  catalogs: [],
  unit: "cm",
  rulerColor: "",
  rulerDashStyle: "DASH",
  measureColor: "",
  newWallThickness: 10,
  newWallHeight: 250,
  newWallPattern: "hatchUp",
  newWallLeftColor: "",
  newWallRightColor: "",
  newRoomFloorColor: "",
  newFloorThickness: 12,
  newTextSize: 18,
  quality3d: "high",
  walkingSpeed: 5,
  autosaveMinutes: 5,
  currency: "",
  vatEnabled: false,
  defaultVatPercent: 0,
};

function load(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Preferences>;
    return { ...DEFAULT_PREFERENCES, ...saved };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/** The preference values of a store state (without its functions). */
function values(state: Preferences): Preferences {
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_PREFERENCES)) {
    out[key] = (state as Record<string, unknown>)[key];
  }
  return out as Preferences;
}

type Store = Preferences & {
  update: (changes: Partial<Preferences>) => void;
  /** Back to the default values */
  reset: () => void;
};

export const usePreferences = create<Store>((set, get) => ({
  ...load(),
  update: (changes) => {
    set(changes);
    try {
      localStorage.setItem(KEY, JSON.stringify(values(get())));
    } catch {
      // Storage unavailable: the preference applies until the app is closed
    }
  },
  // The catalogs the user added stay
  reset: () => get().update({ ...DEFAULT_PREFERENCES, catalogs: get().catalogs }),
}));

/** Follows changes of the preferences made in other windows; returns a function that stops. */
export function followPreferences(): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) usePreferences.setState(load());
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/** Whether magnetism applies to a pointer event: the preference, inverted while Alt is held. */
export function magnetismActive(altKey: boolean): boolean {
  return usePreferences.getState().magnetism !== altKey;
}

/** The current preferences (outside of React components). */
export function prefs(): Preferences {
  return usePreferences.getState();
}

// ---------------------------------------------------------------- defaults of new elements

/** Parameters of new walls from the preferences (for wall_add_path). */
export function newWallParams(): Record<string, unknown> {
  const p = prefs();
  return {
    pattern: p.newWallPattern,
    ...(p.newWallLeftColor && { left_side_color: p.newWallLeftColor }),
    ...(p.newWallRightColor && { right_side_color: p.newWallRightColor }),
  };
}

/** Parameters of new rooms from the preferences (for room_add). */
export function newRoomParams(): Record<string, unknown> {
  const color = prefs().newRoomFloorColor;
  return color ? { floor_color: color } : {};
}

/** Font size of new texts in Sweet Home 3D (cm); other sizes are written as text style. */
const DEFAULT_TEXT_SIZE = 18;

/** Parameters of new texts from the preferences (for label_add). */
export function newLabelParams(): Record<string, unknown> {
  const size = prefs().newTextSize;
  return size !== DEFAULT_TEXT_SIZE ? { font_size: size } : {};
}

/** Parameters of new homes from the preferences (for home_new). */
export function newHomeParams(): Record<string, unknown> {
  return { wall_height: prefs().newWallHeight };
}
