// UI commands: one definition per user action, shared by the menu bar, the tool bar, the
// keyboard shortcuts and the command search (Ctrl+K). The actions themselves run commands
// of the msh-core registry, so UI, CLI and MCP stay equivalent.

import { getAllWebviewWindows, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { t } from "../i18n";
import {
  closeView3DWindow,
  openView3DWindow,
  sendView3DAction,
  type View3DAction,
} from "../layout/view3dWindow";
import { forEachPiece } from "../model";
import { newHomeParams, prefs, usePreferences } from "../preferences";
import { clearRecentHomes, recentHomes, recentLabel, removeRecentHome } from "../recentHomes";
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
  await openFile(path);
}

/** Opens a home file: an untouched window takes it, otherwise a new window opens (like SH3D). */
async function openFile(path: string): Promise<void> {
  if (isUntouched()) await store().openHome(path);
  else await api.newWindow(path);
}

/** Opens a home of the recent list; a file that is gone leaves the list. */
async function openRecent(path: string): Promise<void> {
  // The home of this window: nothing to open
  if (store().opened?.path?.toLowerCase() === path.toLowerCase()) return;
  if (!(await api.fileExists(path).catch(() => false))) {
    removeRecentHome(path);
    await message(t("The file {path} no longer exists. It was removed from the list.", { path }), {
      title: t("Open recent"),
      kind: "warning",
    });
    return;
  }
  await openFile(path);
}

function recentEntries(): MenuEntry[] {
  const list = recentHomes();
  if (list.length === 0) return [{ kind: "heading", label: t("No recent homes") }];
  return [
    ...list.map(
      (path, i): MenuEntry => ({
        kind: "command",
        command: {
          id: `file.recent.${i}`,
          label: `${i + 1}  ${recentLabel(path, list)}`,
          hint: path,
          run: () => openRecent(path),
        },
      }),
    ),
    sep,
    {
      kind: "command",
      command: { id: "file.recent.clear", label: t("Clear list"), run: clearRecentHomes },
    },
  ];
}

