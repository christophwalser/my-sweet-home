// Files dropped onto the catalog: libraries are imported, a model opens the furniture import,
// images and material packages become textures of "My textures".

import { api } from "../api";
import { t } from "../i18n";
import { useUi } from "../ui/uiStore";
import {
  extensionOf,
  LIBRARY_EXTENSIONS,
  MODEL_EXTENSIONS,
  saveDroppedFiles,
  TEXTURE_EXTENSIONS,
} from "./modelConvert";

/** Model formats in the order the main model of several dropped files is chosen. */
const MODEL_ORDER = [
  "gltf",
  "glb",
  "fbx",
  "obj",
  "dae",
  "3ds",
  "3mf",
  "kmz",
  "stl",
  "ply",
  "wrl",
  "vrml",
];

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Imports the dropped files; returns a message for the user. */
export async function importDroppedFiles(files: File[]): Promise<string> {
  if (files.length === 0) return "";
  const paths = await saveDroppedFiles(files);
  const done: string[] = [];

  // Libraries
  for (const p of paths.filter((p) => LIBRARY_EXTENSIONS.includes(extensionOf(p)))) {
    try {
      await api.execute("library_import", { path: p });
    } catch (e) {
      if (!String(e).includes("exists already")) throw e;
      if (!window.confirm(t("{v0} exists already. Replace it?", { v0: fileName(p) }))) continue;
      await api.execute("library_import", { path: p, replace: true });
    }
    done.push(fileName(p));
  }

  // One model: the furniture import (MTL and texture files dropped with it lie next to it)
  const model = MODEL_ORDER.map((ext) => paths.find((p) => extensionOf(p) === ext)).find(Boolean);
  if (model) {
    useUi.getState().openDialog("importFurniture", model);
    return done.length ? t("Imported {names}.", { names: done.join(", ") }) : "";
  }

  // ZIP files: a model inside opens the furniture import, otherwise a material package
  const textures: string[] = [];
  for (const p of paths) {
    const ext = extensionOf(p);
    if (ext === "zip") {
      const isModel = await api
        .modelStage(p)
        .then(() => true)
        .catch(() => false);
      if (isModel) {
        useUi.getState().openDialog("importFurniture", p);
        return "";
      }
      textures.push(p);
    } else if (TEXTURE_EXTENSIONS.includes(ext)) {
      textures.push(p);
    }
  }
  if (textures.length === 1 && done.length === 0) {
    useUi.getState().openDialog("importTexture", textures[0]);
    return "";
  }
  for (const p of textures) {
    await api.execute("texture_import", { path: p });
    done.push(fileName(p));
  }
  const unknown = paths.filter((p) => {
    const ext = extensionOf(p);
    return ![...LIBRARY_EXTENSIONS, ...MODEL_EXTENSIONS, ...TEXTURE_EXTENSIONS].includes(ext);
  });
  if (done.length === 0) {
    return t("These files cannot be imported: {names}", {
      names: unknown.map(fileName).join(", "),
    });
  }
  return t("Imported {names}.", { names: done.join(", ") });
}
