// "Create photo" panel of the 3D view: size (with presets), quality, progress with preview
// and remaining time, save as PNG or JPEG. The panel is not modal, so the 3D view can be
// moved while it is open; size and quality are remembered.

import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { syncCameras, useStore } from "../store";
import type { Lens } from "./lens";
import { PHOTO_SAMPLES, type PhotoJob, type PhotoQuality } from "./photo";
import {
  formatDuration,
  formatExtension,
  loadPhotoSettings,
  PHOTO_PRESETS,
  type PhotoFormat,
  pathForFormat,
  presetOf,
  remainingSeconds,
  savePhotoSettings,
} from "./photoPresets";
import { frames, seriesFilePath } from "./photoSeries";
import type { SunInfo } from "./View3D";

const LENSES: { value: Lens; label: string; hint: string }[] = [
  { value: "pinhole", label: t("Normal"), hint: t("Like the 3D view") },
  { value: "fisheye", label: t("Fisheye"), hint: t("180° in a circle") },
  { value: "spherical", label: t("Spherical"), hint: t("360° panorama, twice as wide as high") },
];

/** Names of the size presets. */
function presetLabel(id: string): string {
  switch (id) {
    case "hd":
      return t("HD (1280 × 720)");
    case "fullhd":
      return t("Full HD (1920 × 1080)");
    case "4k":
      return t("4K (3840 × 2160)");
    case "a4landscape":
      return t("A4 landscape at 300 dpi");
    case "a4portrait":
      return t("A4 portrait at 300 dpi");
    case "view":
      return t("Proportions of the 3D view");
    default:
      return t("Own size");
  }
}

