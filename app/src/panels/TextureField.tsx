// Texture chooser of the properties panel: shows the current texture and opens a
// searchable grid of the textures of all installed libraries. "Import…" adds an
// image file as texture to the user's library "My textures" and applies it. With a
// `target` the field also rotates, resizes and shifts the texture (texture_adjust) and takes
// the look of a surface clicked in the plan (surface_copy).

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import { api, type CatalogItem, docResourceUrl, libResourceUrl } from "../api";
import { TEXTURE_EXTENSIONS } from "../catalog/modelConvert";
import { errorText } from "../errorText";
import { t } from "../i18n";
import type { Texture } from "../model";
import type { Surface } from "../plan2d/surfaces";
import { useStore } from "../store";
import Icon from "../ui/Icon";
import { useUi } from "../ui/uiStore";
import { parseLength } from "../units";
import { Field } from "./fields";

/** Number of textures shown at once in the grid (keeps the panel fast). */
const MAX_SHOWN = 150;

/** Elements and their surface a texture field stands for. */
export type TextureTarget = { ids: string[]; surface: Surface };

type Props = {
  label: string;
  current: Texture | null | undefined;
  /** The selected elements have different textures */
  mixed?: boolean;
  /** Called with a catalog texture ID, or "" to remove the texture */
  onCommit: (catalogId: string) => void;
  /** Surface of the field: adds the pipette and the fields for angle, size and shift */
  target?: TextureTarget;
};

/** An image chosen for import, with the values of the import form. */
type PendingImport = { path: string; name: string; width: string; height: string };

function fileStem(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.[^.]+$/, "");
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Angle, size and shift of the texture of a surface. */
function AdjustFields({ texture, target }: { texture: Texture; target: TextureTarget }) {
  const run = useStore((s) => s.run);
  const adjust = (field: string, scale: number) => (v: string | number | boolean) =>
    void run("texture_adjust", { ...target, [field]: Number(v) / scale });
  return (
    <details className="texture-adjust">
      <summary>{t("Rotate, resize, shift")}</summary>
      <Field
        label={t("Angle")}
        type="number"
        unit="°"
        value={round(((texture.angle ?? 0) * 180) / Math.PI, 2)}
        onCommit={adjust("angle_deg", 1)}
      />
      <Field
        label={t("Size")}
        type="number"
        unit="%"
        value={round((texture.scale ?? 1) * 100, 1)}
        onCommit={adjust("scale", 100)}
      />
      <Field
        label={t("Shift across")}
        type="number"
        unit="%"
        value={round((texture.x_offset ?? 0) * 100, 1)}
        onCommit={adjust("x_offset", 100)}
      />
      <Field
        label={t("Shift along")}
        type="number"
        unit="%"
        value={round((texture.y_offset ?? 0) * 100, 1)}
        onCommit={adjust("y_offset", 100)}
      />
    </details>
  );
}

export default function TextureField({ label, current, mixed, onCommit, target }: Props) {
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

  /** The next click on a surface in the plan gives its color and texture to this one. */
  const pickFromPlan = () => {
    if (!target) return;
    const { ids, surface } = target;
    useStore.getState().setTool("select");
    useUi.getState().setPick({
      label: t(
        "Click a wall side, a floor or a piece of furniture to take its color and texture · Esc cancels",
      ),
      onPick: (from) =>
        void useStore
          .getState()
          .run("surface_copy", { from_id: from.id, from_surface: from.surface, ids, surface }),
    });
  };

  const tile = (item: CatalogItem) => (
    <button
      type="button"
      key={`${item.library}:${item.id}`}
      title={`${item.name} (${item.category})`}
      onClick={() => pick(item.id as string)}
    >
      {item.icon && <img src={libResourceUrl(item.library, item.icon)} alt="" />}
      <span className="texture-name">{item.name}</span>
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
    // In cm; a unit may be typed with the number ("30 cm", "12 in")
    const width = parseLength(pending.width, "cm") ?? Number.NaN;
    const height = parseLength(pending.height, "cm") ?? Number.NaN;
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
      setError(errorText(e));
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
          <span>{mixed ? t("mixed") : (current?.name ?? t("None"))}</span>
        </button>
        {target && (
          <button
            type="button"
            className="icon-button"
            title={t("Take color and texture from a surface in the plan")}
            aria-label={t("Take color and texture from a surface in the plan")}
            onClick={pickFromPlan}
          >
            <Icon name="pipette" size={14} />
          </button>
        )}
      </div>
      {target && current && !mixed && <AdjustFields texture={current} target={target} />}
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
          {catalog && textures.length === 0 && (
            <p className="muted small">{t("No texture matches the search.")}</p>
          )}
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
