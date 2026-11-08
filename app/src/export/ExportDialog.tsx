// Print and export dialog: the printed home (furniture list, plans, 3D view) to the
// printer or as PDF, the plan as PDF, SVG or PNG, the furniture list as CSV and the
// 3D view as OBJ. The documents are the registry commands export_document,
// export_plan and export_furniture_csv; the 3D image and the OBJ come from the 3D view.

import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { collectTopViews } from "../plan2d/topView";
import { useStore } from "../store";
import { type PrintPages, printPages } from "./print";

type PlanFormat = "pdf" | "svg" | "png";

const SCALES = [20, 50, 100, 200, 500];
const FORMAT_FILTERS: Record<PlanFormat, { name: string; extensions: string[] }> = {
  pdf: { name: "PDF document", extensions: ["pdf"] },
  svg: { name: "SVG image", extensions: ["svg"] },
  png: { name: "PNG image", extensions: ["png"] },
};

export default function ExportDialog({
  baseName,
  hasLevels,
  onClose,
}: {
  /** File name without extension proposed in the save dialogs */
  baseName: string;
  hasLevels: boolean;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<PlanFormat>("pdf");
  const [allLevels, setAllLevels] = useState(false);
  const [paper, setPaper] = useState("a4");
  const [orientation, setOrientation] = useState("auto");
  const [scale, setScale] = useState("fit");
  const [width, setWidth] = useState(2000);
  const [separator, setSeparator] = useState(",");
  const [parts, setParts] = useState({ furniture: true, plan: true, view3d: true });
  const [furnitureIcons, setFurnitureIcons] = useState<"top_view" | "catalog">("top_view");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Escape closes the dialog wherever the focus is
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const runExport = async (
    filter: { name: string; extensions: string[] },
    action: (path: string) => Promise<string>,
  ) => {
    const path = await save({
      defaultPath: `${baseName}.${filter.extensions[0]}`,
      filters: [filter],
    });
    if (!path) return;
    setBusy(true);
    setMessage(t("Exporting…"));
    try {
      setMessage(await action(path));
    } catch (e) {
      setMessage(t("Export failed: {v0}", { v0: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  /** How furniture is drawn in plans, with the views from above rendered here if wanted. */
  const furnitureParams = async (): Promise<Record<string, unknown>> => {
    const opened = useStore.getState().opened;
    if (furnitureIcons === "catalog" || !opened) return { furniture_icons: "catalog" };
    setMessage(t("Rendering the furniture from above…"));
    return {
      furniture_icons: "top_view",
      top_views: await collectTopViews(opened.home, opened.id),
    };
  };

  /** Parameters of export_document from the dialog settings, with the 3D image if wanted. */
  const documentParams = async (): Promise<Record<string, unknown>> => {
    const params: Record<string, unknown> = {
      furniture: parts.furniture,
      plan: parts.plan,
      view_3d: parts.view3d,
      paper,
    };
    if (orientation !== "auto") params.landscape = orientation === "landscape";
    if (scale !== "fit") params.scale = Number(scale);
    if (parts.view3d) params.view_3d_image = await api.capture3d();
    if (parts.plan) Object.assign(params, await furnitureParams());
    return params;
  };
  const nothingToPrint = !parts.furniture && !parts.plan && !parts.view3d;

  const print = async () => {
    setBusy(true);
    setMessage(t("Preparing pages…"));
    try {
      const r = (await api.execute("export_document", await documentParams())) as PrintPages;
      setMessage(null);
      await printPages(r);
    } catch (e) {
      setMessage(t("Printing failed: {v0}", { v0: String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const saveDocument = () =>
    runExport({ name: "PDF document", extensions: ["pdf"] }, async (path) => {
      const r = (await api.execute("export_document", {
        ...(await documentParams()),
        path,
      })) as { pages: number };
      return t(r.pages > 1 ? "Saved {pages} pages to {path}." : "Saved 1 page to {path}.", {
        pages: r.pages,
        path,
      });
    });

  const exportPlan = () =>
    runExport(FORMAT_FILTERS[format], async (path) => {
      const params: Record<string, unknown> = { path, format };
      if (allLevels) params.level = "all";
      if (format === "pdf") {
        params.paper = paper;
        if (orientation !== "auto") params.landscape = orientation === "landscape";
        if (scale !== "fit") params.scale = Number(scale);
      }
      if (format === "png") params.width = width;
      Object.assign(params, await furnitureParams());
      setMessage(t("Exporting…"));
      const r = (await api.execute("export_plan", params)) as {
        path?: string;
        paths?: string[];
        pages?: number;
      };
      return r.pages
        ? t(r.pages > 1 ? "Saved {pages} pages to {path}." : "Saved 1 page to {path}.", {
            pages: r.pages,
            path: r.path ?? "",
          })
        : t("Saved {v0}.", { v0: r.paths?.join(", ") ?? "" });
    });

  const exportCsv = () =>
    runExport({ name: "CSV file", extensions: ["csv"] }, async (path) => {
      const r = (await api.execute("export_furniture_csv", { path, separator })) as {
        rows: number;
      };
      return t("Saved {rows} pieces to {path}.", { rows: r.rows, path });
    });

  const exportObj = () =>
    runExport({ name: "OBJ model", extensions: ["obj"] }, async (path) => {
      const r = await api.exportObj(path);
      return t("Saved {length} files (OBJ, MTL and textures) next to {path}.", {
        length: r.paths.length,
        path,
      });
    });

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("Print and export")}
      >
        <header className="dialog-header">
          <h2>{t("Print and export")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Close")} disabled={busy}>
            {"✕"}
          </button>
        </header>

        <section className="export-section">
          <h3>{t("Page setup")}</h3>
          <div className="export-grid">
            <label>
              {t("Paper")}
              <select value={paper} onChange={(e) => setPaper(e.currentTarget.value)}>
                <option value="a4">A4</option>
                <option value="a3">A3</option>
                <option value="letter">{t("Letter")}</option>
              </select>
            </label>
            <label>
              {t("Orientation")}
              <select value={orientation} onChange={(e) => setOrientation(e.currentTarget.value)}>
                <option value="auto">{t("Automatic")}</option>
                <option value="portrait">{t("Portrait")}</option>
                <option value="landscape">{t("Landscape")}</option>
              </select>
            </label>
            <label>
              {t("Furniture in plans")}
              <select
                value={furnitureIcons}
                onChange={(e) => setFurnitureIcons(e.currentTarget.value as "top_view" | "catalog")}
              >
                <option value="top_view">{t("Seen from above")}</option>
                <option value="catalog">{t("Catalog icons")}</option>
              </select>
            </label>
            <label>
              {t("Plan scale")}
              <select value={scale} onChange={(e) => setScale(e.currentTarget.value)}>
                <option value="fit">{t("Fit to page")}</option>
                {SCALES.map((s) => (
                  <option key={s} value={s}>
                    1:{s}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="export-section">
          <h3>{t("Print")}</h3>
          <div className="export-checks">
            <label>
              <input
                type="checkbox"
                checked={parts.furniture}
                onChange={(e) => setParts({ ...parts, furniture: e.currentTarget.checked })}
              />
              {t("Furniture list")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={parts.plan}
                onChange={(e) => setParts({ ...parts, plan: e.currentTarget.checked })}
              />
              {t("Plan")}
              {hasLevels ? t(" (every level)") : ""}
            </label>
            <label>
              <input
                type="checkbox"
                checked={parts.view3d}
                onChange={(e) => setParts({ ...parts, view3d: e.currentTarget.checked })}
              />
              {t("3D view")}
            </label>
          </div>
          <div className="dialog-actions">
            <button type="button" onClick={() => void print()} disabled={busy || nothingToPrint}>
              {t("Print…")}
            </button>
            <button
              type="button"
              onClick={() => void saveDocument()}
              disabled={busy || nothingToPrint}
            >
              {t("Save as PDF…")}
            </button>
          </div>
        </section>

        <section className="export-section">
          <h3>{t("Plan")}</h3>
          <div className="export-grid">
            <label>
              {t("Format")}
              <select
                value={format}
                onChange={(e) => setFormat(e.currentTarget.value as PlanFormat)}
              >
                <option value="pdf">{t("PDF (page setup above)")}</option>
                <option value="svg">{t("SVG (vector image)")}</option>
                <option value="png">{t("PNG (image)")}</option>
              </select>
            </label>
            {hasLevels && (
              <label>
                {t("Levels")}
                <select
                  value={allLevels ? "all" : "selected"}
                  onChange={(e) => setAllLevels(e.currentTarget.value === "all")}
                >
                  <option value="selected">{t("Selected level")}</option>
                  <option value="all">
                    {t("All levels")}
                    {format === "pdf" ? t(" (one page each)") : t(" (one file each)")}
                  </option>
                </select>
              </label>
            )}
            {format === "png" && (
              <label>
                {t("Width")}
                <span className="export-unit">
                  <input
                    type="number"
                    min={100}
                    max={10000}
                    step={100}
                    value={width}
                    onChange={(e) => setWidth(Number(e.currentTarget.value) || 2000)}
                  />
                  {t("px")}
                </span>
              </label>
            )}
          </div>
          <div className="dialog-actions">
            <button type="button" onClick={() => void exportPlan()} disabled={busy}>
              {t("Export plan…")}
            </button>
          </div>
        </section>

        <section className="export-section">
          <h3>{t("Furniture list")}</h3>
          <div className="export-grid">
            <label>
              {t("Separator")}
              <select value={separator} onChange={(e) => setSeparator(e.currentTarget.value)}>
                <option value=",">{t("Comma")}</option>
                <option value=";">{t("Semicolon")}</option>
                <option value={"\t"}>{t("Tab")}</option>
              </select>
            </label>
          </div>
          <p className="muted small">
            {t(
              "Columns of the furniture list, all levels; pieces inside groups are listed one by one.",
            )}
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={() => void exportCsv()} disabled={busy}>
              {t("Export CSV…")}
            </button>
          </div>
        </section>

        <section className="export-section">
          <h3>{t("3D view")}</h3>
          <p className="muted small">
            {t(
              "Walls, rooms and furniture shown in the 3D view as Wavefront OBJ with materials (MTL) and textures, in centimeters.",
            )}
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={() => void exportObj()} disabled={busy}>
              {t("Export OBJ…")}
            </button>
          </div>
        </section>

        {message && (
          <p className="small export-message" role="status">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
