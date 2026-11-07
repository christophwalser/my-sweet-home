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
};

export type CatalogItem = {
  library: number;
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
  currentHome: () => invoke<OpenedHome | null>("current_home"),
  openHome: (path: string) => invoke<OpenedHome>("open_home", { path }),
  /** Runs a command of the msh-core registry (same commands as CLI and MCP). */
  execute: (command: string, params: Record<string, unknown> = {}) =>
    invoke<unknown>("execute", { command, params }),
  /** Writes a PNG data URL to a file. */
  saveImage: (path: string, dataUrl: string) => invoke<void>("save_image", { path, dataUrl }),
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
    invoke<{ id: number; main: string; sizeCm: [number, number, number] | null; files: string[] }>(
      "model_stage",
      { path },
    ),
};

/** Event sent by the backend whenever the open home changed (from the UI, CLI or MCP). */
export const HOME_CHANGED_EVENT = "home-changed";

/** Event asking the frontend to capture the 3D view (live control). */
export const CAPTURE_EVENT = "capture-3d";
/** Event of the live control asking for an OBJ export ({ requestId, path }). */
export const EXPORT_OBJ_EVENT = "export-obj";
/** Event of the live control asking for a photo ({ requestId, width, height, quality, path }). */
export const RENDER_PHOTO_EVENT = "render-photo";

/** MIME type of catalog items dragged onto the plan. */
export const CATALOG_DRAG_TYPE = "application/x-msh-catalog";

export type CatalogDragData = {
  catalogId: string;
  doorOrWindow: boolean;
  /** Name as shown in the catalog (translated); used as name of the new piece */
  name: string;
};

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
