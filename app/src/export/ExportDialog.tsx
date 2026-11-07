// Print and export dialog: the printed home (furniture list, plans, 3D view) to the
// printer or as PDF, the plan as PDF, SVG or PNG, the furniture list as CSV and the
// 3D view as OBJ. The documents are the registry commands export_document,
// export_plan and export_furniture_csv; the 3D image and the OBJ come from the 3D view.

import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api } from "../api";
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
    setMessage("Exporting…");
    try {
      setMessage(await action(path));
    } catch (e) {
      setMessage(`Export failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
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
    return params;
  };
  const nothingToPrint = !parts.furniture && !parts.plan && !parts.view3d;

  const print = async () => {
    setBusy(true);
    setMessage("Preparing pages…");
    try {
      const r = (await api.execute("export_document", await documentParams())) as PrintPages;
      setMessage(null);
      await printPages(r);
    } catch (e) {
      setMessage(`Printing failed: ${String(e)}`);
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
      return `Saved ${r.pages} page${r.pages > 1 ? "s" : ""} to ${path}.`;
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
      const r = (await api.execute("export_plan", params)) as {
        path?: string;
        paths?: string[];
        pages?: number;
      };
      return r.pages
        ? `Saved ${r.pages} page${r.pages > 1 ? "s" : ""} to ${r.path}.`
        : `Saved ${r.paths?.join(", ")}.`;
    });

  const exportCsv = () =>
    runExport({ name: "CSV file", extensions: ["csv"] }, async (path) => {
      const r = (await api.execute("export_furniture_csv", { path, separator })) as {
        rows: number;
      };
      return `Saved ${r.rows} pieces to ${path}.`;
    });

  const exportObj = () =>
    runExport({ name: "OBJ model", extensions: ["obj"] }, async (path) => {
      const r = await api.exportObj(path);
      return `Saved ${r.paths.length} files (OBJ, MTL and textures) next to ${path}.`;
    });

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Print and export"
      >
        <header className="dialog-header">
          <h2>Print and export</h2>
          <button type="button" onClick={onClose} aria-label="Close" disabled={busy}>
            {"✕"}
          </button>
        </header>

        <section className="export-section">
          <h3>Page setup</h3>
          <div className="export-grid">
            <label>
              Paper
              <select value={paper} onChange={(e) => setPaper(e.currentTarget.value)}>
                <option value="a4">A4</option>
                <option value="a3">A3</option>
                <option value="letter">Letter</option>
              </select>
            </label>
            <label>
              Orientation
              <select value={orientation} onChange={(e) => setOrientation(e.currentTarget.value)}>
                <option value="auto">Automatic</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
            <label>
              Plan scale
              <select value={scale} onChange={(e) => setScale(e.currentTarget.value)}>
                <option value="fit">Fit to page</option>
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
          <h3>Print</h3>
          <div className="export-checks">
            <label>
              <input
                type="checkbox"
                checked={parts.furniture}
                onChange={(e) => setParts({ ...parts, furniture: e.currentTarget.checked })}
              />
              Furniture list
            </label>
            <label>
              <input
                type="checkbox"
                checked={parts.plan}
                onChange={(e) => setParts({ ...parts, plan: e.currentTarget.checked })}
              />
              Plan{hasLevels ? " (every level)" : ""}
            </label>
            <label>
              <input
                type="checkbox"
                checked={parts.view3d}
                onChange={(e) => setParts({ ...parts, view3d: e.currentTarget.checked })}
              />
              3D view
            </label>
          </div>
          <div className="dialog-actions">
            <button type="button" onClick={() => void print()} disabled={busy || nothingToPrint}>
              Print…
            </button>
            <button
              type="button"
              onClick={() => void saveDocument()}
              disabled={busy || nothingToPrint}
            >
              Save as PDF…
            </button>
          </div>
        </section>

        <section className="export-section">
          <h3>Plan</h3>
          <div className="export-grid">
            <label>
              Format
              <select
                value={format}
                onChange={(e) => setFormat(e.currentTarget.value as PlanFormat)}
              >
                <option value="pdf">PDF (page setup above)</option>
                <option value="svg">SVG (vector image)</option>
                <option value="png">PNG (image)</option>
              </select>
            </label>
            {hasLevels && (
              <label>
                Levels
                <select
                  value={allLevels ? "all" : "selected"}
                  onChange={(e) => setAllLevels(e.currentTarget.value === "all")}
                >
                  <option value="selected">Selected level</option>
                  <option value="all">
                    All levels{format === "pdf" ? " (one page each)" : " (one file each)"}
                  </option>
                </select>
              </label>
            )}
            {format === "png" && (
              <label>
                Width
                <span className="export-unit">
                  <input
                    type="number"
                    min={100}
                    max={10000}
                    step={100}
                    value={width}
                    onChange={(e) => setWidth(Number(e.currentTarget.value) || 2000)}
                  />
                  px
                </span>
              </label>
            )}
          </div>
          <div className="dialog-actions">
            <button type="button" onClick={() => void exportPlan()} disabled={busy}>
              Export plan…
            </button>
          </div>
        </section>

        <section className="export-section">
          <h3>Furniture list</h3>
          <div className="export-grid">
            <label>
              Separator
              <select value={separator} onChange={(e) => setSeparator(e.currentTarget.value)}>
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
                <option value={"\t"}>Tab</option>
              </select>
            </label>
          </div>
          <p className="muted small">
            Columns of the furniture list, all levels; pieces inside groups are listed one by one.
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={() => void exportCsv()} disabled={busy}>
              Export CSV…
            </button>
          </div>
        </section>

        <section className="export-section">
          <h3>3D view</h3>
          <p className="muted small">
            Walls, rooms and furniture shown in the 3D view as Wavefront OBJ with materials (MTL)
            and textures, in centimeters.
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={() => void exportObj()} disabled={busy}>
              Export OBJ…
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