export function newHome(): void {
  if (isUntouched()) void run("home_new", newHomeParams());
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
  const params: Record<string, unknown> = {
    name: t("Level {n}", { n: levels.length || 1 }),
    floor_thickness: prefs().newFloorThickness,
  };
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
    t(
      'Delete the level "{name}" with all walls, rooms, furniture and other elements on it? Undo restores it.',
      { name: level.attrs.name },
    ),
    { title: t("Delete level"), kind: "warning", okLabel: t("Delete"), cancelLabel: t("Cancel") },
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
    t(
      "My Sweet Home {v0}\n\nA home design app compatible with Sweet Home 3D files (.sh3d, .sh3f, .sh3t). Controllable through the UI, the msh CLI and an MCP server.",
      { v0: info ? `v${info.version}` : "" },
    ),
    { title: t("About My Sweet Home"), kind: "info" },
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
  hint: t("Align the selected furniture to the piece selected last"),
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
  { id: "file.new", label: t("New window"), icon: "new", shortcut: "Ctrl+N", run: newHome },
  { id: "file.open", label: t("Open…"), icon: "open", shortcut: "Ctrl+O", run: chooseFile },
  {
    id: "file.save",
    label: t("Save"),
    icon: "save",
    shortcut: "Ctrl+S",
    enabled: hasHome,
    run: () => store().save(),
  },
  {
    id: "file.saveAs",
    label: t("Save as…"),
    icon: "save",
    shortcut: "Ctrl+Shift+S",
    enabled: hasHome,
    run: () => store().save(true),
  },
  {
    id: "file.print",
    label: t("Print / export…"),
    icon: "print",
    shortcut: "Ctrl+P",
    hint: t(
      "Print the home or save it as PDF; export the plan (PDF, SVG, PNG), the furniture list (CSV) or the 3D view (OBJ)",
    ),
    keywords: "pdf svg png csv obj export",
    enabled: hasHome,
    run: () => useUi.getState().openDialog("export"),
  },
  {
    id: "file.preferences",
    label: t("Preferences…"),
    icon: "settings",
    shortcut: "Ctrl+,",
    keywords: "settings options rulers grid magnetism",
    run: () => useUi.getState().openDialog("preferences"),
  },
  {
    id: "file.close",
    label: t("Close window"),
    icon: "close",
    shortcut: "Ctrl+W",
    run: () => getCurrentWebviewWindow().close(),
  },
  { id: "file.exit", label: t("Exit"), icon: "exit", keywords: "quit", run: exitApp },
  // Edit
  {
    id: "edit.undo",
    label: t("Undo"),
    icon: "undo",
    shortcut: "Ctrl+Z",
    enabled: () => !!store().opened?.canUndo,
    run: () => store().undo(),
  },
  {
    id: "edit.redo",
    label: t("Redo"),
    icon: "redo",
    shortcut: "Ctrl+Y",
    enabled: () => !!store().opened?.canRedo,
    run: () => store().redo(),
  },
  {
    id: "edit.cut",
    label: t("Cut"),
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
    label: t("Copy"),
    icon: "copy",
    shortcut: "Ctrl+C",
    shortcutElsewhere: true,
    enabled: hasSelection,
    run: () => void run("edit_copy", { ids: selected() }),
  },
  {
    id: "edit.paste",
    label: t("Paste"),
    icon: "paste",
    shortcut: "Ctrl+V",
    shortcutElsewhere: true,
    enabled: hasHome,
    run: () => planActions()?.paste(),
  },
  {
    id: "edit.pasteStyle",
    label: t("Paste style"),
    icon: "pastestyle",
    shortcut: "Ctrl+Shift+V",
    hint: t("Apply the colors, textures and text style of the copied element to the selection"),
    enabled: hasSelection,
    run: () => void run("edit_paste_style", { ids: selected() }),
  },
  {
    id: "edit.duplicate",
    label: t("Duplicate"),
    icon: "duplicate",
    shortcut: "Ctrl+D",
    shortcutElsewhere: true,
    enabled: hasSelection,
    run: () => void run("edit_duplicate", { ids: selected() }).then(selectResult),
  },
  {
    id: "edit.delete",
    label: t("Delete"),
    icon: "delete",
    shortcut: "Del",
    shortcutElsewhere: true,
    enabled: hasSelection,
    run: () => void run("edit_delete", { ids: selected() }),
  },
  {
    id: "edit.selectAll",
    label: t("Select all"),
    icon: "selectall",
    shortcut: "Ctrl+A",
    shortcutElsewhere: true,
    enabled: hasHome,
    run: () => planActions()?.selectAll(),
  },
  {
    id: "edit.lockBasePlan",
    label: t("Lock base plan"),
    icon: "lock",
    hint: t(
      "Walls, rooms, dimensions, texts, doors, windows and fixed furniture can no longer be selected in the plan, only movable furniture. Drawing unlocks it.",
    ),
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
    t("Select"),
    "select",
    t("Select and move; drag the handles to resize or rotate"),
    "Esc",
  ),
  toolCommand(
    "pan",
    t("Pan"),
    "pan",
    t("Drag to move the plan (also with the right mouse button)"),
  ),
  toolCommand(
    "wall",
    t("Straight walls"),
    "wall",
    t("Click to add points, double-click to finish"),
    "1",
  ),
  toolCommand("arcwall", t("Round walls"), "arcwall", t("Walls drawn as quarter circle arcs")),
  toolCommand(
    "room",
    t("Room by corners"),
    "room",
    t("Click the corners, double-click to finish"),
    "2",
  ),
  toolCommand(
    "roomauto",
    t("Room from walls"),
    "roomauto",
    t("Click inside walls to create the room of that area"),
  ),
  toolCommand(
    "polyline",
    t("Lines"),
    "polyline",
    t("Click to add points, double-click to finish"),
    "5",
  ),
  toolCommand("dimension", t("Dimension"), "dimension", t("Click start and end point"), "3"),
  toolCommand(
    "heightdim",
    t("Height dimension"),
    "heightdim",
    t("Click where the height of the level is measured"),
  ),
  toolCommand("label", t("Text"), "text", t("Click to place a text"), "6"),
  toolCommand(
    "measure",
    t("Measure"),
    "measure",
    t("Measure a distance without adding anything"),
    "4",
  ),
  // Plan: walls
  {
    id: "wall.join",
    label: t("Join walls"),
    icon: "joinwalls",
    shortcut: "J",
    shortcutElsewhere: true,
    enabled: () => selectedWalls().length === 2,
    run: () => void run("wall_join", { ids: selectedWalls() }),
  },
  {
    id: "wall.split",
    label: t("Split wall in the middle"),
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
    label: t("Reverse wall direction"),
    icon: "reverse",
    enabled: () => selectedWalls().length > 0,
    run: () => void run("wall_reverse", { ids: selectedWalls() }),
  },
  {
    id: "wall.detach",
    label: t("Detach walls"),
    icon: "splitwall",
    enabled: () => selectedWalls().length > 0,
    run: () => void run("wall_detach", { ids: selectedWalls() }),
  },
  // Plan: view
  {
    id: "plan.zoomIn",
    label: t("Zoom in"),
    icon: "zoomin",
    shortcut: "Ctrl++",
    enabled: hasHome,
    run: () => planActions()?.zoom(1.5),
  },
  {
    id: "plan.zoomOut",
    label: t("Zoom out"),
    icon: "zoomout",
    shortcut: "Ctrl+-",
    enabled: hasHome,
    run: () => planActions()?.zoom(1 / 1.5),
  },
  {
    id: "plan.fit",
    label: t("Fit plan to window"),
    icon: "zoomfit",
    shortcut: "Ctrl+0",
    enabled: hasHome,
    run: () => store().requestFit(),
  },
  {
    id: "plan.rulers",
    label: t("Rulers"),
    icon: "rulers",
    checked: () => usePreferences.getState().rulers,
    run: () => usePreferences.getState().update({ rulers: !usePreferences.getState().rulers }),
  },
  {
    id: "plan.grid",
    label: t("Grid"),
    icon: "grid",
    checked: () => usePreferences.getState().grid,
    run: () => usePreferences.getState().update({ grid: !usePreferences.getState().grid }),
  },
  {
    id: "plan.magnetism",
    label: t("Magnetism"),
    icon: "grid",
    hint: t("Snap to walls, angles and lengths while drawing and moving; Alt inverts it"),
    checked: () => usePreferences.getState().magnetism,
    run: () =>
      usePreferences.getState().update({ magnetism: !usePreferences.getState().magnetism }),
  },
  {
    id: "plan.backgroundImport",
    label: t("Import background image…"),
    icon: "background",
    keywords: "floor plan pdf scan",
    enabled: hasHome,
    run: () => useUi.getState().openDialog("backgroundImport"),
  },
  {
    id: "plan.backgroundModify",
    label: t("Modify background image…"),
    icon: "background",
    enabled: () => !!currentBackground(),
    run: () => useUi.getState().openDialog("backgroundModify"),
  },
  {
    id: "plan.backgroundToggle",
    label: t("Show background image"),
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
    label: t("Delete background image"),
    icon: "delete",
    enabled: () => !!currentBackground(),
    run: () => void run("background_image_remove", levelParam()),
  },
  // Levels
  {
    id: "level.add",
    label: t("Add level"),
    icon: "leveladd",
    hint: t("Add a level above the highest one"),
    enabled: hasHome,
    run: () => addLevel(false),
  },
  {
    id: "level.addSame",
    label: t("Add level at same elevation"),
    icon: "leveladd",
    hint: t("Add a level at the elevation of the selected one, e.g. for a split level"),
    enabled: () => !!currentLevel(),
    run: () => addLevel(true),
  },
  {
    id: "level.rename",
    label: t("Rename level"),
    icon: "level",
    enabled: () => !!currentLevel(),
    run: () => useUi.getState().setEditingLevel(currentLevel()?.attrs.id ?? null),
  },
  {
    id: "level.viewable",
    label: t("Show level in 3D"),
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
    label: t("Delete level…"),
    icon: "delete",
    enabled: () => !!currentLevel(),
    run: deleteLevel,
  },
  {
    id: "level.allIn3D",
    label: t("Show all levels in 3D"),
    icon: "alllevels",
    hint: t("Show all levels, not only the selected one and the ones below"),
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
    label: t("Add to library…"),
    icon: "import",
    hint: t("Add 3D models, textures, libraries, online items or furniture of the home"),
    keywords:
      "import model obj dae 3ds gltf fbx texture image pbr material online internet ambientcg poly haven sh3f sh3t",
    run: () => useUi.getState().openDialog("libraries", "add"),
  },
  {
    id: "furniture.libraries",
    label: t("Libraries…"),
    icon: "library",
    hint: t("Edit furniture and texture libraries: items, categories, names"),
    keywords: "sh3f sh3t catalog edit category rename library editor",
    run: () => useUi.getState().openDialog("libraries"),
  },
  {
    id: "furniture.group",
    label: t("Group"),
    icon: "group",
    shortcut: "Ctrl+G",
    shortcutElsewhere: true,
    enabled: multipleFurniture,
    run: () => void run("furniture_group", { ids: selectedFurniture() }).then(selectResult),
  },
  {
    id: "furniture.ungroup",
    label: t("Ungroup"),
    icon: "ungroup",
    shortcut: "Ctrl+Shift+G",
    shortcutElsewhere: true,
    enabled: () => selectedGroups().length > 0,
    run: () => void run("furniture_ungroup", { ids: selectedGroups() }).then(selectResult),
  },
  alignCommand("left", t("Align left sides")),
  alignCommand("right", t("Align right sides")),
  alignCommand("front", t("Align front sides")),
  alignCommand("back", t("Align back sides")),
  alignCommand("top", t("Align tops")),
  alignCommand("bottom", t("Align bottoms (elevation)")),
  alignCommand("side_by_side", t("Place side by side"), "distribute"),
  {
    id: "furniture.distributeH",
    label: t("Distribute horizontally"),
    icon: "distribute",
    enabled: () => selectedFurniture().length > 2,
    run: () => void run("furniture_distribute", { ids: selectedFurniture(), axis: "horizontal" }),
  },
  {
    id: "furniture.distributeV",
    label: t("Distribute vertically"),
    icon: "distribute",
    enabled: () => selectedFurniture().length > 2,
    run: () => void run("furniture_distribute", { ids: selectedFurniture(), axis: "vertical" }),
  },
  {
    id: "edit.flipH",
    label: t("Flip horizontally"),
    icon: "flip",
    enabled: hasSelection,
    run: () => void run("edit_flip", { ids: selected(), axis: "horizontal" }),
  },
  {
    id: "edit.flipV",
    label: t("Flip vertically"),
    icon: "flipv",
    enabled: hasSelection,
    run: () => void run("edit_flip", { ids: selected(), axis: "vertical" }),
  },
  {
    id: "furniture.rotate",
    label: t("Rotate by 15°"),
    icon: "rotate",
    shortcut: "R",
    shortcutElsewhere: true,
    enabled: () => selectedFurniture().length > 0,
    run: () => rotateSelection(15),
  },
  // 3D view
  {
    id: "view3d.aerial",
    label: t("Aerial view"),
    icon: "aerial",
    shortcut: "F7",
    enabled: hasHome,
    checked: () => store().viewMode === "aerial",
    run: () => store().setViewMode("aerial"),
  },
  {
    id: "view3d.visit",
    label: t("Virtual visit"),
    icon: "visit",
    shortcut: "F8",
    enabled: hasHome,
    checked: () => store().viewMode === "observer",
    run: () => store().setViewMode("observer"),
  },
  {
    id: "view3d.shadows",
    label: t("Shadows"),
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
    label: t("3D settings…"),
    icon: "settings",
    hint: t("Ground, sky, light, walls transparency"),
    enabled: hasHome,
    run: () => open3DDialog("settings3d"),
  },
  {
    id: "view3d.location",
    label: t("Location and sun…"),
    icon: "location",
    keywords: "compass time date city",
    enabled: hasHome,
    run: () => open3DDialog("settings3d"),
  },
  {
    id: "view3d.photo",
    label: t("Create photo…"),
    icon: "photo",
    keywords: "render image picture",
    enabled: hasHome,
    run: () => open3DDialog("photo"),
  },
  {
    id: "view3d.video",
    label: t("Create video…"),
    icon: "video",
    keywords: "movie animation",
    enabled: hasHome,
    run: () => open3DDialog("video"),
  },
  {
    id: "view3d.detach",
    label: t("Open 3D view in own window"),
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
    label: t("Dark mode"),
    icon: "moon",
    hint: t("Switch between light and dark mode (the default follows Windows)"),
    keywords: "theme light dark colors",
    checked: isDark,
    run: () => useUi.getState().setTheme(isDark() ? "light" : "dark"),
  },
  {
    id: "window.themeSystem",
    label: t("Follow Windows theme"),
    icon: "sun",
    keywords: "theme light dark colors system",
    checked: () => useUi.getState().theme === "system",
    run: () => useUi.getState().setTheme("system"),
  },
  {
    id: "window.search",
    label: t("Search commands…"),
    icon: "search",
    shortcut: "Ctrl+K",
    run: () => useUi.getState().setPaletteOpen(true),
  },
  // Extensions (plugins follow in a later version)
  {
    id: "plugins.manage",
    label: t("Manage plugins…"),
    icon: "plugin",
    hint: t("Plugins follow in a later version"),
    enabled: () => false,
    run: () => {},
  },
  // Help
  {
    id: "help.guide",
    label: t("User guide"),
    icon: "info",
    shortcut: "F1",
    keywords: "help manual documentation guide",
    run: () => useUi.getState().openDialog("help"),
  },
  {
    id: "help.shortcuts",
    label: t("Keyboard shortcuts"),
    icon: "keyboard",
    run: () => useUi.getState().openDialog("shortcuts"),
  },
  { id: "help.about", label: t("About My Sweet Home"), icon: "info", run: about },
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
  if (!cameras?.length) return [{ kind: "heading", label: t("No stored points of view") }];
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
    label: t("File"),
    entries: () => [
      cmd("file.new"),
      cmd("file.open"),
      { kind: "submenu", label: t("Open recent"), icon: "open", entries: recentEntries },
      sep,
      cmd("file.save"),
      cmd("file.saveAs"),
      sep,
      {
        kind: "submenu",
        label: t("Import"),
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
    label: t("Edit"),
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
    label: t("Plan"),
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
        label: t("Walls"),
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
        label: t("Background image"),
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
    label: t("Levels"),
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
    label: t("Furniture"),
    entries: () => [
      cmd("furniture.import"),
      cmd("furniture.libraries"),
      sep,
      cmd("furniture.group"),
      cmd("furniture.ungroup"),
      sep,
      {
        kind: "submenu",
        label: t("Align"),
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
        label: t("Flip"),
        icon: "flip",
        entries: () => [cmd("edit.flipH"), cmd("edit.flipV")],
      },
      cmd("furniture.rotate"),
    ],
  },
  {
    label: t("3D view"),
    entries: () => [
      cmd("view3d.aerial"),
      cmd("view3d.visit"),
      sep,
      {
        kind: "submenu",
        label: t("Points of view"),
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
    label: t("Extensions"),
    entries: () => [cmd("plugins.manage")],
  },
  {
    label: t("Help"),
    entries: () => [
      cmd("help.guide"),
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
  // Digits choose plan tools, except while a drawing takes a typed length
  const digit = /^\d$/.test(shortcut);
  if (digit && (planActions()?.isDrawing() ?? true)) return;
  // Plain letters and Del belong to the plan view (rotate, join, delete, ...)
  if (!digit && !shortcut.includes("Ctrl+") && !/^F\d+$/.test(shortcut)) return;
  for (const c of COMMANDS.values()) {
    if (c.shortcut === shortcut && !c.shortcutElsewhere) {
      e.preventDefault();
      runCommand(c);
      return;
    }
  }
}
