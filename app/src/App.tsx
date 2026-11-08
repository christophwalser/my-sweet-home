import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { message, open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { type AppInfo, api, TOP_VIEWS_EVENT } from "./api";
import CatalogPanel from "./catalog/CatalogPanel";
import ErrorBoundary from "./ErrorBoundary";
import ExportDialog from "./export/ExportDialog";
import { clampSide, DEFAULT_LAYOUT, type Maximized, useLayout } from "./layout/layout";
import Splitter from "./layout/Splitter";
import {
  closeView3DWindow,
  findView3DWindow,
  openView3DWindow,
  syncUiState,
} from "./layout/view3dWindow";
import PreferencesDialog from "./PreferencesDialog";
import PropertiesPanel from "./panels/PropertiesPanel";
import PlanView from "./plan2d/PlanView";
import { collectTopViews } from "./plan2d/topView";
import { applyHome, subscribeToHomeChanges, type Tool, useStore } from "./store";
import View3D from "./view3d/View3D";
import "./App.css";

const PLAN_TOOLS: { tool: Tool; label: string; hint: string }[] = [
  {
    tool: "select",
    label: "Select",
    hint: "Select and move (Esc); drag the handles to resize or rotate. Del: delete, R: rotate, Ctrl+C/X/V: copy/cut/paste, Ctrl+D: duplicate, Ctrl+A: select all",
  },
  {
    tool: "wall",
    label: "Walls",
    hint: "Click to add points, double-click or Enter to finish, Alt: no magnetism",
  },
  {
    tool: "room",
    label: "Room",
    hint: "Double-click inside walls to create the room of that area, or click the corners and double-click / Enter to finish",
  },
  {
    tool: "polyline",
    label: "Line",
    hint: "Click to add points, click the first point to close, double-click or Enter to finish",
  },
  { tool: "dimension", label: "Dimension", hint: "Click start and end point" },
  { tool: "label", label: "Text", hint: "Click to place a text label" },
  {
    tool: "measure",
    label: "Measure",
    hint: "Click two points (or drag) to measure their distance; nothing is added to the plan",
  },
];

/** Tools that create base plan elements: choosing one unlocks the base plan, as in Sweet Home 3D. */
const BASE_PLAN_TOOLS: Tool[] = ["wall", "room", "polyline", "dimension", "label"];

/** Lock of the base plan: walls, rooms, texts, doors, windows and fixed furniture. */
function BasePlanLock() {
  const opened = useStore((s) => s.opened);
  const locked = opened?.home.attrs.base_plan_locked === true;
  return (
    <label
      className="tool-option base-plan-lock"
      title="Lock the base plan: walls, rooms, dimensions, texts, doors, windows and fixed furniture can no longer be selected in the plan, only movable furniture. Drawing walls, rooms, lines, dimensions or texts unlocks it."
    >
      <input
        type="checkbox"
        checked={locked}
        onChange={async (e) => {
          const lock = e.currentTarget.checked;
          const { run, setSelection } = useStore.getState();
          await run("home_set", { base_plan_locked: lock });
          // Locked elements leave the selection, as in Sweet Home 3D
          if (lock) setSelection([]);
        }}
      />
      Lock base plan
    </label>
  );
}

/** Thickness of the walls drawn next, shown while the wall tool is active. */
function WallThicknessInput() {
  const thickness = useStore((s) => s.wallThickness);
  const setThickness = useStore((s) => s.setWallThickness);
  return (
    <label className="tool-option" title="Thickness of new walls">
      Thickness
      <input
        type="number"
        min={1}
        step={1}
        value={thickness}
        onChange={(e) => {
          const v = Number.parseFloat(e.currentTarget.value);
          if (Number.isFinite(v) && v > 0) setThickness(v);
        }}
      />
      cm
    </label>
  );
}

/** Small icon button of a pane (maximize, minimize, separate window). */
function PaneButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="pane-button"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

/** Name of a level, edited in place in its tab. */
function LevelNameInput({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const cancelled = useRef(false);
  return (
    <input
      className="level-name-input"
      defaultValue={name}
      aria-label="Level name"
      ref={(el) => {
        if (el && document.activeElement !== el) {
          el.focus();
          el.select();
        }
      }}
      onBlur={(e) => {
        const v = e.currentTarget.value.trim();
        onDone(cancelled.current || !v || v === name ? null : v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [layout, setLayout] = useLayout();
  const [detached, setDetached] = useState(false);
  const [editingLevel, setEditingLevel] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const centerRef = useRef<HTMLDivElement>(null);
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
        // Open a file passed on the command line or chosen for this new window
        const path = await api.startupFile();
        if (path) {
          await openHome(path);
          return;
        }
        const recovery = await api.startupRecovery();
        if (recovery) {
          applyHome(await api.recoveryOpen(recovery));
          return;
        }
        // The first window offers the homes left unsaved by a crash; a new window gets an
        // empty home to work on
        if (getCurrentWebviewWindow().label === "main") await offerRecovery();
        else if (!useStore.getState().opened) await run("home_new");
      })
      .catch((e) => useStore.setState({ error: String(e) }));
    return () => {
      void unsubscribe.then((off) => off());
    };
  }, [openHome, run]);

  // Views of the furniture from above for exports from the CLI or MCP server (live control)
  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().listen<{ requestId: number }>(
      TOP_VIEWS_EVENT,
      async (e) => {
        try {
          const opened = useStore.getState().opened;
          if (!opened) throw new Error("no home is open");
          const views = await collectTopViews(opened.home, opened.id);
          await api.captureResult(e.payload.requestId, JSON.stringify(views), null);
        } catch (err) {
          await api.captureResult(e.payload.requestId, null, String(err));
        }
      },
    );
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  // The 3D window may still be open after a reload of the main window
  useEffect(() => {
    const stopSync = syncUiState(false);
    void findView3DWindow().then((win) => {
      if (win) void openView3DWindow(() => setDetached(false)).then(() => setDetached(true));
    });
    return stopSync;
  }, []);

  const detach = () => {
    setDetached(true);
    void openView3DWindow(() => setDetached(false));
  };

  /** Plan / 3D split from the pointer position on the splitter between them. */
  const dragSplit = (_x: number, y: number) => {
    const rect = centerRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    const ratio = (y - rect.top) / rect.height;
    // Dragging close to an edge collapses that pane
    const snap = 40 / rect.height;
    if (ratio > 1 - snap) setLayout({ maximized: "plan" });
    else if (ratio < snap) setLayout({ maximized: "3d" });
    else setLayout({ split: ratio, maximized: null });
  };
  const toggleMax = (pane: Exclude<Maximized, null>) =>
    setLayout({ maximized: layout.maximized === pane ? null : pane });
  const shown: Maximized = detached ? "plan" : layout.maximized;
  const planFlex = shown === "plan" ? "1 1 0" : shown === "3d" ? "0 0 0" : `${layout.split} 1 0`;
  const view3dFlex =
    shown === "3d" ? "1 1 0" : shown === "plan" ? "0 0 0" : `${1 - layout.split} 1 0`;

  // Keyboard shortcuts
  // biome-ignore lint/correctness/useExhaustiveDependencies: newHome and chooseFile read the store when called
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === "INPUT") return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) void undo();
      else if (key === "y" || (key === "z" && e.shiftKey)) void redo();
      else if (key === "s") void save(e.shiftKey);
      else if (key === "n") newHome();
      else if (key === "o") void chooseFile();
      // Ctrl+P opens the print dialog of the home (not the WebView's print of the UI)
      else if (key === "p") {
        if (useStore.getState().opened) setExporting(true);
      } else return;
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
    if (typeof path !== "string") return;
    // Like Sweet Home 3D: an untouched window takes the home, otherwise a new window opens
    if (isUntouched()) await openHome(path);
    else await api.newWindow(path);
  };

  const newHome = () => {
    if (isUntouched()) void run("home_new");
    else void api.newWindow();
  };

  // Window title: name of the home, * while it has unsaved changes
  const windowTitle = opened
    ? `${homeTitle(opened.home.attrs.name, opened.path)}${opened.modified ? " *" : ""} - My Sweet Home`
    : "My Sweet Home";
  useEffect(() => {
    void getCurrentWebviewWindow().setTitle(windowTitle);
  }, [windowTitle]);

  // Closing a window with unsaved changes asks whether to save them
  useEffect(() => {
    const off = getCurrentWebviewWindow().onCloseRequested(async (event) => {
      const current = useStore.getState().opened;
      if (!current?.modified) return;
      const answer = await message(
        `Save the changes of "${homeTitle(current.home.attrs.name, current.path)}" before closing?`,
        {
          title: "My Sweet Home",
          kind: "warning",
          buttons: { yes: "Save", no: "Don't save", cancel: "Cancel" },
        },
      );
      if (answer === "Yes" || answer === "Save") {
        await useStore.getState().save();
        // Saving was cancelled or failed: keep the window
        if (useStore.getState().opened?.modified) event.preventDefault();
      } else if (!(answer === "No" || answer === "Don't save")) {
        event.preventDefault();
      }
    });
    return () => {
      void off.then((f) => f());
    };
  }, []);

  const chooseTool = (t: Tool) => {
    setTool(t);
    if (BASE_PLAN_TOOLS.includes(t) && useStore.getState().opened?.home.attrs.base_plan_locked) {
      void run("home_set", { base_plan_locked: false });
    }
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
    <div
      className="shell"
      style={
        {
          "--left-width": `${layout.left}px`,
          "--right-width": `${layout.right}px`,
        } as React.CSSProperties
      }
    >
      <header className="toolbar">
        <strong className="app-name">{info?.name ?? "My Sweet Home"}</strong>
        <button type="button" onClick={newHome} title="New home (Ctrl+N)">
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
          onClick={() => setExporting(true)}
          disabled={!opened}
          title="Print the home or save it as PDF (Ctrl+P); export the plan (PDF, SVG, PNG), the furniture list (CSV) or the 3D view (OBJ)"
        >
          Print / Export…
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
        <button
          type="button"
          onClick={() => setPreferencesOpen(true)}
          title="Rulers, grid and magnetism"
        >
          Preferences…
        </button>
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

      {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}

      {exporting && opened && (
        <ExportDialog
          baseName={(title ?? "Home").replace(/\.sh3d$/i, "")}
          hasLevels={levels.length > 0}
          onClose={() => setExporting(false)}
        />
      )}

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
      <Splitter
        orientation="vertical"
        className="splitter-left"
        title="Drag to resize, double-click for the default width"
        onDrag={(x) => setLayout({ left: clampSide(x) })}
        onReset={() => setLayout({ left: DEFAULT_LAYOUT.left })}
      />

      <div className="center" ref={centerRef}>
        <main className="plan" style={{ flex: planFlex }}>
          {opened && (
            <div className="plan-toolbar">
              <fieldset className="segmented" aria-label="Plan tools">
                {PLAN_TOOLS.map((t) => (
                  <button
                    type="button"
                    key={t.tool}
                    className={tool === t.tool ? "active" : ""}
                    onClick={() => chooseTool(t.tool)}
                    title={t.hint}
                  >
                    {t.label}
                  </button>
                ))}
              </fieldset>
              {tool === "wall" && <WallThicknessInput />}
              {tool === "select" && <BasePlanLock />}
              <nav className="level-tabs" aria-label="Levels">
                {levels.map((l) =>
                  editingLevel === l.attrs.id ? (
                    <LevelNameInput
                      key={l.attrs.id}
                      name={l.attrs.name}
                      onDone={(name) => {
                        setEditingLevel(null);
                        if (name) void run("level_update", { id: l.attrs.id, name });
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      key={l.attrs.id}
                      className={`${l.attrs.id === selectedLevel ? "active" : ""} ${
                        l.attrs.viewable === false ? "hidden-level" : ""
                      }`}
                      onClick={() => selectLevel(l.attrs.id)}
                      onDoubleClick={() => setEditingLevel(l.attrs.id)}
                      title={`Elevation ${l.attrs.elevation} cm${
                        l.attrs.viewable === false ? " · hidden in 3D" : ""
                      } · double-click to rename · the level below is shown faded in the plan`}
                    >
                      {l.attrs.name}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  className="add-level"
                  onClick={async () => {
                    const result = (await run("level_add", {
                      name: `Level ${levels.length || 1}`,
                    })) as { id?: string } | undefined;
                    // Name the new level right away
                    if (result?.id) setEditingLevel(result.id);
                  }}
                  title="Add a level above the highest one"
                >
                  + Level
                </button>
              </nav>
              <span className="pane-buttons">
                {shown !== "3d" && !detached && (
                  <PaneButton
                    label={shown === "plan" ? "Restore the 3D view" : "Maximize the plan"}
                    icon={shown === "plan" ? "❐" : "□"}
                    onClick={() => toggleMax("plan")}
                  />
                )}
                {!detached && (
                  <PaneButton
                    label="Minimize the plan"
                    icon={"–"}
                    onClick={() => setLayout({ maximized: "3d" })}
                  />
                )}
              </span>
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

        <Splitter
          orientation="horizontal"
          className={shown ? "collapsed" : ""}
          title={detached ? undefined : "Drag to resize, double-click for equal sizes"}
          onDrag={(x, y) => {
            if (!detached) dragSplit(x, y);
          }}
          onReset={() => {
            if (!detached) setLayout({ split: 0.5, maximized: null });
          }}
        >
          {detached ? (
            <>
              <span className="muted">The 3D view is open in a separate window</span>
              <button type="button" onClick={() => void closeView3DWindow()}>
                Show here
              </button>
            </>
          ) : shown === "plan" ? (
            <button type="button" onClick={() => setLayout({ maximized: null })}>
              {"▴"} Show 3D view
            </button>
          ) : shown === "3d" ? (
            <button type="button" onClick={() => setLayout({ maximized: null })}>
              {"▾"} Show plan
            </button>
          ) : null}
        </Splitter>

        <section className="view3d" style={{ flex: view3dFlex }}>
          {!detached && (
            <>
              <ErrorBoundary name="3D view" resetKey={opened}>
                <View3D />
              </ErrorBoundary>
              <span className="pane-buttons view3d-buttons">
                <PaneButton
                  label={shown === "3d" ? "Restore the plan" : "Maximize the 3D view"}
                  icon={shown === "3d" ? "❐" : "□"}
                  onClick={() => toggleMax("3d")}
                />
                <PaneButton
                  label="Minimize the 3D view"
                  icon={"–"}
                  onClick={() => setLayout({ maximized: "plan" })}
                />
                <PaneButton
                  label="Open the 3D view in a separate window"
                  icon={"⧉"}
                  onClick={detach}
                />
              </span>
            </>
          )}
        </section>
      </div>

      <Splitter
        orientation="vertical"
        className="splitter-right"
        title="Drag to resize, double-click for the default width"
        onDrag={(x) => setLayout({ right: clampSide(window.innerWidth - x) })}
        onReset={() => setLayout({ right: DEFAULT_LAYOUT.right })}
      />

      <aside className="inspector">
        <PropertiesPanel />
      </aside>
    </div>
  );
}

/** The window shows no work yet: a new home without changes. */
function isUntouched(): boolean {
  const o = useStore.getState().opened;
  return !o || (!o.path && !o.modified && !o.canUndo);
}

/** Name of a home for titles: its name, else its file name, else "Untitled". */
function homeTitle(name: string | null, path: string | null): string {
  if (name) return name.replace(/\.sh3d$/i, "");
  if (path) return (path.split(/[\\/]/).pop() ?? path).replace(/\.sh3d$/i, "");
  return "Untitled";
}

/** Offers the homes autosave kept when the app ended without saving them (a crash). */
async function offerRecovery(): Promise<void> {
  const found = await api.recoveryList();
  if (found.length === 0) return;
  const names = found
    .map((r) => `• ${homeTitle(r.name, r.path)} (${new Date(r.savedAt * 1000).toLocaleString()})`)
    .join("\n");
  const answer = await message(
    `My Sweet Home was not closed properly. These homes had unsaved changes:\n\n${names}\n\nOpen them again?`,
    {
      title: "Recover homes",
      kind: "info",
      buttons: { yes: "Open", no: "Discard", cancel: "Later" },
    },
  );
  if (answer === "Yes" || answer === "Open") {
    // The first one in this window, the others in new windows
    const [first, ...others] = found;
    applyHome(await api.recoveryOpen(first.key));
    for (const r of others) await api.newWindow(undefined, r.key);
  } else if (answer === "No" || answer === "Discard") {
    await api.recoveryDiscard(found.map((r) => r.key));
  }
}
