// Points of view of the 3D view: store the current view under a name, go back to it
// later or delete it. Also the levels shown in the 3D view.

import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { poseParams, useStore, type ViewMode } from "../store";
import type { CameraPose } from "./camera";
import { LEVELS_3D_OPTIONS, levels3dMode } from "./levels3d";

type Props = {
  /** Camera of the 3D view right now */
  currentPose: () => { mode: ViewMode; pose: CameraPose };
  /** Opens the settings of the 3D view */
  onSettings: () => void;
};

export default function ViewpointsMenu({ currentPose, onSettings }: Props) {
  const opened = useStore((s) => s.opened);
  const selectedLevel = useStore((s) => s.selectedLevel);
  const run = useStore((s) => s.run);
  const [open, setOpen] = useState<"views" | "levels" | null>(null);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking elsewhere
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (!opened) return null;
  const stored = opened.home.cameras.filter((c) => c.attrs.role === "storedCamera");
  const mode = levels3dMode(opened.home);
  const hasLevels = opened.home.levels.length > 1;
  // Highest level first, like the storeys of the house
  const levels = [...opened.home.levels].sort(
    (a, b) =>
      b.attrs.elevation - a.attrs.elevation ||
      (b.attrs.elevation_index ?? 0) - (a.attrs.elevation_index ?? 0),
  );

  const store = () => {
    const n = name.trim();
    if (!n) return;
    const { mode: viewMode, pose } = currentPose();
    void run("viewpoint_store", { name: n, mode: viewMode, ...poseParams(pose) });
    setName("");
  };

  return (
    <div className="viewpoints" ref={ref}>
      <button
        type="button"
        className="view3d-button"
        aria-expanded={open === "views"}
        onClick={() => setOpen(open === "views" ? null : "views")}
        title={t("Store the current view or go to a stored point of view")}
      >
        {t("Points of view ▾")}
      </button>
      {hasLevels && (
        <button
          type="button"
          className="view3d-button"
          aria-expanded={open === "levels"}
          onClick={() => setOpen(open === "levels" ? null : "levels")}
          title={t("Levels shown in the 3D view")}
        >
          {t("Levels ▾")}
        </button>
      )}
      <button
        type="button"
        className="view3d-button"
        onClick={onSettings}
        title={t("Ground, sky, light, walls transparency, location of the home and the sun")}
      >
        {t("3D settings…")}
      </button>
      {open === "levels" && (
        <div className="viewpoints-menu levels3d-menu">
          {LEVELS_3D_OPTIONS.map(([value, label]) => (
            <label key={value} className="levels3d-row">
              <input
                type="radio"
                name="levels3d"
                checked={mode === value}
                onChange={() => void run("view3d_update", { levels: value })}
              />
              {label}
            </label>
          ))}
          <hr />
          {levels.map((l) => (
            <label
              key={l.attrs.id}
              className={`levels3d-row${l.attrs.id === selectedLevel ? " current" : ""}`}
            >
              <input
                type="checkbox"
                checked={l.attrs.viewable !== false}
                onChange={(e) =>
                  void run("level_update", { id: l.attrs.id, viewable: e.currentTarget.checked })
                }
              />
              {l.attrs.name}
            </label>
          ))}
          <p className="muted small">{t("A level without a tick is never shown in 3D.")}</p>
        </div>
      )}
      {open === "views" && (
        <div className="viewpoints-menu">
          <form
            className="viewpoints-store"
            onSubmit={(e) => {
              e.preventDefault();
              store();
            }}
          >
            <input
              value={name}
              placeholder={t("Name of the current view")}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button type="submit" disabled={!name.trim()}>
              {t("Store")}
            </button>
          </form>
          {stored.length === 0 && <p className="muted">{t("No stored points of view")}</p>}
          {stored.map((c) => {
            const n = c.attrs.name ?? "";
            return (
              <div key={`${c.observer}:${n}`} className="viewpoints-item">
                <button
                  type="button"
                  className="viewpoints-go"
                  onClick={() => {
                    void run("viewpoint_go", { name: n });
                    setOpen(null);
                  }}
                  title={c.observer ? t("Virtual visit") : t("Aerial view")}
                >
                  <span className="viewpoints-mode">{c.observer ? t("Visit") : t("Aerial")}</span>
                  {n}
                </button>
                <button
                  type="button"
                  className="viewpoints-delete"
                  title={t("Delete this point of view")}
                  onClick={() => void run("viewpoint_delete", { name: n })}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
