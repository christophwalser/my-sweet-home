// Print and export dialog: the printed home (furniture list, plans, 3D view) to the
// printer or as PDF, the plan as PDF, SVG, PNG or DXF, the furniture list as CSV and the
// 3D view as OBJ or glTF. The documents are the registry commands export_document,
// export_plan and export_furniture_csv; the 3D image and the 3D files come from the 3D view.
// The page setup (paper up to A0, any scale, title block) shows a preview of the plan pages.

import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { api, type ObjUnit } from "../api";
import { t } from "../i18n";
import { collectTopViews } from "../plan2d/topView";
import { useStore } from "../store";
import {
  loadTitleBlock,
  PAPERS,
  pageParams,
  paperParam,
  SCALES,
  saveTitleBlock,
  scaleParam,
  type TitleBlockSetup,
} from "./pageSetup";
import { type PrintPages, printPages } from "./print";

type PlanFormat = "pdf" | "svg" | "png" | "dxf";
type ModelFormat = "obj" | "glb";

const FORMAT_FILTERS: Record<PlanFormat, { name: string; extensions: string[] }> = {
  pdf: { name: "PDF document", extensions: ["pdf"] },
  svg: { name: "SVG image", extensions: ["svg"] },
  png: { name: "PNG image", extensions: ["png"] },
  dxf: { name: "DXF drawing", extensions: ["dxf"] },
};

