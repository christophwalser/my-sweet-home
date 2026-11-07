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
  captureResult: (requestId: number, data: string | null, error: string | null) =>
    invoke<void>("capture_result", { requestId, data, error }),
  catalogLoad: (lang: string) => invoke<CatalogData>("catalog_load", { lang }),
};

/** Event sent by the backend whenever the open home changed (from the UI, CLI or MCP). */
export const HOME_CHANGED_EVENT = "home-changed";

/** Event asking the frontend to capture the 3D view (live control). */
export const CAPTURE_EVENT = "capture-3d";

/** Base URL of the custom `msh` URI scheme (served as http://msh.localhost on Windows). */
const MSH_BASE = "http://msh.localhost";

function encodePath(path: string): string {
  return path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
}

/** URL of a resource inside an opened home (falls back to the libraries). */
export function docResourceUrl(docId: number, entry: string): string {
  return `${MSH_BASE}/doc/${docId}/${encodePath(entry)}`;
}

/** URL of a resource inside a library file. */
export function libResourceUrl(library: number, entry: string): string {
  return `${MSH_BASE}/lib/${library}/${encodePath(entry)}`;
}
