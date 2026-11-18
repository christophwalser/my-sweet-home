// Texture import: choose an image (JPEG, PNG, BMP, GIF, WebP, TIFF, SVG) or a PBR material
// package (ZIP), set name, category and the real size of one tile, and add it to the user's
// texture library "My textures" (shared with Sweet Home 3D).

import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api } from "../api";
import { errorText } from "../errorText";
import { t } from "../i18n";
import { useUi } from "../ui/uiStore";
import { formatFieldValue, parseLength, toUnit, unitSymbol, useUnit } from "../units";
import CategoryField from "./CategoryField";
import { extensionOf, TEXTURE_EXTENSIONS } from "./modelConvert";

/** Images the WebView shows as preview (TIFF and ZIP have none). */
const PREVIEW_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function fileStem(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "");
}

export default function ImportTextureDialog({
  initialPath,
  onClose,
}: {
  /** Image to import (e.g. dropped onto the catalog) */
  initialPath?: string;
  onClose: () => void;
}) {
  const unit = useUnit();
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("My textures");
  const [creator, setCreator] = useState("");
  const [width, setWidth] = useState(formatFieldValue(toUnit(100, unit), unit));
  const [height, setHeight] = useState(formatFieldValue(toUnit(100, unit), unit));
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (chosen: string) => {
    setPath(chosen);
    setName(fileStem(chosen));
    setStatus(null);
    const type = PREVIEW_TYPES[extensionOf(chosen)];
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    if (type) {
      try {
        const bytes = await api.readFile(chosen);
        setPreview(URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type })));
      } catch {
        // No preview, the import still works
      }
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once for the given file
  useEffect(() => {
    if (initialPath) void load(initialPath);
  }, [initialPath]);

  // The preview URL is released with the dialog
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const choose = async () => {
    const chosen = await open({
      multiple: false,
      filters: [{ name: t("Images and material packages"), extensions: TEXTURE_EXTENSIONS }],
    });
    if (typeof chosen === "string") await load(chosen);
  };

  const doImport = async () => {
    if (!path) return;
    const w = parseLength(width, unit);
    const h = parseLength(height, unit);
    if (!(w && w > 0) || !(h && h > 0)) {
      setStatus(t("Width and height must be positive numbers."));
      return;
    }
    setBusy(true);
    setStatus(t("Importing…"));
    try {
      await api.execute("texture_import", {
        path,
        name: name.trim() || fileStem(path),
        category: category.trim() || "My textures",
        ...(creator.trim() && { creator: creator.trim() }),
        width: w,
        height: h,
        ...(useUi.getState().libraryTarget ? { library: useUi.getState().libraryTarget } : {}),
      });
      onClose();
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const text = (label: string, value: string, set: (v: string) => void, suffix?: string) => (
    <label className="prop-row">
      <span className="prop-label">{label}</span>
      <input type="text" value={value} onChange={(e) => set(e.currentTarget.value)} />
      {suffix && <span className="prop-unit">{suffix}</span>}
    </label>
  );

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog import-texture-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("Import textures")}
      >
        <header className="dialog-header">
          <h2>{t("Import textures")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Close")}>
            {"✕"}
          </button>
        </header>
        <p className="muted small">
          {t(
            'JPEG, PNG, BMP, GIF, WebP, TIFF or SVG images, or a PBR material package (ZIP, its color map is used). The texture is added to your library "My textures", which Sweet Home 3D uses too. Files can also be dropped onto the catalog.',
          )}
        </p>
        <div className="import-layout">
          <div className="import-preview">
            <div className="texture-preview">
              {preview ? (
                <img src={preview} alt="" />
              ) : (
                <span className="muted small">{path ? t("No preview") : ""}</span>
              )}
            </div>
            <div className="prop-actions">
              <button type="button" onClick={() => void choose()} disabled={busy}>
                {path ? t("Choose another file…") : t("Choose file…")}
              </button>
            </div>
          </div>
          <div className="import-fields props">
            {text(t("Name"), name, setName)}
            <CategoryField kind="textures" value={category} onChange={setCategory} />
            {text(t("Creator"), creator, setCreator)}
            {text(t("Tile width"), width, setWidth, unitSymbol(unit))}
            {text(t("Tile height"), height, setHeight, unitSymbol(unit))}
            <p className="muted small">
              {t("Real size of one tile of the image on a wall or floor.")}
            </p>
            {status && <p className="small">{status}</p>}
            <div className="prop-actions">
              <button type="button" onClick={() => void doImport()} disabled={!path || busy}>
                {t("Import")}
              </button>
              <button type="button" onClick={onClose}>
                {t("Cancel")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
