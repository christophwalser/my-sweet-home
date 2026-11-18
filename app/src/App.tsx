import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { message } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { api, docResourceUrl, TOP_VIEWS_EVENT } from "./api";
import CatalogPanel from "./catalog/CatalogPanel";
import ImportFurnitureDialog from "./catalog/ImportFurnitureDialog";
import ImportTextureDialog from "./catalog/ImportTextureDialog";
import LibraryEditor from "./catalog/LibraryEditor";
import OnlineDialog from "./catalog/OnlineDialog";
import ErrorBoundary from "./ErrorBoundary";
import ExportDialog from "./export/ExportDialog";
import HelpDialog from "./help/HelpDialog";
import {
  clampSide,
  DEFAULT_LAYOUT,
  draggedSide,
  type Maximized,
  SIDE_STEP,
  useLayout,
} from "./layout/layout";
import Splitter from "./layout/Splitter";
import { closeView3DWindow, findView3DWindow, syncUiState } from "./layout/view3dWindow";
import PreferencesDialog from "./PreferencesDialog";
import BackgroundImageWizard from "./panels/BackgroundImageWizard";
import PropertiesPanel from "./panels/PropertiesPanel";
import ContextMenu from "./plan2d/ContextMenu";
import PlanView from "./plan2d/PlanView";
import StatusBar from "./plan2d/StatusBar";
import { collectTopViews } from "./plan2d/topView";
import { addRecentHome } from "./recentHomes";
import { applyHome, subscribeToHomeChanges, useStore } from "./store";
import CommandPalette from "./ui/CommandPalette";
import { chooseFile, command, detach3D, handleGlobalShortcut, runCommand } from "./ui/commands";
import { enableDialogDragging } from "./ui/dialogDragging";
import Icon, { type IconName } from "./ui/Icon";
import LevelDuplicateDialog from "./ui/LevelDuplicateDialog";
import MenuBar from "./ui/MenuBar";
import { commandItem } from "./ui/menuItems";
import { useMessages } from "./ui/messages";
import ShortcutsDialog from "./ui/ShortcutsDialog";
import ToolBar from "./ui/ToolBar";
import ToolOptions from "./ui/ToolOptions";
import TransformDialog from "./ui/TransformDialog";
import { initTheme, useUi } from "./ui/uiStore";
import { formatPrecise } from "./units";
import View3D from "./view3d/View3D";
import "./App.css";
import { errorText } from "./errorText";
import { followLanguage, formatDateTime, t } from "./i18n";
import { followPreferences, newHomeParams, usePreferences } from "./preferences";

/** Small icon button of a pane (maximize, minimize, separate window). */
function PaneButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: IconName;
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
      <Icon name={icon} size={16} />
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
      aria-label={t("Level name")}
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

/** Seconds a notice of success stays in the window (errors stay until closed). */
const NOTICE_SECONDS = 4;

