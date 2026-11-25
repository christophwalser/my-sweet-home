// Files added to the libraries (dropped onto the catalog or chosen with "Add" in the library
// editor): library files are imported, a model opens the furniture import, images and
// material packages become textures. New items go to the library chosen in the editor.

import { api } from "../api";
import { t } from "../i18n";
import { askConfirm } from "../ui/ask";
import { type DialogName, useUi } from "../ui/uiStore";
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
  "xyz",
  "asc",
];

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** What an import did: a message for the user and the steps of the library history it took. */
export type ImportResult = { message: string; steps: number };

/** Asks whether to replace the library with the same file name. */
export function askReplaceLibrary(name: string): Promise<boolean> {
  return askConfirm({
    title: t("{v0} exists already. Replace it?", { v0: name }),
    message: t("The library with this file name and its items are replaced."),
    confirm: t("Replace"),
    danger: true,
  });
}

/** Imports the dropped files. */
export async function importDroppedFiles(files: File[]): Promise<ImportResult> {
  if (files.length === 0) return { message: "", steps: 0 };
  return importFiles(await saveDroppedFiles(files));
}

/**
 * Imports files from the disk. A dialog opened for a model or a texture returns to `returnTo`
 * when it closes.
 */
export async function importFiles(paths: string[], returnTo?: DialogName): Promise<ImportResult> {
  const done: string[] = [];
  const library = useUi.getState().libraryTarget;

  // Libraries
  for (const p of paths.filter((p) => LIBRARY_EXTENSIONS.includes(extensionOf(p)))) {
    try {
      await api.execute("library_import", { path: p });
    } catch (e) {
      if (!String(e).includes("exists already")) throw e;
      if (!(await askReplaceLibrary(fileName(p)))) continue;
      await api.execute("library_import", { path: p, replace: true });
    }
    done.push(fileName(p));
  }

  // One model: the furniture import (MTL and texture files dropped with it lie next to it)
  const model = MODEL_ORDER.map((ext) => paths.find((p) => extensionOf(p) === ext)).find(Boolean);
  if (model) {
    useUi.getState().openDialog("importFurniture", model, returnTo);
    // The import dialog takes one model: the others are named instead of dropped silently
    const others = paths.filter((p) => p !== model && MODEL_ORDER.includes(extensionOf(p)));
    const message = [
      done.length ? t("Imported {names}.", { names: done.join(", ") }) : "",
      others.length
        ? t("Only “{name}” was opened. Import the other models one after another: {names}", {
            name: fileName(model),
            names: others.map(fileName).join(", "),
          })
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    return { message, steps: done.length };
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
        useUi.getState().openDialog("importFurniture", p, returnTo);
        return { message: "", steps: done.length };
      }
      textures.push(p);
    } else if (TEXTURE_EXTENSIONS.includes(ext)) {
      textures.push(p);
    }
  }
  if (textures.length === 1 && done.length === 0) {
    useUi.getState().openDialog("importTexture", textures[0], returnTo);
    return { message: "", steps: 0 };
  }
  for (const p of textures) {
    await api.execute("texture_import", { path: p, ...(library ? { library } : {}) });
    done.push(fileName(p));
  }
  const unknown = paths.filter((p) => {
    const ext = extensionOf(p);
    return ![...LIBRARY_EXTENSIONS, ...MODEL_EXTENSIONS, ...TEXTURE_EXTENSIONS].includes(ext);
  });
  // Nothing imported and nothing unknown: the user kept the library there is
  const message =
    done.length > 0
      ? t("Imported {names}.", { names: done.join(", ") })
      : unknown.length > 0
        ? t("These files cannot be imported: {names}", {
            names: unknown.map(fileName).join(", "),
          })
        : "";
  return { message, steps: done.length };
}
