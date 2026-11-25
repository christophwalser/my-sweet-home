// Files imported into the libraries (dropped onto the catalog or chosen with "Import" in the
// library editor): library files are imported, models open the furniture import one after
// another, one image the texture import and several images a table. New items go to the library
// chosen in the editor.

import { api } from "../api";
import { t } from "../i18n";
import { askConfirm } from "../ui/ask";
import { type DialogName, useUi } from "../ui/uiStore";
import { modelQueue } from "./importQueue";
import {
  extensionOf,
  LIBRARY_EXTENSIONS,
  MODEL_EXTENSIONS,
  saveDroppedFiles,
  TEXTURE_EXTENSIONS,
} from "./modelConvert";

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
 * Imports files from the disk. A dialog opened for models or textures returns to `returnTo`
 * when it closes.
 */
export async function importFiles(paths: string[], returnTo?: DialogName): Promise<ImportResult> {
  const done: string[] = [];
  const ui = useUi.getState();

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

  // ZIP files: with a model inside they are furniture, otherwise material packages
  const zips: string[] = [];
  for (const p of paths.filter((p) => extensionOf(p) === "zip")) {
    const isModel = await api
      .modelStage(p)
      .then(() => true)
      .catch(() => false);
    if (isModel) zips.push(p);
  }

  const message = done.length > 0 ? t("Imported {names}.", { names: done.join(", ") }) : "";
  const result: ImportResult = { message, steps: done.length };

  // Models first: the images with them are mostly their textures and lie next to them
  const models = modelQueue(paths, zips);
  if (models.length > 0) {
    useUi.setState({ importQueue: models });
    ui.openDialog("importFurniture", models[0], returnTo);
    return result;
  }
  const textures = paths.filter((p) => TEXTURE_EXTENSIONS.includes(extensionOf(p)));
  if (textures.length > 0) {
    useUi.setState({ importQueue: textures });
    if (textures.length === 1) ui.openDialog("importTexture", textures[0], returnTo);
    else ui.openDialog("importTextures", undefined, returnTo);
    return result;
  }
  const known = [...LIBRARY_EXTENSIONS, ...MODEL_EXTENSIONS, ...TEXTURE_EXTENSIONS];
  const unknown = paths.filter((p) => !known.includes(extensionOf(p)));
  // Nothing imported and nothing unknown: the user kept the library there is
  if (done.length === 0 && unknown.length > 0)
    result.message = t("These files cannot be imported: {names}", {
      names: unknown.map(fileName).join(", "),
    });
  return result;
}
