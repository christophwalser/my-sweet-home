// Texture chooser of the properties panel: shows the current texture and opens a
// searchable grid of the textures of all installed libraries. "Import…" adds an
// image file as texture to the user's library "My textures" and applies it.

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import { api, type CatalogItem, docResourceUrl, libResourceUrl } from "../api";
import { TEXTURE_EXTENSIONS } from "../catalog/modelConvert";
import { t } from "../i18n";
import type { Texture } from "../model";
import { useStore } from "../store";
import Icon from "../ui/Icon";
import { useUi } from "../ui/uiStore";

/** Number of textures shown at once in the grid (keeps the panel fast). */
const MAX_SHOWN = 150;

type Props = {
  label: string;
  current: Texture | null | undefined;
  /** The selected elements have different textures */
  mixed?: boolean;
  /** Called with a catalog texture ID, or "" to remove the texture */
  onCommit: (catalogId: string) => void;
};

/** An image chosen for import, with the values of the import form. */
type PendingImport = { path: string; name: string; width: string; height: string };

function fileStem(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.[^.]+$/, "");
}

export default function TextureField({ label, current, mixed, onCommit }: Props) {
  const [open, setOpen] = useState(false);
  // Kept for the next element (e.g. the same texture for several materials or pieces)
  const query = useUi((s) => s.textureQuery);
  const setQuery = useUi((s) => s.setTextureQuery);
  const recentIds = useUi((s) => s.recentTextures);
  const noteTexture = useUi((s) => s.noteTexture);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const catalog = useStore((s) => s.catalog);
  const docId = useStore((s) => s.opened?.id);

  const recent = useMemo(
    () =>
      recentIds
        .map((id) => catalog?.items.find((item) => item.kind === "textures" && item.id === id))
        .filter((item) => item !== undefined),
    [catalog, recentIds],
  );

  const textures = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (catalog?.items ?? []).filter((item) => {
      if (item.kind !== "textures" || !item.id) return false;
      const hay = `${item.name} ${item.category} ${item.tags.join(" ")}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [catalog, query]);

  const pick = (id: string) => {
    onCommit(id);
    noteTexture(id);
    setOpen(false);
  };

  const tile = (item: CatalogItem) => (
    <button
      type="button"
      key={`${item.library}:${item.id}`}
      title={`${item.name} (${item.category})`}
      onClick={() => pick(item.id as string)}
    >
      {item.icon ? <img src={libResourceUrl(item.library, item.icon)} alt="" /> : item.name}
    </button>
  );

  const chooseImage = async () => {
    const chosen = await openDialog({
      multiple: false,
      filters: [{ name: t("Images and material packages"), extensions: TEXTURE_EXTENSIONS }],
    });
    if (typeof chosen !== "string") return;
    setError(null);
    setPending({ path: chosen, name: fileStem(chosen), width: "100", height: "100" });
  };

  const importTexture = async () => {
    if (!pending) return;
    const width = Number.parseFloat(pending.width.replace(",", "."));
    const height = Number.parseFloat(pending.height.replace(",", "."));
    if (!(width > 0) || !(height > 0)) {
      setError(t("Width and height must be positive numbers."));
      return;
    }
    try {
      const r = (await api.execute("texture_import", {
        path: pending.path,
        name: pending.name.trim() || fileStem(pending.path),
        width,
        height,
      })) as { catalog_id: string };
      setPending(null);
      pick(r.catalog_id);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="texture-field">
      <div className="prop-row">
        <span className="prop-label">{label}</span>
        <button
          type="button"
          className="texture-button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {!mixed && current && docId !== undefined && (
            <img src={docResourceUrl(docId, current.image)} alt="" />
          )}
          <span>{mixed ? "mixed" : (current?.name ?? t("None"))}</span>
        </button>
      </div>
      {open && (
        <div className="texture-picker">
          <div className="texture-picker-bar">
            <span className="search-box">
              <input
                type="text"
                placeholder={t("Search textures")}
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.stopPropagation();
                    setQuery("");
                  }
                }}
              />
              {query && (
                <button
                  type="button"
                  className="search-clear"
                  title={t("Clear the search")}
                  aria-label={t("Clear the search")}
                  onClick={() => setQuery("")}
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </span>
            <button type="button" onClick={() => pick("")} disabled={!current && !mixed}>
              {t("None")}
            </button>
            <button
              type="button"
              onClick={() => void chooseImage()}
              title={t("Import an image as texture (added to your library 'My textures')")}
            >
              {t("Import…")}
            </button>
          </div>
          {pending && (
            <div className="texture-import">
              <label className="prop-row">
                <span className="prop-label">{t("Name")}</span>
                <input
                  type="text"
                  value={pending.name}
                  onChange={(e) => setPending({ ...pending, name: e.currentTarget.value })}
                />
              </label>
              <label className="prop-row">
                <span className="prop-label">{t("Tile width")}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={pending.width}
                  onChange={(e) => setPending({ ...pending, width: e.currentTarget.value })}
                />
                <span className="prop-unit">{t("cm")}</span>
              </label>
              <label className="prop-row">
                <span className="prop-label">{t("Tile height")}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={pending.height}
                  onChange={(e) => setPending({ ...pending, height: e.currentTarget.value })}
                />
                <span className="prop-unit">{t("cm")}</span>
              </label>
              <div className="prop-actions">
                <button type="button" onClick={() => void importTexture()}>
                  {t("Import and apply")}
                </button>
                <button type="button" onClick={() => setPending(null)}>
                  {t("Cancel")}
                </button>
              </div>
            </div>
          )}
          {error && <p className="small error-text">{error}</p>}
          {!catalog && <p className="muted small">{t("Loading catalog…")}</p>}
          {recent.length > 0 && (
            <>
              <p className="muted small texture-heading">{t("Used last")}</p>
              <div className="texture-grid texture-recent">{recent.map(tile)}</div>
              <p className="muted small texture-heading">{t("All textures")}</p>
            </>
          )}
          <div className="texture-grid">{textures.slice(0, MAX_SHOWN).map(tile)}</div>
          {textures.length > MAX_SHOWN && (
            <p className="muted small">
              {textures.length - MAX_SHOWN} {t("more; refine the search to see them.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