/** A PNG data URL as JPEG (no transparency: photos have none). */
function toJpeg(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const g = canvas.getContext("2d");
      if (!g) {
        reject(new Error("no canvas"));
        return;
      }
      g.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => reject(new Error("the photo cannot be read"));
    img.src = url;
  });
}

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
  snapshot,
  onClose,
}: {
  /**
   * Picture of the 3D view as it is (data URL, "" if none), shown at once while a path
   * traced photo prepares its scene
   */
  snapshot: (width: number, height: number) => string;
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
  // Size and quality of the last photo
  const [remembered] = useState(() => loadPhotoSettings(viewAspect));
  const [width, setWidth] = useState(remembered.width);
  const [height, setHeight] = useState(remembered.height);
  const [keepAspect, setKeepAspect] = useState(remembered.keepAspect);
  const [quality, setQuality] = useState<PhotoQuality>(remembered.quality);
  const [format, setFormat] = useState<PhotoFormat>(remembered.format);
  useEffect(
    () => savePhotoSettings({ width, height, keepAspect, quality, format }),
    [width, height, keepAspect, quality, format],
  );
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
  /** Stored points of view of the home, and those chosen for a series of photos */
  const cameras = useStore((s) => s.opened?.home.cameras);
  const views = useMemo(
    () =>
      (cameras ?? [])
        .filter((c) => c.attrs.role === "storedCamera" && c.attrs.name)
        .map((c) => c.attrs.name as string),
    [cameras],
  );
  const [chosen, setChosen] = useState<string[]>([]);
  const [series, setSeries] = useState(false);
  const cancelSeries = useRef(false);
  const rendering = series || (progress !== null && photo === null);

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

  const preset = lensAspect ? "custom" : presetOf(width, height, keepAspect);
  const choosePreset = (id: string) => {
    const fixed = PHOTO_PRESETS.find((p) => p.id === id);
    if (fixed) {
      setKeepAspect(false);
      setWidth(fixed.width);
      setHeight(fixed.height);
    } else if (id === "view") {
      setKeepAspect(true);
      setHeight(Math.max(16, Math.round(width / viewAspect)));
    } else {
      setKeepAspect(false);
    }
  };

  const changeLens = (l: Lens) => {
    setLens(l);
    const aspect = l === "spherical" ? 2 : l === "fisheye" ? 1 : keepAspect ? viewAspect : null;
    if (aspect) setHeight(Math.max(16, Math.round(width / aspect)));
    void run("render_settings_update", { lens: l });
  };

  const render = async () => {
    setPhoto(null);
    setMessage(null);
    setProgress(0);
    started.current = performance.now();
    // Path tracing prepares its scene first, which takes seconds and blocks the window: the
    // view as it is now is shown meanwhile, until the first pass of the photo is there
    const waiting = quality !== "draft" && lens === "pinhole" ? snapshot(width, height) : "";
    if (waiting) {
      const img = new Image();
      img.src = waiting;
      img.alt = "";
      preview.current?.replaceChildren(img);
      await frames(2);
    }
    let shown = !waiting;
    const j = start(width, height, quality, lens, (p) => {
      if (!shown && p > 0) {
        shown = true;
        preview.current?.replaceChildren(j.canvas);
      }
      setProgress(p);
    });
    job.current = j;
    if (shown) preview.current?.replaceChildren(j.canvas);
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

  /** One photo of the current view, resolved with its PNG data URL. */
  const renderOne = (): Promise<string> => {
    setProgress(0);
    const j = start(width, height, quality, lens, setProgress);
    job.current = j;
    preview.current?.replaceChildren(j.canvas);
    return j.done.finally(() => {
      job.current = null;
    });
  };

  /**
   * Photos of the chosen points of view, saved into a folder; the 3D view goes to each point
   * of view in turn and back to where it was.
   */
  const renderSeries = async () => {
    const dir = await open({ directory: true, title: t("Folder for the photos") });
    if (typeof dir !== "string") return;
    setSeries(true);
    setPhoto(null);
    cancelSeries.current = false;
    started.current = performance.now();
    const used = new Set<string>();
    let saved = 0;
    // The view as it is now, to come back to
    await syncCameras();
    const before = (await run("camera_get")) as {
      active?: string;
      observer?: Record<string, number>;
      aerial?: Record<string, number>;
    } | null;
    try {
      for (const [i, name] of chosen.entries()) {
        if (cancelSeries.current) break;
        setMessage(t("Photo {i} of {n}: {name}", { i: i + 1, n: chosen.length, name }));
        await run("viewpoint_go", { name });
        // Let the view take the camera (and rebuild for another level) before rendering
        await frames(3);
        await new Promise((r) => setTimeout(r, 400));
        const url = await renderOne();
        await api.saveImage(
          seriesFilePath(dir, baseName, name, used, formatExtension(format)),
          format === "jpeg" ? await toJpeg(url) : url,
        );
        saved++;
      }
      const seconds = ((performance.now() - started.current) / 1000).toFixed(1);
      setMessage(t("Saved {saved} photos to {dir} in {seconds} s.", { saved, dir, seconds }));
    } catch (e) {
      setMessage(
        String(e).includes("cancelled")
          ? t("Cancelled after {saved} photos.", { saved })
          : t("Rendering failed: {v0}", { v0: String(e) }),
      );
    } finally {
      setProgress(null);
      setSeries(false);
      const mode = before?.active === "observer" ? "observer" : "aerial";
      const pose = before?.[mode];
      if (pose) await run("camera_set", { mode, ...pose, activate: true });
    }
  };

  const savePhoto = async () => {
    if (!photo) return;
    // The format is chosen in the panel: the dialog of Windows offers this one only
    const chosen = await save({
      defaultPath: `${baseName}.${formatExtension(format)}`,
      filters:
        format === "jpeg"
          ? [{ name: "JPEG image", extensions: ["jpg", "jpeg"] }]
          : [{ name: "PNG image", extensions: ["png"] }],
    });
    if (!chosen) return;
    const path = pathForFormat(chosen, format);
    try {
      await api.saveImage(path, format === "jpeg" ? await toJpeg(photo) : photo);
      setMessage(t("Saved to {path}.", { path }));
    } catch (e) {
      setMessage(t("Saving failed: {v0}", { v0: String(e) }));
    }
  };

  const left =
    rendering && progress !== null && !series
      ? remainingSeconds(performance.now() - started.current, progress)
      : null;

  return (
    <>
      <div className="video-panel photo-panel" role="dialog" aria-label={t("Create photo")}>
        <header className="dialog-header">
          <h2>{t("Create photo")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Close")} disabled={rendering}>
            {"✕"}
          </button>
        </header>
        <div className="export-grid">
          <label>
            {t("Size")}
            <select
              value={preset}
              disabled={rendering || lensAspect !== null}
              onChange={(e) => choosePreset(e.currentTarget.value)}
            >
              {["view", ...PHOTO_PRESETS.map((p) => p.id), "custom"].map((id) => (
                <option key={id} value={id}>
                  {presetLabel(id)}
                </option>
              ))}
            </select>
          </label>
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
          <label>
            {t("File format")}
            <select
              value={format}
              disabled={rendering}
              onChange={(e) => setFormat(e.currentTarget.value as PhotoFormat)}
            >
              <option value="png">{t("PNG (lossless)")}</option>
              <option value="jpeg">{t("JPEG (smaller file)")}</option>
            </select>
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
        {views.length > 0 && (
          <fieldset className="photo-quality photo-views" disabled={rendering}>
            <legend>{t("Photos of points of view")}</legend>
            {views.map((name) => (
              <label key={name}>
                <input
                  type="checkbox"
                  checked={chosen.includes(name)}
                  onChange={(e) =>
                    setChosen(
                      e.currentTarget.checked
                        ? views.filter((v) => v === name || chosen.includes(v))
                        : chosen.filter((v) => v !== name),
                    )
                  }
                />
                <span>{name}</span>
              </label>
            ))}
            <p className="muted small">
              {t(
                "Each chosen point of view gets its own photo with these settings, saved into a folder.",
              )}
            </p>
          </fieldset>
        )}
        <div className="photo-preview" ref={preview} />
        {progress !== null && (
          <progress className="photo-progress" value={progress} max={1}>
            {Math.round(progress * 100)} %
          </progress>
        )}
        {rendering && progress === 0 && quality !== "draft" && (
          <p className="muted small">{t("Preparing the scene for path tracing…")}</p>
        )}
        {left !== null && (
          <p className="muted small">{t("About {time} left", { time: formatDuration(left) })}</p>
        )}
        <div className="dialog-actions">
          {!rendering && (
            <button type="button" onClick={() => void render()}>
              {photo ? t("Render again") : t("Render")}
            </button>
          )}
          {!rendering && chosen.length > 0 && (
            <button type="button" onClick={() => void renderSeries()}>
              {t("Render {n} photos…", { n: chosen.length })}
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
            <button
              type="button"
              onClick={() => {
                cancelSeries.current = true;
                job.current?.cancel();
              }}
            >
              {t("Cancel")}
            </button>
          )}
          {photo && (
            <button type="button" onClick={() => void savePhoto()}>
              {format === "jpeg" ? t("Save as JPEG…") : t("Save as PNG…")}
            </button>
          )}
          {message && <span className="small photo-message">{message}</span>}
        </div>
      </div>
    </>
  );
}
