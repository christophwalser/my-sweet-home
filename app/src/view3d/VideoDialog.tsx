// "Create video" panel of the 3D view: camera path (key points), video settings,
// rendering with preview and saving as MP4. The panel is not modal, so the 3D view can
// be moved to the next key point while it is open. Each key point shows what the camera
// sees there, a click goes to it, and the path is drawn in the plan while the panel is open.

import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { useStore } from "../store";
import type { CameraPose } from "./camera";
import {
  type CameraPathInfo,
  type CameraPoint,
  fromDegrees,
  VIDEO_SAMPLES,
  type Video,
  type VideoJob,
  type VideoQuality,
} from "./video";

const QUALITIES: { value: VideoQuality; label: string; hint: string }[] = [
  { value: "draft", label: t("Draft"), hint: t("Like the 3D view with sun shadows, fast") },
  {
    value: "good",
    label: t("Good"),
    hint: t("Path traced, {good} samples per frame (slow)", { good: VIDEO_SAMPLES.good }),
  },
  {
    value: "best",
    label: t("Best"),
    hint: t("Path traced, {best} samples per frame (very slow)", { best: VIDEO_SAMPLES.best }),
  },
];

const ASPECTS = ["4:3", "16:9", "24:10"] as const;
const FRAME_RATES = [12, 24, 25, 30, 50, 60];
const WIDTHS = [320, 480, 640, 960, 1280, 1920, 2560, 3840];

