// Import of several textures at once: a table with name and tile size of each image, category
// and creator for all. The height of a tile follows from the proportions of its image.

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { errorText } from "../errorText";
import { t } from "../i18n";
import { useDialogEscape } from "../ui/dialogEscape";
import { useUi } from "../ui/uiStore";
import { formatFieldValue, parseLength, toUnit, unitSymbol, useUnit } from "../units";
import CategoryField from "./CategoryField";
import { fileStem, imagePreview } from "./imagePreview";
import { tileHeight } from "./tileSize";

type Row = {
  path: string;
  name: string;
  width: string;
  height: string;
  preview: string | null;
  /** Width by height of the image, null while or if it is not known */
  ratio: number | null;
  checked: boolean;
  error: string | null;
};

export default function ImportTexturesDialog({ onClose }: { onClose: () => void }) {
  const unit = useUnit();
  const paths = useRef(useUi.getState().importQueue);
  const start = formatFieldValue(toUnit(100, unit), unit);
  const [rows, setRows] = useState<Row[]>(() =>
    paths.current.map((path) => ({
      path,
      name: fileStem(path),
      width: start,
      height: start,
      preview: null,
      ratio: null,
      checked: true,
      error: null,
    })),
  );
  const [category, setCategory] = useState("My textures");
  const [creator, setCreator] = useState("");
  const [widthOfAll, setWidthOfAll] = useState("");
  const [keepRatio, setKeepRatio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogEscape(dialog, onClose, { guard: true, busy });

  const change = (path: string, values: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.path === path ? { ...r, ...values } : r)));

  /** The height that fits a typed width, or null if it stays as it is */
  const heightFor = (width: string, ratio: number | null): string | null => {
    const cm = parseLength(width, unit);
    if (!keepRatio || cm === null) return null;
    return formatFieldValue(toUnit(tileHeight(cm, ratio), unit), unit);
  };

  // Pictures and proportions, one after another; the URLs are released with the dialog
  // biome-ignore lint/correctness/useExhaustiveDependencies: once for the given files
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    void (async () => {
      for (const path of paths.current) {
        const image = await imagePreview(path);
        if (!image) continue;
        urls.push(image.url);
        if (!alive) {
          URL.revokeObjectURL(image.url);
          return;
        }
        setRows((list) =>
          list.map((r) =>
            r.path === path
              ? {
                  ...r,
                  preview: image.url,
                  ratio: image.ratio,
                  height: heightFor(r.width, image.ratio) ?? r.height,
                }
              : r,
          ),
        );
      }
    })();
    return () => {
      alive = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  const chosen = rows.filter((r) => r.checked);

  const doImport = async () => {
    const invalid = chosen.find((r) => {
      const w = parseLength(r.width, unit);
      const h = parseLength(r.height, unit);
      return !(w && w > 0 && h && h > 0);
    });
    if (invalid) {
      setStatus(t("“{name}”: width and height must be positive numbers.", { name: invalid.name }));
      return;
    }
    setBusy(true);
    setStatus(t("Importing…"));
    const library = useUi.getState().libraryTarget;
    const failed: string[] = [];
    for (const r of chosen) {
      try {
        const added = (await api.execute("texture_import", {
          path: r.path,
          name: r.name.trim() || fileStem(r.path),
          category: category.trim() || "My textures",
          ...(creator.trim() && { creator: creator.trim() }),
          width: parseLength(r.width, unit),
          height: parseLength(r.height, unit),
          ...(library ? { library } : {}),
        })) as { catalog_id: string };
        useUi.getState().noteImport(added.catalog_id);
      } catch (e) {
        failed.push(r.path);
        change(r.path, { error: errorText(e) });
      }
    }
    setBusy(false);
    if (failed.length === 0) {
      onClose();
      return;
    }
    // What was imported leaves the table
    setRows((list) => list.filter((r) => failed.includes(r.path) || !r.checked));
    setStatus(t("Could not be imported: {names}", { names: failed.map(fileStem).join(", ") }));
  };

  const all = chosen.length === rows.length;
  return (
    <div className="dialog-backdrop">
      <div
        ref={dialog}
        tabIndex={-1}
        className="dialog import-textures-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("Import textures")}
      >
        <header className="dialog-header">
          <h2>{t("Import {n} textures", { n: rows.length })}</h2>
          <button type="button" onClick={onClose} aria-label={t("Close")}>
            {"✕"}
          </button>
        </header>
        <div className="import-textures-common props">
          <CategoryField kind="textures" value={category} onChange={setCategory} />
          <label className="prop-row">
            <span className="prop-label">{t("Creator")}</span>
            <input
              type="text"
              value={creator}
              onChange={(e) => setCreator(e.currentTarget.value)}
            />
          </label>
          <label className="prop-row">
            <span className="prop-label">{t("Tile width of all")}</span>
            <input
              type="text"
              inputMode="decimal"
              value={widthOfAll}
              placeholder={start}
              onChange={(e) => {
                const width = e.currentTarget.value;
                setWidthOfAll(width);
                if (parseLength(width, unit) === null) return;
                setRows((list) =>
                  list.map((r) => ({ ...r, width, height: heightFor(width, r.ratio) ?? r.height })),
                );
              }}
            />
            <span className="prop-unit">{unitSymbol(unit)}</span>
          </label>
          <label className="prop-row prop-check">
            <input
              type="checkbox"
              checked={keepRatio}
              onChange={(e) => setKeepRatio(e.currentTarget.checked)}
            />
            <span>{t("Height from the proportions of the image")}</span>
          </label>
        </div>
        <div className="dialog-body">
          <table className="import-textures-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={all}
                    aria-label={t("All")}
                    onChange={() => setRows((list) => list.map((r) => ({ ...r, checked: !all })))}
                  />
                </th>
                <th />
                <th>{t("Name")}</th>
                <th>{`${t("Tile width")} (${unitSymbol(unit)})`}</th>
                <th>{`${t("Tile height")} (${unitSymbol(unit)})`}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.path} className={r.checked ? undefined : "muted"}>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.checked}
                      aria-label={r.name}
                      onChange={(e) => change(r.path, { checked: e.currentTarget.checked })}
                    />
                  </td>
                  <td>
                    {r.preview ? (
                      <img src={r.preview} alt="" />
                    ) : (
                      <span className="catalog-icon-placeholder" />
                    )}
                  </td>
                  <td>
                    <input
                      type="text"
                      value={r.name}
                      title={r.path}
                      aria-label={t("Name")}
                      onChange={(e) => change(r.path, { name: e.currentTarget.value })}
                    />
                    {r.error && <span className="small error-text">{r.error}</span>}
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={r.width}
                      aria-label={t("Tile width")}
                      onChange={(e) => {
                        const width = e.currentTarget.value;
                        change(r.path, { width, height: heightFor(width, r.ratio) ?? r.height });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={r.height}
                      aria-label={t("Tile height")}
                      onChange={(e) => change(r.path, { height: e.currentTarget.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {status && <p className="small">{status}</p>}
        <div className="dialog-actions">
          <button
            type="button"
            className="primary"
            disabled={busy || chosen.length === 0}
            onClick={() => void doImport()}
          >
            {t("Import {n} textures", { n: chosen.length })}
          </button>
          <button type="button" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
