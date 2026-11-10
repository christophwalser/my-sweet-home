// Root of the separate 3D window: only the 3D view of the home open in the main window.

import { useEffect } from "react";
import { api } from "./api";
import ErrorBoundary from "./ErrorBoundary";
import { listenView3DActions, syncUiState } from "./layout/view3dWindow";
import { applyHome, subscribeToHomeChanges, useStore } from "./store";
import { enableDialogDragging } from "./ui/dialogDragging";
import { initTheme, useUi } from "./ui/uiStore";
import View3D from "./view3d/View3D";
import "./App.css";
import { followLanguage, t } from "./i18n";
import { followPreferences } from "./preferences";

export default function View3DWindow() {
  const opened = useStore((s) => s.opened);
  const viewMode = useStore((s) => s.viewMode);
  const selectedLevel = useStore((s) => s.selectedLevel);
  const { setViewMode, selectLevel } = useStore.getState();

  // Theme, movable dialogs and the actions of the main window's menus
  useEffect(() => {
    const stopTheme = initTheme();
    const stopPreferences = followPreferences();
    const stopLanguage = followLanguage();
    const stopDragging = enableDialogDragging();
    const stopActions = listenView3DActions((action) => {
      const ui = useUi.getState();
      if (action === "shadows") ui.setShadows(!ui.shadows);
      else ui.openDialog(action);
    });
    return () => {
      stopTheme();
      stopPreferences();
      stopLanguage();
      stopDragging();
      stopActions();
    };
  }, []);

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
        <fieldset className="segmented" aria-label={t("3D view")}>
          <button
            type="button"
            className={viewMode === "aerial" ? "active" : ""}
            onClick={() => setViewMode("aerial")}
          >
            {t("Aerial view")}
          </button>
          <button
            type="button"
            className={viewMode === "observer" ? "active" : ""}
            onClick={() => setViewMode("observer")}
          >
            {t("Virtual visit")}
          </button>
        </fieldset>
        {levels.length > 1 && (
          <label className="tool-option">
            {t("Level")}
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
        {!opened && <span className="muted">{t("No home open")}</span>}
      </header>
      <section className="view3d">
        <ErrorBoundary name={t("3D view")} resetKey={opened}>
          <View3D />
        </ErrorBoundary>
      </section>
    </div>
  );
}