export default function App() {
  const [layout, setLayout] = useLayout();
  const detached = useUi((s) => s.detached);
  const editingLevel = useUi((s) => s.editingLevel);
  const setEditingLevel = useUi((s) => s.setEditingLevel);
  const dialog = useUi((s) => s.dialog);
  const closeDialog = useUi((s) => s.closeDialog);
  const dialogArg = useUi((s) => s.dialogArg);
  const paletteOpen = useUi((s) => s.paletteOpen);
  const centerRef = useRef<HTMLDivElement>(null);
  const opened = useStore((s) => s.opened);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const notice = useStore((s) => s.notice);
  const selectedLevel = useStore((s) => s.selectedLevel);
  const tool = useStore((s) => s.tool);
  const { openHome, run, selectLevel, clearError } = useStore.getState();

  // Context menu of a level tab; the tab is selected first, so its commands act on it
  const [levelMenu, setLevelMenu] = useState<{ x: number; y: number } | null>(null);

  // An error stays until it is closed; a notice of success leaves by itself. Both go to the
  // list of messages of the status bar.
  useEffect(() => {
    if (error) useMessages.getState().add("error", error);
  }, [error]);
  useEffect(() => {
    if (!notice) return;
    useMessages.getState().add("notice", notice);
    const timer = setTimeout(() => useStore.getState().setNotice(null), NOTICE_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Size of the user interface (View menu): the zoom of the WebView, so the plan, the 3D
  // view and all texts scale together
  const uiScale = usePreferences((s) => s.uiScale);
  useEffect(() => {
    void getCurrentWebview()
      .setZoom(uiScale / 100)
      .catch(() => {});
  }, [uiScale]);

  // Preferences: changes from other windows, autosave interval, wall side colors
  const autosaveMinutes = usePreferences((s) => s.autosaveMinutes);
  const leftSideColor = usePreferences((s) => s.leftSideColor);
  const rightSideColor = usePreferences((s) => s.rightSideColor);
  useEffect(() => followPreferences(), []);
  useEffect(() => followLanguage(), []);
  useEffect(() => {
    void api.setAutosaveInterval(Math.round(autosaveMinutes * 60)).catch(() => {});
  }, [autosaveMinutes]);
  useEffect(() => {
    document.documentElement.style.setProperty("--side-left", leftSideColor);
    document.documentElement.style.setProperty("--side-right", rightSideColor);
  }, [leftSideColor, rightSideColor]);

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
        else if (!useStore.getState().opened) await run("home_new", newHomeParams());
      })
      .catch((e) => useStore.setState({ error: errorText(e) }));
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

  // Every home file opened or saved (also under another name) goes to the top of "Open recent"
  const homePath = opened?.path ?? null;
  useEffect(() => {
    if (homePath?.toLowerCase().endsWith(".sh3d")) addRecentHome(homePath);
  }, [homePath]);

  // Closing a window with unsaved changes asks whether to save them
  useEffect(() => {
    const off = getCurrentWebviewWindow().onCloseRequested(async (event) => {
      const current = useStore.getState().opened;
      if (!current?.modified) return;
      const answer = await message(
        t('Save the changes of "{v0}" before closing?', {
          v0: homeTitle(current.home.attrs.name, current.path),
        }),
        {
          title: t("My Sweet Home"),
          kind: "warning",
          buttons: { yes: t("Save"), no: t("Don't save"), cancel: t("Cancel") },
        },
      );
      if (answer === "Yes" || answer === t("Save")) {
        await useStore.getState().save();
        // Saving was cancelled or failed: keep the window
        if (useStore.getState().opened?.modified) event.preventDefault();
      } else if (!(answer === "No" || answer === t("Don't save"))) {
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
    ? (opened.home.attrs.name ?? opened.path?.split(/[\\/]/).pop() ?? t("Untitled"))
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
          "--left-width": `${layout.leftHidden ? 0 : layout.left}px`,
          "--right-width": `${layout.rightHidden ? 0 : layout.right}px`,
        } as React.CSSProperties
      }
    >
      <header className="app-header">
        <MenuBar />
        <ToolBar />
      </header>

      {dialog === "preferences" && (
        <PreferencesDialog initialTab={dialogArg ?? undefined} onClose={closeDialog} />
      )}
      {dialog === "export" && opened && (
        <ExportDialog
          baseName={(title ?? t("Home")).replace(/\.sh3d$/i, "")}
          hasLevels={levels.length > 0}
          onClose={closeDialog}
        />
      )}
      {dialog === "importFurniture" && (
        <ImportFurnitureDialog initialPath={dialogArg ?? undefined} onClose={closeDialog} />
      )}
      {dialog === "importTexture" && (
        <ImportTextureDialog initialPath={dialogArg ?? undefined} onClose={closeDialog} />
      )}
      {dialog === "libraries" && <LibraryEditor initial={dialogArg} onClose={closeDialog} />}
      {dialog === "online" && <OnlineDialog onClose={closeDialog} />}
      {(dialog === "backgroundImport" || dialog === "backgroundModify") && opened && (
        <BackgroundImageWizard
          levelId={currentLevel?.attrs.id ?? null}
          title={currentLevel?.attrs.name ?? t("Home")}
          existing={
            dialog === "backgroundModify" && background
              ? { bg: background, url: docResourceUrl(opened.id, background.image) }
              : null
          }
          onClose={closeDialog}
        />
      )}
      {dialog === "shortcuts" && <ShortcutsDialog onClose={closeDialog} />}
      {(dialog === "rotate" || dialog === "move") && (
        <TransformDialog mode={dialog} onClose={closeDialog} />
      )}
      {dialog === "duplicateLevel" && <LevelDuplicateDialog onClose={closeDialog} />}
      {dialog === "help" && <HelpDialog onClose={closeDialog} />}
      {paletteOpen && <CommandPalette />}

      {(error || notice) && (
        // Laid over the window: a message does not move the plan and the 3D view
        <div className="toasts">
          {error && (
            <div className="toast toast-error" role="alert">
              <span>{error}</span>
              <button
                type="button"
                className="error-close"
                onClick={clearError}
                title={t("Dismiss")}
                aria-label={t("Dismiss")}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <span>{notice}</span>
            </div>
          )}
        </div>
      )}

      <aside className="catalog" hidden={layout.leftHidden}>
        <CatalogPanel />
      </aside>
      <Splitter
        orientation="vertical"
        className={`splitter-left${layout.leftHidden ? " side-hidden" : ""}`}
        label={t("Width of the catalog")}
        title={
          layout.leftHidden
            ? t("Drag or press F6 to show the catalog")
            : t("Drag to resize or to hide, double-click for the default width")
        }
        onDrag={(x) => {
          const side = draggedSide(x);
          setLayout(
            side.width === null ? { leftHidden: true } : { left: side.width, leftHidden: false },
          );
        }}
        onStep={(dir) =>
          setLayout({ left: clampSide(layout.left + dir * SIDE_STEP), leftHidden: false })
        }
        onReset={() => setLayout({ left: DEFAULT_LAYOUT.left, leftHidden: false })}
      />

      <div className="center" ref={centerRef}>
        <main className="plan" style={{ flex: planFlex }}>
          {opened && (
            <div className="plan-toolbar">
              <ToolOptions tool={tool} />
              <nav className="level-tabs" aria-label={t("Levels")}>
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
                      onContextMenu={(e) => {
                        e.preventDefault();
                        selectLevel(l.attrs.id);
                        setLevelMenu({ x: e.clientX, y: e.clientY });
                      }}
                      title={
                        t("Elevation {v} · double-click to rename · right-click for more", {
                          v: formatPrecise(l.attrs.elevation),
                        }) + (l.attrs.viewable === false ? ` · ${t("hidden in 3D")}` : "")
                      }
                    >
                      {l.attrs.viewable === false && <Icon name="hidden" size={12} />}
                      {l.attrs.name}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  className="add-level"
                  title={command("level.add").hint}
                  aria-label={command("level.add").label}
                  onClick={() => runCommand(command("level.add"))}
                >
                  +
                </button>
              </nav>
              {levelMenu && (
                <ContextMenu
                  x={levelMenu.x}
                  y={levelMenu.y}
                  fixed
                  onClose={() => setLevelMenu(null)}
                  items={[
                    commandItem("level.rename"),
                    commandItem("level.duplicate"),
                    commandItem("level.addSame"),
                    { separator: true },
                    commandItem("level.moveLeft"),
                    commandItem("level.moveRight"),
                    commandItem("level.viewable"),
                    { separator: true },
                    commandItem("level.delete"),
                  ]}
                />
              )}
              <span className="pane-buttons">
                {shown !== "3d" && !detached && (
                  <PaneButton
                    label={shown === "plan" ? t("Restore the 3D view") : t("Maximize the plan")}
                    icon={shown === "plan" ? "restore" : "maximize"}
                    onClick={() => toggleMax("plan")}
                  />
                )}
                {!detached && (
                  <PaneButton
                    label={t("Minimize the plan")}
                    icon="collapseup"
                    onClick={() => setLayout({ maximized: "3d" })}
                  />
                )}
              </span>
            </div>
          )}
          <PlanView />
          {loading && (
            <div className="plan-loading" role="status">
              {t("Loading…")}
            </div>
          )}
          {opened && <StatusBar />}
          {!opened && !loading && (
            <div className="empty-hint">
              <p>{t("Open a Sweet Home 3D project (.sh3d) to get started.")}</p>
              <button type="button" onClick={() => void chooseFile()}>
                {t("Open…")}
              </button>
            </div>
          )}
        </main>

        <Splitter
          orientation="horizontal"
          className={shown ? "collapsed" : ""}
          title={detached ? undefined : t("Drag to resize, double-click for equal sizes")}
          label={t("Height of the plan")}
          onStep={
            detached || shown
              ? undefined
              : (dir) =>
                  setLayout({ split: Math.min(0.9, Math.max(0.1, layout.split + dir * 0.05)) })
          }
          onDrag={(x, y) => {
            if (!detached) dragSplit(x, y);
          }}
          onReset={() => {
            if (!detached) setLayout({ split: 0.5, maximized: null });
          }}
        >
          {detached ? (
            <>
              <span className="muted">{t("The 3D view is open in a separate window")}</span>
              <button type="button" onClick={() => void closeView3DWindow()}>
                {t("Show here")}
              </button>
            </>
          ) : shown === "plan" ? (
            <button type="button" onClick={() => setLayout({ maximized: null })}>
              {"▴"} {t("Show 3D view")}
            </button>
          ) : shown === "3d" ? (
            <button type="button" onClick={() => setLayout({ maximized: null })}>
              {"▾"} {t("Show plan")}
            </button>
          ) : null}
        </Splitter>

        <section className="view3d" style={{ flex: view3dFlex }}>
          {!detached && (
            <>
              <ErrorBoundary name={t("3D view")} resetKey={opened}>
                <View3D />
              </ErrorBoundary>
              <span className="pane-buttons view3d-buttons">
                <PaneButton
                  label={shown === "3d" ? t("Restore the plan") : t("Maximize the 3D view")}
                  icon={shown === "3d" ? "restore" : "maximize"}
                  onClick={() => toggleMax("3d")}
                />
                <PaneButton
                  label={t("Minimize the 3D view")}
                  icon="collapsedown"
                  onClick={() => setLayout({ maximized: "plan" })}
                />
                <PaneButton
                  label={t("Open the 3D view in a separate window")}
                  icon="detach"
                  onClick={detach3D}
                />
              </span>
            </>
          )}
        </section>
      </div>

      <Splitter
        orientation="vertical"
        className={`splitter-right${layout.rightHidden ? " side-hidden" : ""}`}
        label={t("Width of the properties")}
        title={
          layout.rightHidden
            ? t("Drag or press F4 to show the properties")
            : t("Drag to resize or to hide, double-click for the default width")
        }
        onDrag={(x) => {
          const side = draggedSide(window.innerWidth - x);
          setLayout(
            side.width === null ? { rightHidden: true } : { right: side.width, rightHidden: false },
          );
        }}
        onStep={(dir) =>
          setLayout({ right: clampSide(layout.right - dir * SIDE_STEP), rightHidden: false })
        }
        onReset={() => setLayout({ right: DEFAULT_LAYOUT.right, rightHidden: false })}
      />

      <aside className="inspector" hidden={layout.rightHidden}>
        <PropertiesPanel />
      </aside>
    </div>
  );
}

/**
 * Name of a home for titles: the file it is saved in (after "Save as" the new one), else the
 * name stored in the home, else t("Untitled").
 */
function homeTitle(name: string | null, path: string | null): string {
  if (path) return (path.split(/[\\/]/).pop() ?? path).replace(/\.sh3d$/i, "");
  if (name) return (name.split(/[\\/]/).pop() ?? name).replace(/\.sh3d$/i, "");
  return t("Untitled");
}

/** Offers the homes autosave kept when the app ended without saving them (a crash). */
async function offerRecovery(): Promise<void> {
  const found = await api.recoveryList();
  if (found.length === 0) return;
  const names = found
    .map((r) => `• ${homeTitle(r.name, r.path)} (${formatDateTime(new Date(r.savedAt * 1000))})`)
    .join("\n");
  const answer = await message(
    t(
      "My Sweet Home was not closed properly. These homes had unsaved changes:\n\n{names}\n\nOpen them again?",
      { names },
    ),
    {
      title: t("Recover homes"),
      kind: "info",
      buttons: { yes: t("Open"), no: t("Discard"), cancel: t("Later") },
    },
  );
  if (answer === "Yes" || answer === t("Open")) {
    // The first one in this window, the others in new windows
    const [first, ...others] = found;
    applyHome(await api.recoveryOpen(first.key));
    for (const r of others) await api.newWindow(undefined, r.key);
  } else if (answer === "No" || answer === t("Discard")) {
    await api.recoveryDiscard(found.map((r) => r.key));
  }
}
