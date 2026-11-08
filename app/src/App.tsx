import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { message } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef } from "react";
import { api, docResourceUrl, TOP_VIEWS_EVENT } from "./api";
import CatalogPanel from "./catalog/CatalogPanel";
import ImportFurnitureDialog from "./catalog/ImportFurnitureDialog";
import LibraryDialog from "./catalog/LibraryDialog";
import ErrorBoundary from "./ErrorBoundary";
import ExportDialog from "./export/ExportDialog";
import { clampSide, DEFAULT_LAYOUT, type Maximized, useLayout } from "./layout/layout";
import Splitter from "./layout/Splitter";
import { closeView3DWindow, findView3DWindow, syncUiState } from "./layout/view3dWindow";
import PreferencesDialog from "./PreferencesDialog";
import BackgroundImageWizard from "./panels/BackgroundImageWizard";
import PropertiesPanel from "./panels/PropertiesPanel";
import PlanView from "./plan2d/PlanView";
import { collectTopViews } from "./plan2d/topView";
import { applyHome, subscribeToHomeChanges, useStore } from "./store";
import CommandPalette from "./ui/CommandPalette";
import { chooseFile, detach3D, handleGlobalShortcut } from "./ui/commands";
import { enableDialogDragging } from "./ui/dialogDragging";
import MenuBar from "./ui/MenuBar";
import ShortcutsDialog from "./ui/ShortcutsDialog";
import ToolBar from "./ui/ToolBar";
import { initTheme, useUi } from "./ui/uiStore";
import View3D from "./view3d/View3D";
import "./App.css";

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
  const [layout, setLayout] = useLayout();
  const detached = useUi((s) => s.detached);
  const editingLevel = useUi((s) => s.editingLevel);
  const setEditingLevel = useUi((s) => s.setEditingLevel);
  const dialog = useUi((s) => s.dialog);
  const closeDialog = useUi((s) => s.closeDialog);
  const paletteOpen = useUi((s) => s.paletteOpen);
  const centerRef = useRef<HTMLDivElement>(null);
  const opened = useStore((s) => s.opened);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const selectedLevel = useStore((s) => s.selectedLevel);
  const tool = useStore((s) => s.tool);
  const { openHome, run, selectLevel, clearError } = useStore.getState();

  // Theme, movable dialogs and the shortcuts of the commands
  useEffect(() => {
    const stopTheme = initTheme();
    const stopDragging = enableDialogDragging();
    window.addEventListener("keydown", handleGlobalShortcut);
    return () => {
      stopTheme();
      stopDragging();
      window.removeEventListener("keydown", handleGlobalShortcut);
    };
  }, []);

  useEffect(() => {
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
      if (win) detach3D();
    });
    return stopSync;
  }, []);

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

  const levels = [...(opened?.home.levels ?? [])].sort(
    (a, b) =>
      a.attrs.elevation - b.attrs.elevation ||
      (a.attrs.elevation_index ?? 0) - (b.attrs.elevation_index ?? 0),
  );
  const title = opened
    ? (opened.home.attrs.name ?? opened.path?.split(/[\\/]/).pop() ?? "Untitled")
    : null;
  const currentLevel = levels.find((l) => l.attrs.id === selectedLevel) ?? null;
  const background = currentLevel
    ? (currentLevel.background_image ?? null)
    : (opened?.home.background_image ?? null);

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
      <header className="app-header">
        <MenuBar />
        <ToolBar />
      </header>

      {dialog === "preferences" && <PreferencesDialog onClose={closeDialog} />}
      {dialog === "export" && opened && (
        <ExportDialog
          baseName={(title ?? "Home").replace(/\.sh3d$/i, "")}
          hasLevels={levels.length > 0}
          onClose={closeDialog}
        />
      )}
      {dialog === "importFurniture" && <ImportFurnitureDialog onClose={closeDialog} />}
      {dialog === "libraries" && <LibraryDialog onClose={closeDialog} />}
      {(dialog === "backgroundImport" || dialog === "backgroundModify") && opened && (
        <BackgroundImageWizard
          levelId={currentLevel?.attrs.id ?? null}
          title={currentLevel?.attrs.name ?? "Home"}
          existing={
            dialog === "backgroundModify" && background
              ? { bg: background, url: docResourceUrl(opened.id, background.image) }
              : null
          }
          onClose={closeDialog}
        />
      )}
      {dialog === "shortcuts" && <ShortcutsDialog onClose={closeDialog} />}
      {paletteOpen && <CommandPalette />}

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
              {(tool === "wall" || tool === "arcwall") && <WallThicknessInput />}
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
              <button type="button" onClick={() => void chooseFile()}>
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
                  onClick={detach3D}
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
