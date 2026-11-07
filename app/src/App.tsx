import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { type AppInfo, api } from "./api";
import CatalogPanel from "./catalog/CatalogPanel";
import PropertiesPanel from "./panels/PropertiesPanel";
import PlanView from "./plan2d/PlanView";
import { applyHome, subscribeToHomeChanges, type Tool, useStore } from "./store";
import View3D from "./view3d/View3D";
import "./App.css";

const PLAN_TOOLS: { tool: Tool; label: string; hint: string }[] = [
  { tool: "select", label: "Select", hint: "Select and move (Esc). Delete: Del, rotate: R" },
  {
    tool: "wall",
    label: "Walls",
    hint: "Click to add points, double-click or Enter to finish, Alt: no magnetism",
  },
  { tool: "room", label: "Room", hint: "Click the corners, double-click or Enter to finish" },
  { tool: "dimension", label: "Dimension", hint: "Click start and end point" },
  { tool: "label", label: "Text", hint: "Click to place a text label" },
];

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const opened = useStore((s) => s.opened);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const selectedLevel = useStore((s) => s.selectedLevel);
  const viewMode = useStore((s) => s.viewMode);
  const tool = useStore((s) => s.tool);
  const { openHome, run, undo, redo, save, selectLevel, setViewMode, setTool, clearError } =
    useStore.getState();

  useEffect(() => {
    api
      .appInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
    // Changes from the UI, the CLI (--live) and the MCP server arrive as events
    const unsubscribe = subscribeToHomeChanges();
    // After a reload the backend may already have a home open
    api
      .currentHome()
      .then(async (current) => {
        if (current) {
          applyHome(current);
          return;
        }
        // Open a file passed on the command line
        const path = await api.startupFile();
        if (path) await openHome(path);
      })
      .catch(() => {});
    return () => {
      void unsubscribe.then((off) => off());
    };
  }, [openHome]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === "INPUT") return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) void undo();
      else if (key === "y" || (key === "z" && e.shiftKey)) void redo();
      else if (key === "s") void save(e.shiftKey);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, save]);

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
  const title = opened
    ? (opened.home.attrs.name ?? opened.path?.split(/[\\/]/).pop() ?? "Untitled")
    : null;

  return (
    <div className="shell">
      <header className="toolbar">
        <strong className="app-name">{info?.name ?? "My Sweet Home"}</strong>
        <button type="button" onClick={() => void run("home_new")} title="New home">
          New
        </button>
        <button type="button" onClick={chooseFile} disabled={loading}>
          {loading ? "Opening…" : "Open…"}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!opened}
          title="Save (Ctrl+S), Save as (Ctrl+Shift+S)"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => void undo()}
          disabled={!opened?.canUndo}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => void redo()}
          disabled={!opened?.canRedo}
          title="Redo (Ctrl+Y)"
        >
          Redo
        </button>
        {title && (
          <span className="doc-title" title={opened?.path ?? undefined}>
            {title}
            {opened?.modified ? " •" : ""}
          </span>
        )}
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
        {opened && (
          <div className="plan-toolbar">
            <fieldset className="segmented" aria-label="Plan tools">
              {PLAN_TOOLS.map((t) => (
                <button
                  type="button"
                  key={t.tool}
                  className={tool === t.tool ? "active" : ""}
                  onClick={() => setTool(t.tool)}
                  title={t.hint}
                >
                  {t.label}
                </button>
              ))}
            </fieldset>
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
              <button
                type="button"
                className="add-level"
                onClick={() => void run("level_add", { name: `Level ${levels.length || 1}` })}
                title="Add a level above the highest one"
              >
                + Level
              </button>
            </nav>
          </div>
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

      <aside className="inspector">
        <PropertiesPanel />
      </aside>
    </div>
  );
}
