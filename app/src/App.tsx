import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { type AppInfo, api } from "./api";
import CatalogPanel from "./catalog/CatalogPanel";
import PlanView from "./plan2d/PlanView";
import { useStore } from "./store";
import View3D from "./view3d/View3D";
import "./App.css";

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const opened = useStore((s) => s.opened);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const selectedLevel = useStore((s) => s.selectedLevel);
  const viewMode = useStore((s) => s.viewMode);
  const { openHome, selectLevel, setViewMode, clearError } = useStore.getState();

  useEffect(() => {
    api
      .appInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
    // Open a file passed on the command line
    api
      .startupFile()
      .then((path) => {
        if (path) void openHome(path);
      })
      .catch(() => {});
  }, [openHome]);

  const chooseFile = async () => {
    const path = await open({
      multiple: false,
      filters: [
        { name: "Sweet Home 3D", extensions: ["sh3d"] },
        { name: "Home.xml", extensions: ["xml"] },
      ],
    });
    if (typeof path === "string") await openHome(path);
  };

  const levels = [...(opened?.home.levels ?? [])].sort(
    (a, b) =>
      a.attrs.elevation - b.attrs.elevation ||
      (a.attrs.elevation_index ?? 0) - (b.attrs.elevation_index ?? 0),
  );
  const title = opened ? (opened.home.attrs.name ?? opened.path.split(/[\\/]/).pop()) : null;

  return (
    <div className="shell">
      <header className="toolbar">
        <strong className="app-name">{info?.name ?? "My Sweet Home"}</strong>
        <button type="button" onClick={chooseFile} disabled={loading}>
          {loading ? "Opening…" : "Open…"}
        </button>
        {title && <span className="doc-title">{title}</span>}
        <span className="spacer" />
        {opened && (
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
        )}
        <span className="muted version">{info ? `v${info.version}` : ""}</span>
      </header>

      {error && (
        <div className="error-bar" role="alert">
          <span>{error}</span>
          <button type="button" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}

      <aside className="catalog">
        <CatalogPanel />
      </aside>

      <main className="plan">
        {levels.length > 0 && (
          <nav className="level-tabs" aria-label="Levels">
            {levels.map((l) => (
              <button
                type="button"
                key={l.attrs.id}
                className={l.attrs.id === selectedLevel ? "active" : ""}
                onClick={() => selectLevel(l.attrs.id)}
              >
                {l.attrs.name}
              </button>
            ))}
          </nav>
        )}
        <PlanView />
        {!opened && !loading && (
          <div className="empty-hint">
            <p>Open a Sweet Home 3D project (.sh3d) to get started.</p>
            <button type="button" onClick={chooseFile}>
              Open…
            </button>
          </div>
        )}
      </main>

      <section className="view3d">
        <View3D />
      </section>
    </div>
  );
}
