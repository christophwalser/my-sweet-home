// "Create photo" dialog of the 3D view: size, quality, progress with preview, save as PNG.

import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { PHOTO_SAMPLES, type PhotoJob, type PhotoQuality } from "./photo";

const QUALITIES: { value: PhotoQuality; label: string; hint: string }[] = [
  { value: "draft", label: "Draft", hint: "Like the 3D view with sun shadows, in seconds" },
  {
    value: "good",
    label: "Good",
    hint: `Path traced, ${PHOTO_SAMPLES.good} samples: soft shadows, indirect light, glass`,
  },
  { value: "best", label: "Best", hint: `Path traced, ${PHOTO_SAMPLES.best} samples` },
];

export default function PhotoDialog({
  viewAspect,
  baseName,
  start,
  onClose,
}: {
  /** Width / height of the 3D view, proposed for the photo */
  viewAspect: number;
  /** File name without extension proposed when saving */
  baseName: string;
  start: (
    width: number,
    height: number,
    quality: PhotoQuality,
    onProgress: (p: number) => void,
  ) => PhotoJob;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(1600);
  const [height, setHeight] = useState(Math.round(1600 / viewAspect));
  const [keepAspect, setKeepAspect] = useState(true);
  const [quality, setQuality] = useState<PhotoQuality>("good");
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
    if (keepAspect) setHeight(Math.max(16, Math.round(w / viewAspect)));
  };

  const render = () => {
    setPhoto(null);
    setMessage(null);
    setProgress(0);
    started.current = performance.now();
    const j = start(width, height, quality, setProgress);
    job.current = j;
    const box = preview.current;
    if (box) {
      box.replaceChildren(j.canvas);
    }
    j.done.then(
      (url) => {
        setPhoto(url);
        setProgress(1);
        const seconds = (performance.now() - started.current) / 1000;
        setMessage(`Rendered in ${seconds.toFixed(1)} s.`);
        job.current = null;
      },
      (e) => {
        setProgress(null);
        if (String(e).includes("cancelled")) setMessage("Cancelled.");
        else setMessage(`Rendering failed: ${String(e)}`);
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
      setMessage(`Saved to ${path}.`);
    } catch (e) {
      setMessage(`Saving failed: ${String(e)}`);
    }
  };

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog photo-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Create photo"
      >
        <header className="dialog-header">
          <h2>Create photo</h2>
          <button type="button" onClick={onClose} aria-label="Close" disabled={rendering}>
            {"✕"}
          </button>
        </header>
        <div className="export-grid">
          <label>
            Width
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
              px
            </span>
          </label>
          <label>
            Height
            <span className="export-unit">
              <input
                type="number"
                min={16}
                max={8000}
                step={10}
                value={height}
                disabled={rendering || keepAspect}
                onChange={(e) => setHeight(Number(e.currentTarget.value) || 16)}
              />
              px
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
              Proportions of the 3D view
            </span>
          </label>
        </div>
        <fieldset className="photo-quality" disabled={rendering}>
          <legend>Quality</legend>
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
          The photo shows the current view of the 3D view (aerial view or virtual visit).
        </p>
        <div className="photo-preview" ref={preview} />
        {progress !== null && (
          <progress className="photo-progress" value={progress} max={1}>
            {Math.round(progress * 100)} %
          </progress>
        )}
        {rendering && progress === 0 && quality !== "draft" && (
          <p className="muted small">Preparing the scene for path tracing…</p>
        )}
        <div className="dialog-actions">
          {!rendering && (
            <button type="button" onClick={render}>
              {photo ? "Render again" : "Render"}
            </button>
          )}
          {rendering && quality !== "draft" && (
            <button
              type="button"
              onClick={() => job.current?.finish()}
              title="Use the samples rendered so far"
            >
              Finish now
            </button>
          )}
          {rendering && (
            <button type="button" onClick={() => job.current?.cancel()}>
              Cancel
            </button>
          )}
          {photo && (
            <button type="button" onClick={() => void savePhoto()}>
              Save…
            </button>
          )}
          {message && <span className="small">{message}</span>}
        </div>
      </div>
    </div>
  );
}
