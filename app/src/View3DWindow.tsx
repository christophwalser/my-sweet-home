// Root of the separate 3D window: only the 3D view of the home open in the main window.

import { useEffect } from "react";
import { api } from "./api";
import ErrorBoundary from "./ErrorBoundary";
import { syncUiState } from "./layout/view3dWindow";
import { applyHome, subscribeToHomeChanges, useStore } from "./store";
import View3D from "./view3d/View3D";
import "./App.css";

export default function View3DWindow() {
  const opened = useStore((s) => s.opened);
  const viewMode = useStore((s) => s.viewMode);
  const selectedLevel = useStore((s) => s.selectedLevel);
  const { setViewMode, selectLevel } = useStore.getState();

  useEffect(() => {
    const unsubscribe = subscribeToHomeChanges();
    let stopSync: (() => void) | null = null;
    let alive = true;
    api
      .currentHome()
      .then((current) => {
        if (current) applyHome(current);
      })
      .catch(() => {})
      .finally(() => {
        // Take over the level and view mode of the main window
        if (alive) stopSync = syncUiState(true);
      });
    return () => {
      alive = false;
      stopSync?.();
      void unsubscribe.then((off) => off());
    };
  }, []);

  const levels = [...(opened?.home.levels ?? [])].sort(
    (a, b) =>
      a.attrs.elevation - b.attrs.elevation ||
      (a.attrs.elevation_index ?? 0) - (b.attrs.elevation_index ?? 0),
  );

  return (
    <div className="view3d-window">
      <header className="toolbar">
        <fieldset className="segmented" aria-label="3D view">
          <button
            type="button"
            className={viewMode === "aerial" ? "active" : ""}
            onClick={() => setViewMode("aerial")}
          >
            Aerial view
          </button>
          <button
            type="button"
            className={viewMode === "observer" ? "active" : ""}
            onClick={() => setViewMode("observer")}
          >
            Virtual visit
          </button>
        </fieldset>
        {levels.length > 1 && (
          <label className="tool-option">
            Level
            <select
              value={selectedLevel ?? ""}
              onChange={(e) => selectLevel(e.currentTarget.value)}
            >
              {levels.map((l) => (
                <option key={l.attrs.id} value={l.attrs.id}>
                  {l.attrs.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="spacer" />
        {!opened && <span className="muted">No home open</span>}
      </header>
      <section className="view3d">
        <ErrorBoundary name="3D view" resetKey={opened}>
          <View3D />
        </ErrorBoundary>
      </section>
    </div>
  );
}