/** Preview of the plan pages: SVG documents, their orientation and what was noted. */
type Preview = { pages: string[]; notes: string[]; scales: number[] };

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
  const [paperChoice, setPaperChoice] = useState("a4");
  const [paperWidth, setPaperWidth] = useState(500);
  const [paperHeight, setPaperHeight] = useState(700);
  const [orientation, setOrientation] = useState("auto");
  const [scaleChoice, setScaleChoice] = useState("fit");
  const [customScale, setCustomScale] = useState("1:75");
  const [titleBlock, setTitleBlockState] = useState<TitleBlockSetup>(loadTitleBlock);
  const [width, setWidth] = useState(2000);
  const [dxfUnit, setDxfUnit] = useState("mm");
  const [modelFormat, setModelFormat] = useState<ModelFormat>("obj");
  const [objUnit, setObjUnit] = useState<ObjUnit>("cm");
  const [separator, setSeparator] = useState(",");
  const [parts, setParts] = useState({ furniture: true, plan: true, view3d: true });
  const [furnitureIcons, setFurnitureIcons] = useState<"top_view" | "catalog">("top_view");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  // Header and footer of the pages, preset from the home's page setup (Sweet Home 3D)
  const printSetup = (
    useStore.getState().opened?.home as
      | { print?: { attrs?: { header_format?: string | null; footer_format?: string | null } } }
      | undefined
  )?.print?.attrs;
  const [header, setHeader] = useState(printSetup?.header_format ?? "");
  const [footer, setFooter] = useState(printSetup?.footer_format ?? "");

  const setTitleBlock = (next: TitleBlockSetup) => {
    setTitleBlockState(next);
    saveTitleBlock(next);
  };
  const paper = paperParam(paperChoice, paperWidth, paperHeight);
  const scale = scaleParam(scaleChoice, customScale);
  const page = useMemo(
    () => pageParams({ paper, orientation, scale, titleBlock }),
    [paper, orientation, scale, titleBlock],
  );

  // Escape closes the dialog wherever the focus is
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  // Preview of the plan pages with the page setup (catalog icons: quick to draw)
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const r = (await api.execute("export_plan", {
          ...page,
          format: "pdf",
          furniture_icons: "catalog",
          ...((allLevels || parts.plan) && hasLevels && { level: "all" }),
        })) as Preview;
        if (!cancelled) setPreview(r);
      } catch {
        if (!cancelled) setPreview(null);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [page, allLevels, parts.plan, hasLevels]);

  const previewUrls = useMemo(
    () =>
      (preview?.pages ?? []).map((svg) =>
        URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
      ),
    [preview],
  );
  useEffect(
    () => () => {
      for (const url of previewUrls) URL.revokeObjectURL(url);
    },
    [previewUrls],
  );

  /** The notes of a result after its message (e.g. a plan split into several pages). */
  const withNotes = (text: string, notes: unknown): string => {
    const list = Array.isArray(notes) ? notes.filter((n) => typeof n === "string") : [];
    return list.length ? `${text} ${list.join(" ")}` : text;
  };

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
      ...page,
    };
    // Empty fields: the default footer (name and page number), no header
    params.header = header;
    if (footer.trim()) params.footer = footer;
    if (parts.view3d) params.view_3d_image = await api.capture3d();
    if (parts.plan) Object.assign(params, await furnitureParams());
    return params;
  };
  const nothingToPrint = !parts.furniture && !parts.plan && !parts.view3d;

  const print = async () => {
    setBusy(true);
    setMessage(t("Preparing pages…"));
    try {
      const r = (await api.execute("export_document", await documentParams())) as PrintPages & {
        notes?: string[];
      };
      setMessage(r.notes?.length ? r.notes.join(" ") : null);
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
      })) as { pages: number; notes?: string[] };
      return withNotes(
        t(r.pages > 1 ? "Saved {pages} pages to {path}." : "Saved 1 page to {path}.", {
          pages: r.pages,
          path,
        }),
        r.notes,
      );
    });

  const exportPlan = () =>
    runExport(FORMAT_FILTERS[format], async (path) => {
      const params: Record<string, unknown> = { path, format };
      if (allLevels) params.level = "all";
      if (format === "pdf") Object.assign(params, page);
      if (format === "png") params.width = width;
      if (format === "dxf") params.unit = dxfUnit;
      else Object.assign(params, await furnitureParams());
      setMessage(t("Exporting…"));
      const r = (await api.execute("export_plan", params)) as {
        path?: string;
        paths?: string[];
        pages?: number;
        notes?: string[];
      };
      return withNotes(
        r.pages
          ? t(r.pages > 1 ? "Saved {pages} pages to {path}." : "Saved 1 page to {path}.", {
              pages: r.pages,
              path: r.path ?? "",
            })
          : t("Saved {v0}.", { v0: r.paths?.join(", ") ?? "" }),
        r.notes,
      );
    });

  const exportCsv = () =>
    runExport({ name: "CSV file", extensions: ["csv"] }, async (path) => {
      const r = (await api.execute("export_furniture_csv", { path, separator })) as {
        rows: number;
      };
      return t("Saved {rows} pieces to {path}.", { rows: r.rows, path });
    });

  const exportModel = () =>
    runExport(
      modelFormat === "glb"
        ? { name: "glTF binary", extensions: ["glb"] }
        : { name: "OBJ model", extensions: ["obj"] },
      async (path) => {
        const r = await api.exportObj(path, modelFormat === "obj" ? objUnit : undefined);
        return modelFormat === "glb"
          ? t("Saved {v0}.", { v0: path })
          : t("Saved {length} files (OBJ, MTL and textures) next to {path}.", {
              length: r.paths.length,
              path,
            });
      },
    );

  const pageCount = preview?.pages.length ?? 0;
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
              <select value={paperChoice} onChange={(e) => setPaperChoice(e.currentTarget.value)}>
                {PAPERS.map(([value, name]) => (
                  <option key={value} value={value}>
                    {value === "letter" ? t("Letter") : name}
                  </option>
                ))}
                <option value="custom">{t("Custom size…")}</option>
              </select>
            </label>
            {paperChoice === "custom" && (
              <label>
                {t("Width × height")}
                <span className="export-unit">
                  <input
                    type="number"
                    min={50}
                    max={5000}
                    value={paperWidth}
                    aria-label={t("Paper width")}
                    onChange={(e) => setPaperWidth(Number(e.currentTarget.value))}
                  />
                  ×
                  <input
                    type="number"
                    min={50}
                    max={5000}
                    value={paperHeight}
                    aria-label={t("Paper height")}
                    onChange={(e) => setPaperHeight(Number(e.currentTarget.value))}
                  />
                  {t("mm")}
                </span>
              </label>
            )}
            <label>
              {t("Orientation")}
              <select value={orientation} onChange={(e) => setOrientation(e.currentTarget.value)}>
                <option value="auto">{t("Automatic")}</option>
                <option value="portrait">{t("Portrait")}</option>
                <option value="landscape">{t("Landscape")}</option>
              </select>
            </label>
            <label>
              {t("Plan scale")}
              <select value={scaleChoice} onChange={(e) => setScaleChoice(e.currentTarget.value)}>
                <option value="fit">{t("Fit to page")}</option>
                {SCALES.map((s) => (
                  <option key={s} value={s}>
                    1:{s}
                  </option>
                ))}
                <option value="custom">{t("Other scale…")}</option>
              </select>
            </label>
            {scaleChoice === "custom" && (
              <label>
                {t("Scale")}
                <input
                  type="text"
                  value={customScale}
                  placeholder="1:75"
                  onChange={(e) => setCustomScale(e.currentTarget.value)}
                />
              </label>
            )}
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
          </div>
          <div className="export-checks">
            <label>
              <input
                type="checkbox"
                checked={titleBlock.on}
                onChange={(e) => setTitleBlock({ ...titleBlock, on: e.currentTarget.checked })}
              />
              {t("Title block on plan pages")}
            </label>
          </div>
          {titleBlock.on && (
            <div className="export-grid">
              <label>
                {t("Project")}
                <input
                  type="text"
                  value={titleBlock.project}
                  placeholder={baseName}
                  onChange={(e) => setTitleBlock({ ...titleBlock, project: e.currentTarget.value })}
                />
              </label>
              <label>
                {t("Drawn by")}
                <input
                  type="text"
                  value={titleBlock.author}
                  onChange={(e) => setTitleBlock({ ...titleBlock, author: e.currentTarget.value })}
                />
              </label>
            </div>
          )}
          <div className="export-preview">
            {previewUrls.map((url, i) => (
              <img
                // biome-ignore lint/suspicious/noArrayIndexKey: pages have no other identity
                key={i}
                src={url}
                alt={t("Page {number}", { number: i + 1 })}
              />
            ))}
          </div>
          {preview && (
            <p className="muted small">
              {pageCount === 1 ? t("Plan: 1 page") : t("Plan: {count} pages", { count: pageCount })}
              {preview.scales.length > 0 &&
                ` · ${[...new Set(preview.scales)].map((s) => `1:${s}`).join(", ")}`}
            </p>
          )}
          {preview && preview.notes.length > 0 && (
            <p className="small export-warning" role="status">
              {t(
                "The plan does not fit on one page at this scale and is split into several pages. Choose a larger paper or a smaller scale for one page.",
              )}
            </p>
          )}
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
          <div className="export-grid">
            <label>
              {t("Header")}
              <input
                type="text"
                value={header}
                placeholder={t("e.g. $name, $date")}
                onChange={(e) => setHeader(e.currentTarget.value)}
              />
            </label>
            <label>
              {t("Footer")}
              <input
                type="text"
                value={footer}
                placeholder={t("e.g. Page $pageNumber of $pageCount")}
                onChange={(e) => setFooter(e.currentTarget.value)}
              />
            </label>
          </div>
          <p className="muted small">
            {t(
              "Header and footer may contain $pageNumber, $pageCount, $planScale, $name, $file, $date and $time. An empty footer prints the name and page number.",
            )}
          </p>
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
                <option value="dxf">{t("DXF (CAD drawing with layers)")}</option>
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
            {format === "dxf" && (
              <label>
                {t("Unit")}
                <select value={dxfUnit} onChange={(e) => setDxfUnit(e.currentTarget.value)}>
                  <option value="mm">{t("Millimeters")}</option>
                  <option value="cm">{t("Centimeters")}</option>
                  <option value="m">{t("Meters")}</option>
                </select>
              </label>
            )}
          </div>
          {format === "dxf" && (
            <p className="muted small">
              {t(
                "Walls, rooms, furniture, doors and windows, stairs, roofs, openings, dimensions, texts and lines each on a layer of their own.",
              )}
            </p>
          )}
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
          <div className="export-grid">
            <label>
              {t("Format")}
              <select
                value={modelFormat}
                onChange={(e) => setModelFormat(e.currentTarget.value as ModelFormat)}
              >
                <option value="obj">{t("OBJ (with MTL and textures)")}</option>
                <option value="glb">{t("glTF binary (.glb)")}</option>
              </select>
            </label>
            {modelFormat === "obj" && (
              <label>
                {t("Unit")}
                <select
                  value={objUnit}
                  onChange={(e) => setObjUnit(e.currentTarget.value as ObjUnit)}
                >
                  <option value="cm">{t("Centimeters")}</option>
                  <option value="mm">{t("Millimeters")}</option>
                  <option value="m">{t("Meters")}</option>
                  <option value="in">{t("Inches")}</option>
                </select>
              </label>
            )}
          </div>
          <p className="muted small">
            {modelFormat === "glb"
              ? t(
                  "Walls, rooms and furniture shown in the 3D view as one glTF file with materials and textures, in meters (for Blender, game engines and viewers).",
                )
              : t(
                  "Walls, rooms and furniture shown in the 3D view as Wavefront OBJ with materials (MTL) and textures.",
                )}
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={() => void exportModel()} disabled={busy}>
              {t("Export 3D model…")}
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
