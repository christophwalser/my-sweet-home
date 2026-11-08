// Points of view of the 3D view: store the current view under a name, go back to it
// later or delete it. Also the "All levels" switch of the 3D view.

import { useEffect, useRef, useState } from "react";
import { poseParams, useStore, type ViewMode } from "../store";
import type { CameraPose } from "./camera";

type Props = {
  /** Camera of the 3D view right now */
  currentPose: () => { mode: ViewMode; pose: CameraPose };
  /** Opens the settings of the 3D view */
  onSettings: () => void;
};

export default function ViewpointsMenu({ currentPose, onSettings }: Props) {
  const opened = useStore((s) => s.opened);
  const run = useStore((s) => s.run);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking elsewhere
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (!opened) return null;
  const stored = opened.home.cameras.filter((c) => c.attrs.role === "storedCamera");
  const allLevels = opened.home.environment?.attrs.all_levels_visible === true;
  const hasLevels = opened.home.levels.length > 1;

  const store = () => {
    const n = name.trim();
    if (!n) return;
    const { mode, pose } = currentPose();
    void run("viewpoint_store", { name: n, mode, ...poseParams(pose) });
    setName("");
  };

  return (
    <div className="viewpoints" ref={ref}>
      <button
        type="button"
        className="view3d-button"
        onClick={() => setOpen(!open)}
        title="Store the current view or go to a stored point of view"
      >
        Points of view ▾
      </button>
      {hasLevels && (
        <label
          className="view3d-button"
          title="Show all levels, not only the selected one and the ones below"
        >
          <input
            type="checkbox"
            checked={allLevels}
            onChange={(e) =>
              void run("view3d_update", { all_levels_visible: e.currentTarget.checked })
            }
          />
          All levels
        </label>
      )}
      <button
        type="button"
        className="view3d-button"
        onClick={onSettings}
        title="Ground, sky, light, walls transparency, location of the home and the sun"
      >
        3D settings…
      </button>
      {open && (
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
              placeholder="Name of the current view"
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button type="submit" disabled={!name.trim()}>
              Store
            </button>
          </form>
          {stored.length === 0 && <p className="muted">No stored points of view</p>}
          {stored.map((c) => {
            const n = c.attrs.name ?? "";
            return (
              <div key={`${c.observer}:${n}`} className="viewpoints-item">
                <button
                  type="button"
                  className="viewpoints-go"
                  onClick={() => {
                    void run("viewpoint_go", { name: n });
                    setOpen(false);
                  }}
                  title={c.observer ? "Virtual visit" : "Aerial view"}
                >
                  <span className="viewpoints-mode">{c.observer ? "Visit" : "Aerial"}</span>
                  {n}
                </button>
                <button
                  type="button"
                  className="viewpoints-delete"
                  title="Delete this point of view"
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