export default function VideoDialog({
  baseName,
  currentPose,
  thumbnails,
  start,
  onClose,
}: {
  /** Small pictures of the scene seen from the given cameras (data URLs, "" if none) */
  thumbnails: (poses: CameraPose[]) => string[];
  /** File name without extension proposed when saving */
  baseName: string;
  /** Camera of the 3D view, added as key point */
  currentPose: () => CameraPose;
  start: (
    points: CameraPoint[],
    width: number,
    height: number,
    frameRate: number,
    speed: number,
    quality: VideoQuality,
    onProgress: (frame: number, frames: number) => void,
  ) => VideoJob;
  onClose: () => void;
}) {
  const opened = useStore((s) => s.opened);
  const run = useStore((s) => s.run);
  const [info, setInfo] = useState<CameraPathInfo | null>(null);
  const [quality, setQuality] = useState<VideoQuality>("draft");
  const [progress, setProgress] = useState<{ frame: number; frames: number } | null>(null);
  const [video, setVideo] = useState<Video | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const job = useRef<VideoJob | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const started = useRef(0);
  const rendering = progress !== null && video === null;
  const [pictures, setPictures] = useState<string[]>([]);

  // The plan draws the camera path while the panel is open
  useEffect(() => {
    useStore.setState({ cameraPathShown: true });
    return () => useStore.setState({ cameraPathShown: false });
  }, []);

  // What the camera sees at each key point
  // biome-ignore lint/correctness/useExhaustiveDependencies: `thumbnails` renders the scene of the moment
  useEffect(() => {
    if (info && !rendering) setPictures(thumbnails(info.points.map(fromDegrees)));
  }, [info]);

  /** Moves the 3D view to a key point. */
  const goTo = (p: CameraPathInfo["points"][number]) => {
    const mode = useStore.getState().viewMode === "observer" ? "observer" : "aerial";
    void run("camera_set", { mode, ...p, activate: true });
  };

  // Path and settings live in the home: reload them after every change
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the home changes
  useEffect(() => {
    api.execute("camera_path_get").then(
      (v) => setInfo(v as CameraPathInfo),
      (e) => setMessage(String(e)),
    );
  }, [opened]);

  // Stop rendering when the panel closes
  useEffect(() => () => job.current?.cancel(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !rendering) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, rendering]);

  const addCurrent = () => {
    const p = currentPose();
    void run("camera_path_add", {
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      z: Math.round(p.z * 10) / 10,
      yaw: (p.yaw * 180) / Math.PI,
      pitch: (p.pitch * 180) / Math.PI,
      field_of_view: (p.fov * 180) / Math.PI,
    });
  };

  const settings = useCallback(
    (params: Record<string, unknown>) => void run("video_settings_update", params),
    [run],
  );

  const render = () => {
    if (!info) return;
    setVideo(null);
    setMessage(null);
    setProgress({ frame: 0, frames: info.video.frames });
    started.current = performance.now();
    const j = start(
      info.points.map(fromDegrees),
      info.video.width,
      info.video.height,
      info.video.frame_rate,
      info.video.speed,
      quality,
      (frame, frames) => setProgress({ frame, frames }),
    );
    job.current = j;
    preview.current?.replaceChildren(j.canvas);
    j.done.then(
      (v) => {
        setVideo(v);
        const seconds = (performance.now() - started.current) / 1000;
        setMessage(
          t("{frames} frames rendered in {v1} s.", { frames: v.frames, v1: seconds.toFixed(1) }),
        );
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

  const saveVideo = async () => {
    if (!video) return;
    const path = await save({
      defaultPath: `${baseName}.mp4`,
      filters: [{ name: "MP4 video", extensions: ["mp4"] }],
    });
    if (!path) return;
    try {
      await api.saveFile(path, video.data);
      setMessage(t("Saved to {path}.", { path }));
    } catch (e) {
      setMessage(t("Saving failed: {v0}", { v0: String(e) }));
    }
  };

  const points = info?.points ?? [];
  const stored = (info?.stored_points_of_view ?? []).filter((s) => s.name);
  const v = info?.video;

  return (
    <div className="video-panel" role="dialog" aria-label={t("Create video")}>
      <header className="dialog-header">
        <h2>{t("Create video")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Close")} disabled={rendering}>
          {"✕"}
        </button>
      </header>
      <p className="muted small">
        {t(
          "Move the 3D view to each place the video passes through and add it to the camera path. The video moves from point to point at the chosen speed.",
        )}
      </p>
      <ol className="video-points">
        {points.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: key points have no ID
          <li key={i}>
            <button
              type="button"
              className="video-point-go"
              disabled={rendering}
              onClick={() => goTo(p)}
              title={t("Move the 3D view to this point")}
            >
              {pictures[i] ? (
                <img className="viewpoints-picture" src={pictures[i]} alt="" />
              ) : (
                <span className="viewpoints-picture" />
              )}
              <span>
                x {Math.round(p.x)}, y {Math.round(p.y)}, z {Math.round(p.z)} {t("cm ·")}{" "}
                {Math.round(p.yaw)}°
              </span>
            </button>
            <button
              type="button"
              className="video-point-remove"
              disabled={rendering || i === 0}
              onClick={() => void run("camera_path_move", { index: i, to: i - 1 })}
              aria-label={t("Move point {v0} up", { v0: i + 1 })}
              title={t("Earlier in the path")}
            >
              {"▲"}
            </button>
            <button
              type="button"
              className="video-point-remove"
              disabled={rendering || i === points.length - 1}
              onClick={() => void run("camera_path_move", { index: i, to: i + 1 })}
              aria-label={t("Move point {v0} down", { v0: i + 1 })}
              title={t("Later in the path")}
            >
              {"▼"}
            </button>
            <button
              type="button"
              className="video-point-remove"
              disabled={rendering}
              onClick={() => void run("camera_path_remove", { index: i })}
              aria-label={t("Remove point {v0}", { v0: i + 1 })}
              title={t("Remove this point")}
            >
              {"✕"}
            </button>
          </li>
        ))}
        {points.length === 0 && <li className="muted small">{t("No points yet.")}</li>}
      </ol>
      <div className="video-path-actions">
        <button type="button" onClick={addCurrent} disabled={rendering}>
          {t("Add current view")}
        </button>
        {stored.length > 0 && (
          <select
            value=""
            disabled={rendering}
            onChange={(e) => {
              if (e.currentTarget.value)
                void run("camera_path_add", { stored: e.currentTarget.value });
            }}
            aria-label={t("Add a stored point of view")}
          >
            <option value="">{t("Add stored point of view…")}</option>
            {stored.map((s) => (
              <option key={s.name} value={s.name ?? ""}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => void run("camera_path_clear")}
          disabled={rendering || points.length === 0}
        >
          {t("Clear")}
        </button>
      </div>
      {v && (
        <div className="export-grid video-settings">
          <label>
            {t("Width")}
            <select
              value={v.width}
              disabled={rendering}
              onChange={(e) => settings({ width: Number(e.currentTarget.value) })}
            >
              {[...new Set([...WIDTHS, v.width])]
                .sort((a, b) => a - b)
                .map((w) => (
                  <option key={w} value={w}>
                    {w} {t("px")}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t("Aspect ratio")}
            <select
              value={v.aspect_ratio}
              disabled={rendering}
              onChange={(e) => settings({ aspect_ratio: e.currentTarget.value })}
            >
              {ASPECTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Frame rate")}
            <select
              value={v.frame_rate}
              disabled={rendering}
              onChange={(e) => settings({ frame_rate: Number(e.currentTarget.value) })}
            >
              {[...new Set([...FRAME_RATES, v.frame_rate])]
                .sort((a, b) => a - b)
                .map((f) => (
                  <option key={f} value={f}>
                    {f} {t("fps")}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t("Speed")}
            <span className="export-unit">
              <input
                key={v.speed}
                type="number"
                min={0.1}
                max={100}
                step={0.1}
                defaultValue={Math.round(v.speed * 3.6 * 10) / 10}
                disabled={rendering}
                onBlur={(e) => {
                  const kmh = Number(e.currentTarget.value);
                  if (kmh > 0 && Math.abs(kmh / 3.6 - v.speed) > 1e-3)
                    settings({ speed: kmh / 3.6 });
                }}
              />
              {t("km/h")}
            </span>
          </label>
        </div>
      )}
      <fieldset className="photo-quality" disabled={rendering}>
        <legend>{t("Quality")}</legend>
        {QUALITIES.map((q) => (
          <label key={q.value} title={q.hint}>
            <input
              type="radio"
              name="video-quality"
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
      {v && (
        <p className="small">
          {v.width} × {v.height} {t("px ·")} {v.frames} {t("frames ·")}{" "}
          {v.duration_seconds.toFixed(1)} s
        </p>
      )}
      <div className="photo-preview" ref={preview} />
      {progress && (
        <progress className="photo-progress" value={progress.frame} max={progress.frames || 1}>
          {progress.frame} / {progress.frames}
        </progress>
      )}
      {rendering && progress && (
        <p className="muted small">
          {progress.frame === 0 && quality !== "draft"
            ? t("Preparing the scene for path tracing…")
            : t("Frame {frame} of {frames}", { frame: progress.frame, frames: progress.frames })}
        </p>
      )}
      <div className="dialog-actions">
        {!rendering && (
          <button type="button" onClick={render} disabled={points.length < 2}>
            {video ? t("Create again") : t("Create")}
          </button>
        )}
        {rendering && (
          <button type="button" onClick={() => job.current?.cancel()}>
            {t("Cancel")}
          </button>
        )}
        {video && (
          <button type="button" onClick={() => void saveVideo()}>
            {t("Save…")}
          </button>
        )}
        {message && <span className="small">{message}</span>}
        {!rendering && points.length < 2 && (
          <span className="muted small">{t("At least two points are needed.")}</span>
        )}
      </div>
    </div>
  );
}
