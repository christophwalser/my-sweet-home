// Thin wrappers around the Tauri commands of the backend (app/src-tauri/src/commands.rs).

import { invoke } from "@tauri-apps/api/core";
import type { OpenedHome } from "./model";

export type AppInfo = { name: string; version: string };

export type CatalogKind = "furniture" | "textures";

export type LibraryInfo = {
  index: number;
  path: string;
  name: string | null;
  kind: CatalogKind;
  license: string | null;
  /** Not shown in the catalog (the library editor lists it) */
  hidden: boolean;
  /** Its items can be changed (libraries in the user's library folders) */
  editable: boolean;
};

export type CatalogItem = {
  library: number;
  /** Index of the item in its library (for the library_* commands) */
  index: number;
  kind: CatalogKind;
  id: string | null;
  name: string;
  category: string;
  creator: string | null;
  license: string | null;
  tags: string[];
  icon: string | null;
  model: string | null;
  width: number;
  depth: number;
  height: number;
  doorOrWindow: boolean;
};

export type CatalogData = {
  libraries: LibraryInfo[];
  items: CatalogItem[];
  errors: string[];
};

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  startupFile: () => invoke<string | null>("startup_file"),
  /** Recovered home this window should open when it starts */
  startupRecovery: () => invoke<string | null>("startup_recovery"),
  /** Opens a new window: empty, with a file, or with a recovered home */
  newWindow: (path?: string, recovery?: string) =>
    invoke<string>("new_window", { path: path ?? null, recovery: recovery ?? null }),
  /** Unsaved homes left by an earlier session */
  recoveryList: () => invoke<RecoveryInfo[]>("recovery_list"),
  recoveryOpen: (key: string) => invoke<OpenedHome>("recovery_open", { key }),
  recoveryDiscard: (keys: string[]) => invoke<void>("recovery_discard", { keys }),
  setAutosaveInterval: (seconds: number) => invoke<void>("set_autosave_interval", { seconds }),
  currentHome: () => invoke<OpenedHome | null>("current_home"),
  openHome: (path: string) => invoke<OpenedHome>("open_home", { path }),
  /** Runs a command of the msh-core registry (same commands as CLI and MCP). */
  execute: (command: string, params: Record<string, unknown> = {}) =>
    invoke<unknown>("execute", { command, params }),
  /** Writes a PNG data URL to a file. */
  saveImage: (path: string, dataUrl: string) => invoke<void>("save_image", { path, dataUrl }),
  /** Reads a file chosen by the user as raw bytes. */
  fileExists: (path: string) => invoke<boolean>("file_exists", { path }),
  readFile: async (path: string) =>
    new Uint8Array(await invoke<ArrayBuffer>("read_file", { path })),
  /** Writes binary data (e.g. a video) to a file. */
  saveFile: (path: string, data: Uint8Array) =>
    invoke<void>("save_file", data, { headers: { path: encodeURIComponent(path) } }),
  /** PNG (base64) of the 3D view, rendered by the window that shows it. */
  capture3d: () => invoke<string>("capture_3d_image"),
  /** Exports the 3D view as OBJ through the window that shows it. */
  exportObj: (path: string) => invoke<{ paths: string[] }>("export_obj", { path }),
  /** Writes an OBJ export (OBJ at `path`, MTL and textures next to it). */
  writeObjFiles: (path: string, obj: string, mtl: string, textures: Record<string, string>) =>
    invoke<string[]>("write_obj_files", { path, obj, mtl, textures }),
  captureResult: (requestId: number, data: string | null, error: string | null) =>
    invoke<void>("capture_result", { requestId, data, error }),
  catalogLoad: (lang: string) => invoke<CatalogData>("catalog_load", { lang }),
  /** Collects a 3D model for the import preview (served under stageResourceUrl). */
  modelStage: (path: string) =>
    invoke<{
      id: number;
      main: string;
      sizeCm: [number, number, number] | null;
      /** Center of the model's box in cm from the zero point of its file (with `sizeCm`) */
      centerCm: [number, number, number] | null;
      /** Centimeters per unit of the file that the size and the center assume */
      unitCm: number;
      files: string[];
    }>("model_stage", { path }),
};

/** Event sent by the backend whenever the open home changed (from the UI, CLI or MCP). */
export const HOME_CHANGED_EVENT = "home-changed";

/** Event asking the frontend to capture the 3D view (live control). */
export const CAPTURE_EVENT = "capture-3d";
/** Event of the live control asking for an OBJ export ({ requestId, path }). */
export const EXPORT_OBJ_EVENT = "export-obj";
/** Event of the live control asking for a photo ({ requestId, width, height, quality, path }). */
export const RENDER_PHOTO_EVENT = "render-photo";
/** Event of the live control asking for the views of the furniture from above ({ requestId }). */
export const TOP_VIEWS_EVENT = "render-top-views";
/**
 * Event of the live control asking for a video along the camera path
 * ({ requestId, width, height, frameRate, quality, path }; null sizes use the home's settings).
 */
export const RENDER_VIDEO_EVENT = "render-video";

/** MIME type of catalog items dragged onto the plan. */
export const CATALOG_DRAG_TYPE = "application/x-msh-catalog";

/** MIME type of catalog textures dragged onto a surface of the plan. */
export const TEXTURE_DRAG_TYPE = "application/x-msh-texture";

export type TextureDragData = { catalogId: string; name: string };

export type CatalogDragData = {
  catalogId: string;
  doorOrWindow: boolean;
  /** Name as shown in the catalog (translated); used as name of the new piece */
  name: string;
  /** Size in cm, for the outline shown in the plan while dragging */
  width: number;
  depth: number;
};

/**
 * Catalog item being dragged, with its icon. Drag events tell the plan the data only on the
 * drop, so the plan reads it here to show the piece at its size while it is dragged.
 */
let catalogDrag: { data: CatalogDragData; icon: HTMLImageElement | null } | null = null;

export function setCatalogDrag(
  drag: { data: CatalogDragData; icon: HTMLImageElement | null } | null,
): void {
  catalogDrag = drag;
}

export function currentCatalogDrag(): {
  data: CatalogDragData;
  icon: HTMLImageElement | null;
} | null {
  return catalogDrag;
}

/** Base URL of the custom `msh` URI scheme (served as http://msh.localhost on Windows). */
const MSH_BASE = "http://msh.localhost";

function encodePath(path: string): string {
  return path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
}

/** URL of a resource inside an opened home (falls back to the libraries). */
export function docResourceUrl(docId: number, entry: string): string {
  return `${MSH_BASE}/doc/${docId}/${encodePath(entry)}`;
}

/** URL of a file of a model staged for the import preview. */
export function stageResourceUrl(stage: number, entry: string): string {
  return `${MSH_BASE}/stage/${stage}/${encodePath(entry)}`;
}

/** URL of a resource inside a library file. */
export function libResourceUrl(library: number, entry: string): string {
  return `${MSH_BASE}/lib/${library}/${encodePath(entry)}`;
}

/** A copy of an unsaved home written by autosave (see app/src-tauri/src/autosave.rs). */
export type RecoveryInfo = {
  key: string;
  name: string | null;
  path: string | null;
  /** Seconds since 1970 */
  savedAt: number;
};
