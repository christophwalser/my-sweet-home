// "Create photo" dialog of the 3D view: size, quality, progress with preview, save as PNG.

import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { useStore } from "../store";
import type { Lens } from "./lens";
import { PHOTO_SAMPLES, type PhotoJob, type PhotoQuality } from "./photo";
import type { SunInfo } from "./View3D";

const LENSES: { value: Lens; label: string; hint: string }[] = [
  { value: "pinhole", label: t("Normal"), hint: t("Like the 3D view") },
  { value: "fisheye", label: t("Fisheye"), hint: t("180° in a circle") },
  { value: "spherical", label: t("Spherical"), hint: t("360° panorama, twice as wide as high") },
];

const QUALITIES: { value: PhotoQuality; label: string; hint: string }[] = [
  { value: "draft", label: t("Draft"), hint: t("Like the 3D view with sun shadows, in seconds") },
  {
    value: "good",
    label: t("Good"),
    hint: t("Path traced, {good} samples: soft shadows, indirect light, glass", {
      good: PHOTO_SAMPLES.good,
    }),
  },
  {
    value: "best",
    label: t("Best"),
    hint: t("Path traced, {best} samples", { best: PHOTO_SAMPLES.best }),
  },
];

export default function PhotoDialog({
  viewAspect,
  baseName,
  sun,
  lens: initialLens,
  start,
  onClose,
}: {
  /** Sun of the home: date and time of the photo */
  sun: SunInfo | null;
  /** Lens stored in the home */
  lens: Lens;
  /** Width / height of the 3D view, proposed for the photo */
  viewAspect: number;
  /** File name without extension proposed when saving */
  baseName: string;
  start: (
    width: number,
    height: number,
    quality: PhotoQuality,
    lens: Lens,
    onProgress: (p: number) => void,
  ) => PhotoJob;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(1600);
  const [height, setHeight] = useState(Math.round(1600 / viewAspect));
  const [keepAspect, setKeepAspect] = useState(true);
  const [quality, setQuality] = useState<PhotoQuality>("good");
  const [lens, setLens] = useState<Lens>(initialLens === "normal" ? "pinhole" : initialLens);
  const run = useStore((s) => s.run);
  const ceilingLights = useStore((s) => {
    const c = s.opened?.home.environment?.attrs.ceiling_light_color;
    return c != null && (c & 0xffffff) !== 0;
  });
  /** Width / height the lens needs, or null when any size fits */
  const lensAspect = lens === "spherical" ? 2 : lens === "fisheye" ? 1 : null;
  const [progress, setProgress] = useState<number | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const job = useRef<PhotoJob | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const started = useRef(0);
  const rendering = progress !== null && photo === null;

  // Stop rendering when the dialog closes
  useEffect(() => () => job.current?.cancel(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !rendering) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, rendering]);

  const changeWidth = (w: number) => {
    setWidth(w);
    if (lensAspect) setHeight(Math.max(16, Math.round(w / lensAspect)));
    else if (keepAspect) setHeight(Math.max(16, Math.round(w / viewAspect)));
  };

  const changeLens = (l: Lens) => {
    setLens(l);
    const aspect = l === "spherical" ? 2 : l === "fisheye" ? 1 : keepAspect ? viewAspect : null;
    if (aspect) setHeight(Math.max(16, Math.round(width / aspect)));
    void run("render_settings_update", { lens: l });
  };

  const render = () => {
    setPhoto(null);
    setMessage(null);
    setProgress(0);
    started.current = performance.now();
    const j = start(width, height, quality, lens, setProgress);
    job.current = j;
    const box = preview.current;
    if (box) {
      box.replaceChildren(j.canvas);
    }
    j.done.then(
      (url) => {
        // Fisheye and spherical photos render a panorama first: show the finished photo
        const img = new Image();
        img.src = url;
        img.alt = "Photo";
        preview.current?.replaceChildren(img);
        setPhoto(url);
        setProgress(1);
        const seconds = (performance.now() - started.current) / 1000;
        setMessage(t("Rendered in {v0} s.", { v0: seconds.toFixed(1) }));
        job.current = null;
      },
      (e) => {
        setProgress(null);
        if (String(e).includes("cancelled")) setMessage(t("Cancelled."));
        else setMessage(t("Rendering failed: {v0}", { v0: String(e) }));
        job.current = null;
      },
    );
  };

  const savePhoto = async () => {
    if (!photo) return;
    const path = await save({
      defaultPath: `${baseName}.png`,
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    if (!path) return;
    try {
      await api.saveImage(path, photo);
      setMessage(t("Saved to {path}.", { path }));
    } catch (e) {
      setMessage(t("Saving failed: {v0}", { v0: String(e) }));
    }
  };

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog photo-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("Create photo")}
      >
        <header className="dialog-header">
          <h2>{t("Create photo")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Close")} disabled={rendering}>
            {"✕"}
          </button>
        </header>
        <div className="export-grid">
          <label>
            {t("Width")}
            <span className="export-unit">
              <input
                type="number"
                min={16}
                max={8000}
                step={10}
                value={width}
                disabled={rendering}
                onChange={(e) => changeWidth(Number(e.currentTarget.value) || 16)}
              />
              {t("px")}
            </span>
          </label>
          <label>
            {t("Height")}
            <span className="export-unit">
              <input
                type="number"
                min={16}
                max={8000}
                step={10}
                value={height}
                disabled={rendering || keepAspect || lensAspect !== null}
                onChange={(e) => setHeight(Number(e.currentTarget.value) || 16)}
              />
              {t("px")}
            </span>
          </label>
          <label className="photo-check">
            <span>
              <input
                type="checkbox"
                checked={keepAspect}
                disabled={rendering}
                onChange={(e) => {
                  setKeepAspect(e.currentTarget.checked);
                  if (e.currentTarget.checked) setHeight(Math.round(width / viewAspect));
                }}
              />{" "}
              {t("Proportions of the 3D view")}
            </span>
          </label>
        </div>
        <fieldset className="photo-quality" disabled={rendering}>
          <legend>{t("Lens")}</legend>
          {LENSES.map((l) => (
            <label key={l.value} title={l.hint}>
              <input
                type="radio"
                name="photo-lens"
                checked={lens === l.value}
                onChange={() => changeLens(l.value)}
              />
              <span>
                {l.label}
                <span className="muted small"> {l.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="photo-quality" disabled={rendering}>
          <legend>{t("Light")}</legend>
          <label className="photo-sun">
            <span>{t("Date and time of the sun")}</span>
            <input
              key={`date-${sun?.date}`}
              type="date"
              defaultValue={sun?.date}
              disabled={sun?.follow_clock}
              onBlur={(e) => {
                if (e.currentTarget.value && e.currentTarget.value !== sun?.date) {
                  void run("sun_update", { date: e.currentTarget.value });
                }
              }}
            />
            <input
              key={`time-${sun?.time}`}
              type="time"
              defaultValue={sun?.time}
              disabled={sun?.follow_clock}
              onBlur={(e) => {
                if (e.currentTarget.value && e.currentTarget.value !== sun?.time) {
                  void run("sun_update", { time: e.currentTarget.value });
                }
              }}
            />
          </label>
          {sun?.follow_clock && (
            <p className="muted small">{t("The sun follows the current time (3D settings).")}</p>
          )}
          <label
            title={t("A light under the ceiling of each room, so interiors are bright enough")}
          >
            <input
              type="checkbox"
              checked={ceilingLights}
              onChange={(e) =>
                void run("render_settings_update", { ceiling_lights: e.currentTarget.checked })
              }
            />
            <span>{t("Ceiling lights in the rooms")}</span>
          </label>
        </fieldset>
        <fieldset className="photo-quality" disabled={rendering}>
          <legend>{t("Quality")}</legend>
          {QUALITIES.map((q) => (
            <label key={q.value} title={q.hint}>
              <input
                type="radio"
                name="photo-quality"
                checked={quality === q.value}
                onChange={() => setQuality(q.value)}
              />
              <span>
                {q.label}
                <span className="muted small"> {q.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="muted small">
          {t("The photo shows the current view of the 3D view (aerial view or virtual visit).")}
        </p>
        <div className="photo-preview" ref={preview} />
        {progress !== null && (
          <progress className="photo-progress" value={progress} max={1}>
            {Math.round(progress * 100)} %
          </progress>
        )}
        {rendering && progress === 0 && quality !== "draft" && (
          <p className="muted small">{t("Preparing the scene for path tracing…")}</p>
        )}
        <div className="dialog-actions">
          {!rendering && (
            <button type="button" onClick={render}>
              {photo ? t("Render again") : t("Render")}
            </button>
          )}
          {rendering && quality !== "draft" && (
            <button
              type="button"
              onClick={() => job.current?.finish()}
              title={t("Use the samples rendered so far")}
            >
              {t("Finish now")}
            </button>
          )}
          {rendering && (
            <button type="button" onClick={() => job.current?.cancel()}>
              {t("Cancel")}
            </button>
          )}
          {photo && (
            <button type="button" onClick={() => void savePhoto()}>
              {t("Save…")}
            </button>
          )}
          {message && <span className="small">{message}</span>}
        </div>
      </div>
    </div>
  );
}
