// Global UI state (zustand).

import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { api, type CatalogData, HOME_CHANGED_EVENT } from "./api";
import { errorText } from "./errorText";
import { language, t } from "./i18n";
import { forEachGroup, forEveryPiece, type OpenedHome } from "./model";
import { homeGuides } from "./plan2d/guides";
import { usePreferences } from "./preferences";
import type { CameraPose } from "./view3d/camera";

export type ViewMode = "aerial" | "observer";

/** Selection ID of the virtual visitor in the plan (not an element of the home). */
export const VISITOR_ID = "observer";

/** Tool of the 2D plan. */
export type Tool =
  | "select"
  | "pan"
  | "wall"
  | "arcwall"
  | "room"
  | "roomauto"
  | "polyline"
  | "dimension"
  | "heightdim"
  | "label"
  | "measure"
  /** Ruler: a guide line that stays in the plan (measuring tool without the length) */
  | "ruler";

/** A line of a wall: its axis or one of its faces (left = left from the start to the end). */
export type WallLine = "axis" | "left" | "right";

type State = {
  opened: OpenedHome | null;
  selectedLevel: string | null;
  /** IDs of the selected elements */
  selection: string[];
  tool: Tool;
  /** Thickness of new walls drawn in the plan (cm) */
  wallThickness: number;
  /** Height of new walls (cm); null: the wall height of the home */
  wallHeight: number | null;
  /** Line of new walls that runs through the drawn points */
  wallLine: WallLine;
  /** Arc of new round walls in degrees */
  arcExtent: number;
  /** Line of a wall that stays when its thickness is changed in the properties */
  wallKeepLine: WallLine;
  /** A new elevation or height of a level moves the levels above along (properties) */
  levelShiftAbove: boolean;
  /** A new height of a level is given to its walls of full height (properties) */
  levelAdjustWalls: boolean;
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
  /** Message that something worked (e.g. saved); leaves by itself */
  notice: string | null;
  setNotice: (notice: string | null) => void;
  loading: boolean;
  viewMode: ViewMode;
  /** Live position of the virtual visitor (shown in the plan while walking) */
  visitorPose: CameraPose | null;
  /** Writes the cameras of the 3D view into the home (set by the 3D view, used before saving) */
  cameraSync: (() => Promise<void>) | null;
  /** Catalog of the visible libraries */
  catalog: CatalogData | null;
  /** All libraries with their items, hidden ones too (for the library editor) */
  catalogAll: CatalogData | null;
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
  wallThickness: usePreferences.getState().newWallThickness,
  wallHeight: null,
  wallLine: "axis",
  arcExtent: 90,
  wallKeepLine: "axis",
  levelShiftAbove: true,
  levelAdjustWalls: true,
  highlightSide: null,
  fitRequest: 0,
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  setHighlightSide: (highlightSide) => set({ highlightSide }),
  setSelection: (selection) => set({ selection }),
  setTool: (tool) => set({ tool }),
  setWallThickness: (wallThickness) => set({ wallThickness }),
  error: null,
  notice: null,
  setNotice: (notice) => set({ notice }),
  loading: false,
  viewMode: "aerial",
  visitorPose: null,
  cameraSync: null,
  catalog: null,
  catalogAll: null,
  catalogLoading: false,

  openHome: async (path) => {
    set({ loading: true, error: null });
    try {
      // The backend also emits HOME_CHANGED_EVENT; applying the result here avoids waiting for it
      applyHome(await api.openHome(path));
    } catch (e) {
      set({ error: errorText(e) });
    } finally {
      set({ loading: false });
    }
  },

  run: async (command, params = {}) => {
    try {
      return await api.execute(command, params);
    } catch (e) {
      set({ error: errorText(e) });
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
    // The camera moves are kept in the 3D view until now (they are no undo steps)
    await syncCameras();
    const saved = await get().run("home_save", { path });
    if (saved !== undefined) {
      set({ notice: t("Saved {file}", { file: path.split(/[\\/]/).pop() ?? path }) });
    }
  },

  selectLevel: (id) => set({ selectedLevel: id }),
  setViewMode: (viewMode) => set({ viewMode }),

  loadCatalog: async (lang) => {
    if (get().catalogLoading) return;
    set({ catalogLoading: true });
    try {
      const all = await api.catalogLoad(lang);
      const shown = new Set(all.libraries.filter((l) => !l.hidden).map((l) => l.index));
      set({
        catalogAll: all,
        catalog: {
          ...all,
          libraries: all.libraries.filter((l) => shown.has(l.index)),
          items: all.items.filter((i) => shown.has(i.library)),
        },
      });
    } catch (e) {
      set({ error: errorText(e) });
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
    // A command may switch the camera (e.g. viewpoint_go): follow it
    viewMode:
      newHome || next.home.attrs.camera !== prev?.home.attrs.camera
        ? next.home.attrs.camera === "observerCamera"
          ? "observer"
          : "aerial"
        : viewMode,
    visitorPose: newHome ? null : useStore.getState().visitorPose,
  });
}

/** Stores the current cameras of the 3D view in the home (before saving, or before photos). */
export async function syncCameras(): Promise<void> {
  const { cameraSync, visitorPose, viewMode, opened } = useStore.getState();
  try {
    if (cameraSync) {
      await cameraSync();
    } else if (visitorPose && opened) {
      // The 3D view is in its own window: the visitor's position is known from there
      await api.execute("camera_set", {
        mode: "observer",
        ...poseParams(visitorPose),
        activate: viewMode === "observer",
      });
    }
  } catch (e) {
    useStore.setState({ error: errorText(e) });
  }
}

/** The visitor as shown in the plan: its live pose, else the camera stored in the home. */
export function currentVisitor(): CameraPose | null {
  const { visitorPose, opened } = useStore.getState();
  if (visitorPose) return visitorPose;
  const c = opened?.home.cameras.find((cam) => cam.attrs.role === "observerCamera")?.attrs;
  return c ? { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, fov: c.field_of_view } : null;
}

/** Moves the visitor (from the plan or the properties); the 3D view follows. */
export function setVisitor(change: Partial<CameraPose>): Promise<unknown> {
  const pose = currentVisitor();
  if (!pose) return Promise.resolve(undefined);
  const next = { ...pose, ...change };
  // Shown at once; the 3D view takes it over when the command returns
  useStore.setState({ visitorPose: next });
  return useStore.getState().run("camera_set", { mode: "observer", ...poseParams(next) });
}

/** Parameters of `camera_set` / `viewpoint_store` for a camera pose. */
export function poseParams(p: CameraPose): Record<string, number> {
  const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 100) / 100;
  const cm = (v: number) => Math.round(v * 10) / 10;
  return {
    x: cm(p.x),
    y: cm(p.y),
    z: cm(p.z),
    yaw: deg(p.yaw),
    pitch: Math.max(-90, Math.min(90, deg(p.pitch))),
    field_of_view: Math.max(2, Math.min(170, deg(p.fov))),
  };
}

/** IDs of all elements of a home. */
function allIds(opened: OpenedHome): Set<string> {
  const ids = new Set<string>();
  const h = opened.home;
  // Hidden pieces stay selected: their panel is where they are shown again
  forEveryPiece(h.furniture, (p) => {
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
  for (const g of homeGuides(h)) ids.add(g.id);
  // The compass is selectable in the plan while it is visible, the visitor in the visit
  if (h.compass && h.compass.attrs.visible !== false) ids.add("compass");
  ids.add(VISITOR_ID);
  return ids;
}

/** Event of the backend after libraries were imported or removed. */
const CATALOG_CHANGED_EVENT = "catalog-changed";

/**
 * Subscribes to home changes and catalog changes (library import/removal) from the
 * backend. Returns the unsubscribe function.
 */
export async function subscribeToHomeChanges(): Promise<() => void> {
  // Each window shows its own home: only its own changes count
  const offHome = await getCurrentWebviewWindow().listen<OpenedHome>(HOME_CHANGED_EVENT, (e) =>
    applyHome(e.payload),
  );
  const offCatalog = await listen(CATALOG_CHANGED_EVENT, () => {
    void useStore.getState().loadCatalog(language());
  });
  return () => {
    offHome();
    offCatalog();
  };
}
