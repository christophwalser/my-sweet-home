// UI commands: one definition per user action, shared by the menu bar, the tool bar, the
// keyboard shortcuts and the command search (Ctrl+K). The actions themselves run commands
// of the msh-core registry, so UI, CLI and MCP stay equivalent.

import { getAllWebviewWindows, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import {
  closeView3DWindow,
  openView3DWindow,
  sendView3DAction,
  type View3DAction,
} from "../layout/view3dWindow";
import { forEachPiece } from "../model";
import { usePreferences } from "../preferences";
import { type Tool, useStore, VISITOR_ID } from "../store";
import type { IconName } from "./Icon";
import { planActions } from "./planBridge";
import { type DialogName, isDark, useUi } from "./uiStore";

export type Command = {
  id: string;
  label: string;
  icon?: IconName;
  /** Shortcut as shown to the user, e.g. "Ctrl+Shift+S" */
  shortcut?: string;
  /** The shortcut is handled elsewhere (the plan view), not by the global key handler */
  shortcutElsewhere?: boolean;
  /** Longer explanation for tooltips and the command search */
  hint?: string;
  /** Extra words the command search matches */
  keywords?: string;
  enabled?: () => boolean;
  checked?: () => boolean;
  run: () => void | Promise<void>;
};

export type MenuEntry =
  | { kind: "command"; command: Command }
  | { kind: "separator" }
  | { kind: "heading"; label: string }
  | { kind: "submenu"; label: string; icon?: IconName; entries: () => MenuEntry[] };

export type Menu = { label: string; entries: () => MenuEntry[] };

// ---------------------------------------------------------------- state helpers

const store = () => useStore.getState();
const hasHome = () => !!store().opened;
/** Selected elements of the home (the visitor is no element). */
const selected = () => store().selection.filter((id) => id !== VISITOR_ID);
const hasSelection = () => hasHome() && selected().length > 0;
const run = (command: string, params?: Record<string, unknown>) => store().run(command, params);

/** Selects the elements a command created. */
function selectResult(result: unknown): void {
  const r = result as { id?: string; ids?: string[] } | undefined;
  if (r?.ids) store().setSelection(r.ids);
  else if (r?.id) store().setSelection([r.id]);
}

/** Selected top-level furniture, in selection order. */
function selectedFurniture(): string[] {
  const home = store().opened?.home;
  if (!home) return [];
  const ids = new Set(home.furniture.map((f) => f.attrs.id).filter(Boolean));
  return selected().filter((id) => ids.has(id));
}

function selectedGroups(): string[] {
  const home = store().opened?.home;
  if (!home) return [];
  const sel = selected();
  return home.furniture
    .filter((f) => f.type === "group" && f.attrs.id && sel.includes(f.attrs.id))
    .map((f) => f.attrs.id as string);
}

function selectedWalls(): string[] {
  const home = store().opened?.home;
  const sel = selected();
  return home ? home.walls.filter((w) => sel.includes(w.attrs.id)).map((w) => w.attrs.id) : [];
}

function sortedLevels() {
  return [...(store().opened?.home.levels ?? [])].sort(
    (a, b) =>
      a.attrs.elevation - b.attrs.elevation ||
      (a.attrs.elevation_index ?? 0) - (b.attrs.elevation_index ?? 0),
  );
}

function currentLevel() {
  const id = store().selectedLevel;
  return store().opened?.home.levels.find((l) => l.attrs.id === id) ?? null;
}

/** The window shows no work yet: a new home without changes. */
export function isUntouched(): boolean {
  const o = store().opened;
  return !o || (!o.path && !o.modified && !o.canUndo);
}

// ---------------------------------------------------------------- actions

export async function chooseFile(): Promise<void> {
  const path = await open({
    multiple: false,
    filters: [
      { name: "Sweet Home 3D", extensions: ["sh3d"] },
      { name: "Home.xml", extensions: ["xml"] },
    ],
  });
  if (typeof path !== "string") return;
  // Like Sweet Home 3D: an untouched window takes the home, otherwise a new window opens
  if (isUntouched()) await store().openHome(path);
  else await api.newWindow(path);
}

export function newHome(): void {
  if (isUntouched()) void run("home_new");
  else void api.newWindow();
}

/** Chooses a plan tool; tools that create base plan elements unlock the base plan. */
export function chooseTool(tool: Tool): void {
  store().setTool(tool);
  const creates: Tool[] = [
    "wall",
    "arcwall",
    "room",
    "roomauto",
    "polyline",
    "dimension",
    "heightdim",
    "label",
  ];
  if (creates.includes(tool) && store().opened?.home.attrs.base_plan_locked) {
    void run("home_set", { base_plan_locked: false });
  }
}

/** Opens a dialog of the 3D view, in the separate 3D window if the view is shown there. */
function open3DDialog(dialog: DialogName & View3DAction): void {
  if (useUi.getState().detached) void sendView3DAction(dialog);
  else useUi.getState().openDialog(dialog);
}

export function detach3D(): void {
  const { setDetached } = useUi.getState();
  setDetached(true);
  void openView3DWindow(() => setDetached(false));
}

async function addLevel(sameElevation: boolean): Promise<void> {
  const levels = sortedLevels();
  const current = currentLevel();
  const params: Record<string, unknown> = { name: `Level ${levels.length || 1}` };
  if (sameElevation && current) {
    params.elevation = current.attrs.elevation;
    params.height = current.attrs.height;
    params.floor_thickness = current.attrs.floor_thickness;
  }
  const result = (await run("level_add", params)) as { id?: string } | undefined;
  // Name the new level right away
  if (result?.id) useUi.getState().setEditingLevel(result.id);
}

async function deleteLevel(): Promise<void> {
  const level = currentLevel();
  if (!level) return;
  const yes = await ask(
    `Delete the level "${level.attrs.name}" with all walls, rooms, furniture and other elements on it? Undo restores it.`,
    { title: "Delete level", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" },
  );
  if (yes) await run("edit_delete", { ids: [level.attrs.id] });
}

function rotateSelection(stepDeg: number): void {
  const opened = store().opened;
  if (!opened) return;
  const sel = selected();
  forEachPiece(opened.home.furniture, (p) => {
    if (p.attrs.id && sel.includes(p.attrs.id)) {
      const angle = ((p.attrs.angle ?? 0) * 180) / Math.PI + stepDeg;
      void run("furniture_update", { id: p.attrs.id, angle_deg: ((angle % 360) + 360) % 360 });
    }
  });
}

function align(how: string): void {
  const ids = selectedFurniture();
  // The piece selected last leads, like in Sweet Home 3D
  void run("furniture_align", { ids, how, leader: ids[ids.length - 1] });
}

async function about(): Promise<void> {
  const info = await api.appInfo().catch(() => null);
  await message(
    `My Sweet Home ${info ? `v${info.version}` : ""}\n\nA home design app compatible with Sweet Home 3D files (.sh3d, .sh3f, .sh3t). Controllable through the UI, the msh CLI and an MCP server.`,
    { title: "About My Sweet Home", kind: "info" },
  );
}

async function exitApp(): Promise<void> {
  // Each window asks to save its changes before it closes
  for (const w of await getAllWebviewWindows()) await w.close();
}

// ---------------------------------------------------------------- definitions

const multipleFurniture = () => selectedFurniture().length > 1;
const alignCommand = (how: string, label: string, icon: IconName = "align"): Command => ({
  id: `furniture.align.${how}`,
  label,
  icon,
  hint: "Align the selected furniture to the piece selected last",
  enabled: multipleFurniture,
  run: () => align(how),
});
const toolCommand = (
  tool: Tool,
  label: string,
  icon: IconName,
  hint: string,
  shortcut?: string,
): Command => ({
  id: `tool.${tool}`,
  label,
  icon,
  hint,
  shortcut,
  enabled: hasHome,
  checked: () => store().tool === tool,
  run: () => chooseTool(tool),
});

const LIST: Command[] = [
  // File
  { id: "file.new", label: "New window", icon: "new", shortcut: "Ctrl+N", run: newHome },
  { id: "file.open", label: "Open…", icon: "open", shortcut: "Ctrl+O", run: chooseFile },
  {
    id: "file.save",
    label: "Save",
    icon: "save",
    shortcut: "Ctrl+S",
    enabled: hasHome,
    run: () => store().save(),
  },
  {
    id: "file.saveAs",
    label: "Save as…",
    icon: "save",
    shortcut: "Ctrl+Shift+S",
    enabled: hasHome,
    run: () => store().save(true),
  },
  {
    id: "file.print",
    label: "Print / export…",
    icon: "print",
    shortcut: "Ctrl+P",
    hint: "Print the home or save it as PDF; export the plan (PDF, SVG, PNG), the furniture list (CSV) or the 3D view (OBJ)",
    keywords: "pdf svg png csv obj export",
    enabled: hasHome,
    run: () => useUi.getState().openDialog("export"),
  },
  {
    id: "file.preferences",
    label: "Preferences…",
    icon: "settings",
    shortcut: "Ctrl+,",
    keywords: "settings options rulers grid magnetism",
    run: () => useUi.getState().openDialog("preferences"),
  },
  {
    id: "file.close",
    label: "Close window",
    icon: "close",
    shortcut: "Ctrl+W",
    run: () => getCurrentWebviewWindow().close(),
  },
  { id: "file.exit", label: "Exit", icon: "exit", keywords: "quit", run: exitApp },
  // Edit
  {
    id: "edit.undo",
    label: "Undo",
    icon: "undo",
    shortcut: "Ctrl+Z",
    enabled: () => !!store().opened?.canUndo,
    run: () => store().undo(),
  },
  {
    id: "edit.redo",
    label: "Redo",
    icon: "redo",
    shortcut: "Ctrl+Y",
    enabled: () => !!store().opened?.canRedo,
    run: () => store().redo(),
  },
  {
    id: "edit.cut",
    label: "Cut",
    icon: "cut",
    shortcut: "Ctrl+X",
    shortcutElsewhere: true,
    enabled: hasSelection,
    run: async () => {
      const ids = selected();
      if (await run("edit_copy", { ids })) await run("edit_delete", { ids });
    },
  },
  {
    id: "edit.copy",
    label: "Copy",
    icon: "copy",
    shortcut: "Ctrl+C",
    shortcutElsewhere: true,
    enabled: hasSelection,
    run: () => void run("edit_copy", { ids: selected() }),
  },
  {
    id: "edit.paste",
    label: "Paste",
    icon: "paste",
    shortcut: "Ctrl+V",
    shortcutElsewhere: true,
    enabled: hasHome,
    run: () => planActions()?.paste(),
  },
  {
    id: "edit.pasteStyle",
    label: "Paste style",
    icon: "pastestyle",
    shortcut: "Ctrl+Shift+V",
    hint: "Apply the colors, textures and text style of the copied element to the selection",
    enabled: hasSelection,
    run: () => void run("edit_paste_style", { ids: selected() }),
  },
  {
    id: "edit.duplicate",
    label: "Duplicate",
    icon: "duplicate",
    shortcut: "Ctrl+D",
    shortcutElsewhere: true,
    enabled: hasSelection,
    run: () => void run("edit_duplicate", { ids: selected() }).then(selectResult),
  },
  {
    id: "edit.delete",
    label: "Delete",
    icon: "delete",
    shortcut: "Del",
    shortcutElsewhere: true,
    enabled: hasSelection,
    run: () => void run("edit_delete", { ids: selected() }),
  },
  {
    id: "edit.selectAll",
    label: "Select all",
    icon: "selectall",
    shortcut: "Ctrl+A",
    shortcutElsewhere: true,
    enabled: hasHome,
    run: () => planActions()?.selectAll(),
  },
  {
    id: "edit.lockBasePlan",
    label: "Lock base plan",
    icon: "lock",
    hint: "Walls, rooms, dimensions, texts, doors, windows and fixed furniture can no longer be selected in the plan, only movable furniture. Drawing unlocks it.",
    enabled: hasHome,
    checked: () => store().opened?.home.attrs.base_plan_locked === true,
    run: async () => {
      const lock = store().opened?.home.attrs.base_plan_locked !== true;
      await run("home_set", { base_plan_locked: lock });
      // Locked elements leave the selection, as in Sweet Home 3D
      if (lock) store().setSelection([]);
    },
  },
  // Plan tools
  toolCommand(
    "select",
    "Select",
    "select",
    "Select and move; drag the handles to resize or rotate",
    "Esc",
  ),
  toolCommand("pan", "Pan", "pan", "Drag to move the plan (also with the right mouse button)"),
  toolCommand("wall", "Straight walls", "wall", "Click to add points, double-click to finish"),
  toolCommand("arcwall", "Round walls", "arcwall", "Walls drawn as quarter circle arcs"),
  toolCommand("room", "Room by corners", "room", "Click the corners, double-click to finish"),
  toolCommand(
    "roomauto",
    "Room from walls",
    "roomauto",
    "Click inside walls to create the room of that area",
  ),
  toolCommand("polyline", "Lines", "polyline", "Click to add points, double-click to finish"),
  toolCommand("dimension", "Dimension", "dimension", "Click start and end point"),
  toolCommand(
    "heightdim",
    "Height dimension",
    "heightdim",
    "Click where the height of the level is measured",
  ),
  toolCommand("label", "Text", "text", "Click to place a text"),
  toolCommand("measure", "Measure", "measure", "Measure a distance without adding anything"),
  // Plan: walls
  {
    id: "wall.join",
    label: "Join walls",
    icon: "joinwalls",
    shortcut: "J",
    shortcutElsewhere: true,
    enabled: () => selectedWalls().length === 2,
    run: () => void run("wall_join", { ids: selectedWalls() }),
  },
  {
    id: "wall.split",
    label: "Split wall in the middle",
    icon: "splitwall",
    enabled: () => selectedWalls().length === 1,
    run: () => {
      const id = selectedWalls()[0];
      const w = store().opened?.home.walls.find((x) => x.attrs.id === id);
      if (!w) return;
      const a = w.attrs;
      const at = [(a.x_start + a.x_end) / 2, (a.y_start + a.y_end) / 2].map(
        (v) => Math.round(v * 10) / 10,
      );
      void run("wall_split", { id, at }).then(selectResult);
    },
  },
  {
    id: "wall.reverse",
    label: "Reverse wall direction",
    icon: "reverse",
    enabled: () => selectedWalls().length > 0,
    run: () => void run("wall_reverse", { ids: selectedWalls() }),
  },
  {
    id: "wall.detach",
    label: "Detach walls",
    icon: "splitwall",
    enabled: () => selectedWalls().length > 0,
    run: () => void run("wall_detach", { ids: selectedWalls() }),
  },
  // Plan: view
  {
    id: "plan.zoomIn",
    label: "Zoom in",
    icon: "zoomin",
    shortcut: "Ctrl++",
    enabled: hasHome,
    run: () => planActions()?.zoom(1.5),
  },
  {
    id: "plan.zoomOut",
    label: "Zoom out",
    icon: "zoomout",
    shortcut: "Ctrl+-",
    enabled: hasHome,
    run: () => planActions()?.zoom(1 / 1.5),
  },
  {
    id: "plan.fit",
    label: "Fit plan to window",
    icon: "zoomfit",
    shortcut: "Ctrl+0",
    enabled: hasHome,
    run: () => store().requestFit(),
  },
  {
    id: "plan.rulers",
    label: "Rulers",
    icon: "rulers",
    checked: () => usePreferences.getState().rulers,
    run: () => usePreferences.getState().update({ rulers: !usePreferences.getState().rulers }),
  },
  {
    id: "plan.grid",
    label: "Grid",
    icon: "grid",
    checked: () => usePreferences.getState().grid,
    run: () => usePreferences.getState().update({ grid: !usePreferences.getState().grid }),
  },
  {
    id: "plan.magnetism",
    label: "Magnetism",
    icon: "grid",
    hint: "Snap to walls, angles and lengths while drawing and moving; Alt inverts it",
    checked: () => usePreferences.getState().magnetism,
    run: () =>
      usePreferences.getState().update({ magnetism: !usePreferences.getState().magnetism }),
  },
  {
    id: "plan.backgroundImport",
    label: "Import background image…",
    icon: "background",
    keywords: "floor plan pdf scan",
    enabled: hasHome,
    run: () => useUi.getState().openDialog("backgroundImport"),
  },
  {
    id: "plan.backgroundModify",
    label: "Modify background image…",
    icon: "background",
    enabled: () => !!currentBackground(),
    run: () => useUi.getState().openDialog("backgroundModify"),
  },
  {
    id: "plan.backgroundToggle",
    label: "Show background image",
    icon: "background",
    enabled: () => !!currentBackground(),
    checked: () => currentBackground()?.visible !== false,
    run: () => {
      const bg = currentBackground();
      if (bg)
        void run("background_image_update", { ...levelParam(), visible: bg.visible === false });
    },
  },
  {
    id: "plan.backgroundDelete",
    label: "Delete background image",
    icon: "delete",
    enabled: () => !!currentBackground(),
    run: () => void run("background_image_remove", levelParam()),
  },
  // Levels
  {
    id: "level.add",
    label: "Add level",
    icon: "leveladd",
    hint: "Add a level above the highest one",
    enabled: hasHome,
    run: () => addLevel(false),
  },
  {
    id: "level.addSame",
    label: "Add level at same elevation",
    icon: "leveladd",
    hint: "Add a level at the elevation of the selected one, e.g. for a split level",
    enabled: () => !!currentLevel(),
    run: () => addLevel(true),
  },
  {
    id: "level.rename",
    label: "Rename level",
    icon: "level",
    enabled: () => !!currentLevel(),
    run: () => useUi.getState().setEditingLevel(currentLevel()?.attrs.id ?? null),
  },
  {
    id: "level.viewable",
    label: "Show level in 3D",
    icon: "level",
    enabled: () => !!currentLevel(),
    checked: () => currentLevel()?.attrs.viewable !== false,
    run: () => {
      const l = currentLevel();
      if (l) void run("level_update", { id: l.attrs.id, viewable: l.attrs.viewable === false });
    },
  },
  {
    id: "level.delete",
    label: "Delete level…",
    icon: "delete",
    enabled: () => !!currentLevel(),
    run: deleteLevel,
  },
  {
    id: "level.allIn3D",
    label: "Show all levels in 3D",
    icon: "alllevels",
    hint: "Show all levels, not only the selected one and the ones below",
    enabled: () => (store().opened?.home.levels.length ?? 0) > 1,
    checked: () => store().opened?.home.environment?.attrs.all_levels_visible === true,
    run: () =>
      void run("view3d_update", {
        all_levels_visible: store().opened?.home.environment?.attrs.all_levels_visible !== true,
      }),
  },
  // Furniture
  {
    id: "furniture.import",
    label: "Import furniture…",
    icon: "import",
    hint: "Import a 3D model (OBJ, DAE, 3DS, glTF, ...) into the catalog",
    run: () => useUi.getState().openDialog("importFurniture"),
  },
  {
    id: "furniture.libraries",
    label: "Furniture and texture libraries…",
    icon: "library",
    keywords: "sh3f sh3t catalog",
    run: () => useUi.getState().openDialog("libraries"),
  },
  {
    id: "furniture.group",
    label: "Group",
    icon: "group",
    shortcut: "Ctrl+G",
    shortcutElsewhere: true,
    enabled: multipleFurniture,
    run: () => void run("furniture_group", { ids: selectedFurniture() }).then(selectResult),
  },
  {
    id: "furniture.ungroup",
    label: "Ungroup",
    icon: "ungroup",
    shortcut: "Ctrl+Shift+G",
    shortcutElsewhere: true,
    enabled: () => selectedGroups().length > 0,
    run: () => void run("furniture_ungroup", { ids: selectedGroups() }).then(selectResult),
  },
  alignCommand("left", "Align left sides"),
  alignCommand("right", "Align right sides"),
  alignCommand("front", "Align front sides"),
  alignCommand("back", "Align back sides"),
  alignCommand("top", "Align tops"),
  alignCommand("bottom", "Align bottoms (elevation)"),
  alignCommand("side_by_side", "Place side by side", "distribute"),
  {
    id: "furniture.distributeH",
    label: "Distribute horizontally",
    icon: "distribute",
    enabled: () => selectedFurniture().length > 2,
    run: () => void run("furniture_distribute", { ids: selectedFurniture(), axis: "horizontal" }),
  },
  {
    id: "furniture.distributeV",
    label: "Distribute vertically",
    icon: "distribute",
    enabled: () => selectedFurniture().length > 2,
    run: () => void run("furniture_distribute", { ids: selectedFurniture(), axis: "vertical" }),
  },
  {
    id: "edit.flipH",
    label: "Flip horizontally",
    icon: "flip",
    enabled: hasSelection,
    run: () => void run("edit_flip", { ids: selected(), axis: "horizontal" }),
  },
  {
    id: "edit.flipV",
    label: "Flip vertically",
    icon: "flip",
    enabled: hasSelection,
    run: () => void run("edit_flip", { ids: selected(), axis: "vertical" }),
  },
  {
    id: "furniture.rotate",
    label: "Rotate by 15°",
    icon: "rotate",
    shortcut: "R",
    shortcutElsewhere: true,
    enabled: () => selectedFurniture().length > 0,
    run: () => rotateSelection(15),
  },
  // 3D view
  {
    id: "view3d.aerial",
    label: "Aerial view",
    icon: "aerial",
    shortcut: "F7",
    enabled: hasHome,
    checked: () => store().viewMode === "aerial",
    run: () => store().setViewMode("aerial"),
  },
  {
    id: "view3d.visit",
    label: "Virtual visit",
    icon: "visit",
    shortcut: "F8",
    enabled: hasHome,
    checked: () => store().viewMode === "observer",
    run: () => store().setViewMode("observer"),
  },
  {
    id: "view3d.shadows",
    label: "Shadows",
    icon: "shadows",
    enabled: hasHome,
    checked: () => useUi.getState().shadows,
    run: () => {
      if (useUi.getState().detached) void sendView3DAction("shadows");
      else useUi.getState().setShadows(!useUi.getState().shadows);
    },
  },
  {
    id: "view3d.settings",
    label: "3D settings…",
    icon: "settings",
    hint: "Ground, sky, light, walls transparency",
    enabled: hasHome,
    run: () => open3DDialog("settings3d"),
  },
  {
    id: "view3d.location",
    label: "Location and sun…",
    icon: "location",
    keywords: "compass time date city",
    enabled: hasHome,
    run: () => open3DDialog("settings3d"),
  },
  {
    id: "view3d.photo",
    label: "Create photo…",
    icon: "photo",
    keywords: "render image picture",
    enabled: hasHome,
    run: () => open3DDialog("photo"),
  },
  {
    id: "view3d.video",
    label: "Create video…",
    icon: "video",
    keywords: "movie animation",
    enabled: hasHome,
    run: () => open3DDialog("video"),
  },
  {
    id: "view3d.detach",
    label: "Open 3D view in own window",
    icon: "detach",
    enabled: hasHome,
    checked: () => useUi.getState().detached,
    run: () => {
      if (useUi.getState().detached) void closeView3DWindow();
      else detach3D();
    },
  },
  // Window
  {
    id: "window.theme",
    label: "Dark mode",
    icon: "moon",
    hint: "Switch between light and dark mode (the default follows Windows)",
    keywords: "theme light dark colors",
    checked: isDark,
    run: () => useUi.getState().setTheme(isDark() ? "light" : "dark"),
  },
  {
    id: "window.themeSystem",
    label: "Follow Windows theme",
    icon: "sun",
    keywords: "theme light dark colors system",
    checked: () => useUi.getState().theme === "system",
    run: () => useUi.getState().setTheme("system"),
  },
  {
    id: "window.search",
    label: "Search commands…",
    icon: "search",
    shortcut: "Ctrl+K",
    run: () => useUi.getState().setPaletteOpen(true),
  },
  // Extensions (plugins follow in a later version)
  {
    id: "plugins.manage",
    label: "Manage plugins…",
    icon: "plugin",
    hint: "Plugins follow in a later version",
    enabled: () => false,
    run: () => {},
  },
  // Help
  {
    id: "help.shortcuts",
    label: "Keyboard shortcuts",
    icon: "keyboard",
    shortcut: "F1",
    run: () => useUi.getState().openDialog("shortcuts"),
  },
  { id: "help.about", label: "About My Sweet Home", icon: "info", run: about },
];

function currentBackground() {
  const opened = store().opened;
  if (!opened) return null;
  const level = currentLevel();
  return level ? (level.background_image ?? null) : (opened.home.background_image ?? null);
}

function levelParam(): Record<string, unknown> {
  const level = currentLevel();
  return level ? { level: level.attrs.id } : {};
}

export const COMMANDS: ReadonlyMap<string, Command> = new Map(LIST.map((c) => [c.id, c]));

/** The command with this ID (throws for unknown IDs, which are programming errors). */
export function command(id: string): Command {
  const c = COMMANDS.get(id);
  if (!c) throw new Error(`unknown command '${id}'`);
  return c;
}

export function isEnabled(c: Command): boolean {
  return c.enabled ? c.enabled() : true;
}

/** Runs a command if it is enabled; errors end up in the error bar. */
export function runCommand(c: Command): void {
  if (!isEnabled(c)) return;
  Promise.resolve()
    .then(() => c.run())
    .catch((e) => useStore.setState({ error: String(e) }));
}

// ---------------------------------------------------------------- menus

const cmd = (id: string): MenuEntry => ({ kind: "command", command: command(id) });
const sep: MenuEntry = { kind: "separator" };

function viewpointEntries(): MenuEntry[] {
  const cameras = store().opened?.home.cameras.filter((c) => c.attrs.role === "storedCamera");
  if (!cameras?.length) return [{ kind: "heading", label: "No stored points of view" }];
  return cameras.map((c) => {
    const name = c.attrs.name ?? "";
    return {
      kind: "command",
      command: {
        id: `viewpoint.${name}`,
        label: name,
        icon: "viewpoint",
        run: () => void run("viewpoint_go", { name }),
      },
    };
  });
}

function levelEntries(): MenuEntry[] {
  return sortedLevels().map((l) => ({
    kind: "command",
    command: {
      id: `level.select.${l.attrs.id}`,
      label: l.attrs.name,
      icon: "level",
      checked: () => store().selectedLevel === l.attrs.id,
      run: () => store().selectLevel(l.attrs.id),
    },
  }));
}

export const MENUS: Menu[] = [
  {
    label: "File",
    entries: () => [
      cmd("file.new"),
      cmd("file.open"),
      sep,
      cmd("file.save"),
      cmd("file.saveAs"),
      sep,
      {
        kind: "submenu",
        label: "Import",
        icon: "import",
        entries: () => [cmd("furniture.import"), cmd("plan.backgroundImport")],
      },
      cmd("file.print"),
      sep,
      cmd("file.preferences"),
      sep,
      cmd("file.close"),
      cmd("file.exit"),
    ],
  },
  {
    label: "Edit",
    entries: () => [
      cmd("edit.undo"),
      cmd("edit.redo"),
      sep,
      cmd("edit.cut"),
      cmd("edit.copy"),
      cmd("edit.paste"),
      cmd("edit.pasteStyle"),
      cmd("edit.duplicate"),
      cmd("edit.delete"),
      sep,
      cmd("edit.selectAll"),
      cmd("edit.lockBasePlan"),
    ],
  },
  {
    label: "Plan",
    entries: () => [
      cmd("tool.select"),
      cmd("tool.pan"),
      cmd("tool.wall"),
      cmd("tool.arcwall"),
      cmd("tool.room"),
      cmd("tool.roomauto"),
      cmd("tool.polyline"),
      cmd("tool.dimension"),
      cmd("tool.heightdim"),
      cmd("tool.label"),
      cmd("tool.measure"),
      sep,
      {
        kind: "submenu",
        label: "Walls",
        icon: "wall",
        entries: () => [
          cmd("wall.join"),
          cmd("wall.split"),
          cmd("wall.reverse"),
          cmd("wall.detach"),
        ],
      },
      {
        kind: "submenu",
        label: "Background image",
        icon: "background",
        entries: () => [
          cmd("plan.backgroundImport"),
          cmd("plan.backgroundModify"),
          cmd("plan.backgroundToggle"),
          cmd("plan.backgroundDelete"),
        ],
      },
      sep,
      cmd("plan.zoomIn"),
      cmd("plan.zoomOut"),
      cmd("plan.fit"),
      sep,
      cmd("plan.rulers"),
      cmd("plan.grid"),
      cmd("plan.magnetism"),
    ],
  },
  {
    label: "Levels",
    entries: () => [
      ...levelEntries(),
      ...(sortedLevels().length > 0 ? [sep] : []),
      cmd("level.add"),
      cmd("level.addSame"),
      cmd("level.rename"),
      cmd("level.viewable"),
      cmd("level.delete"),
      sep,
      cmd("level.allIn3D"),
    ],
  },
  {
    label: "Furniture",
    entries: () => [
      cmd("furniture.import"),
      cmd("furniture.libraries"),
      sep,
      cmd("furniture.group"),
      cmd("furniture.ungroup"),
      sep,
      {
        kind: "submenu",
        label: "Align",
        icon: "align",
        entries: () => [
          cmd("furniture.align.left"),
          cmd("furniture.align.right"),
          cmd("furniture.align.front"),
          cmd("furniture.align.back"),
          cmd("furniture.align.top"),
          cmd("furniture.align.bottom"),
          cmd("furniture.align.side_by_side"),
        ],
      },
      cmd("furniture.distributeH"),
      cmd("furniture.distributeV"),
      {
        kind: "submenu",
        label: "Flip",
        icon: "flip",
        entries: () => [cmd("edit.flipH"), cmd("edit.flipV")],
      },
      cmd("furniture.rotate"),
    ],
  },
  {
    label: "3D view",
    entries: () => [
      cmd("view3d.aerial"),
      cmd("view3d.visit"),
      sep,
      {
        kind: "submenu",
        label: "Points of view",
        icon: "viewpoint",
        entries: viewpointEntries,
      },
      sep,
      cmd("view3d.shadows"),
      cmd("level.allIn3D"),
      cmd("view3d.settings"),
      cmd("view3d.location"),
      sep,
      cmd("view3d.photo"),
      cmd("view3d.video"),
      sep,
      cmd("view3d.detach"),
    ],
  },
  {
    label: "Extensions",
    entries: () => [cmd("plugins.manage")],
  },
  {
    label: "Help",
    entries: () => [
      cmd("window.search"),
      cmd("help.shortcuts"),
      sep,
      cmd("window.theme"),
      cmd("window.themeSystem"),
      sep,
      cmd("help.about"),
    ],
  },
];

// ---------------------------------------------------------------- keyboard

/** Normalized shortcut of a key event, e.g. "Ctrl+Shift+S", in the notation of `shortcut`. */
export function eventShortcut(e: KeyboardEvent): string {
  let key = e.key;
  if (key === " ") key = "Space";
  else if (key === "Delete") key = "Del";
  else if (key === "+" || key === "=") key = "+";
  else if (key.length === 1) key = key.toUpperCase();
  const mods = [
    e.ctrlKey || e.metaKey ? "Ctrl" : "",
    e.altKey ? "Alt" : "",
    e.shiftKey ? "Shift" : "",
  ];
  // Ctrl++ is typed with Shift on many layouts
  if (key === "+") mods[2] = "";
  return [...mods.filter(Boolean), key].join("+");
}

/** Further shortcuts of commands: typed shortcut → shortcut shown in the menus. */
const SHORTCUT_ALIASES: Record<string, string> = { "Ctrl+Shift+Z": "Ctrl+Y" };

/**
 * Handles the global shortcuts of the commands. Shortcuts the plan view handles itself (with
 * the selection in mind) are left to it.
 */
export function handleGlobalShortcut(e: KeyboardEvent): void {
  const target = e.target as HTMLElement;
  const typing =
    target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
  const typed = eventShortcut(e);
  const shortcut = SHORTCUT_ALIASES[typed] ?? typed;
  // While typing only function keys and the command search apply
  if (typing && !/^F\d+$/.test(shortcut) && shortcut !== "Ctrl+K") return;
  // Plain letters and Del belong to the plan view (rotate, join, delete, ...)
  if (!shortcut.includes("Ctrl+") && !/^F\d+$/.test(shortcut)) return;
  for (const c of COMMANDS.values()) {
    if (c.shortcut === shortcut && !c.shortcutElsewhere) {
      e.preventDefault();
      runCommand(c);
      return;
    }
  }
}
