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
  openHome: (path: string) => invoke<OpenedHome>("open_home", { path }),
  closeHome: (id: number) => invoke<void>("close_home", { id }),
  catalogLoad: (lang: string) => invoke<CatalogData>("catalog_load", { lang }),
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

/** URL of a resource inside a library file. */
export function libResourceUrl(library: number, entry: string): string {
  return `${MSH_BASE}/lib/${library}/${encodePath(entry)}`;
}
