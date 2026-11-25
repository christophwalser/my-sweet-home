// Changing catalog items and libraries: the actions shared by the catalog in the side bar and
// the library editor (the same context menu in both). Every change is a library_* command
// of msh-core, so it can be undone with library_undo and the catalog reloads afterwards.

import { api, type CatalogData, type CatalogItem, type LibraryInfo } from "../api";
import { errorText } from "../errorText";
import { language, t } from "../i18n";
import type { MenuItem } from "../plan2d/ContextMenu";
import { useStore } from "../store";
import { askConfirm, askText } from "../ui/ask";
import { useUi } from "../ui/uiStore";

/** Result of a library change, with the labels of the next undo and redo steps. */
export type History = { undo: string | null; redo: string | null };

export function libraryOf(item: CatalogItem, data: CatalogData | null): LibraryInfo | undefined {
  return data?.libraries.find((l) => l.index === item.library);
}

/** Name of a library as shown (its name, else its file name). */
export function libraryName(lib: LibraryInfo | undefined): string {
  if (!lib) return "";
  if (lib.name) return lib.name;
  const file = lib.path.split(/[\\/]/).pop() ?? lib.path;
  return /^(Furniture|Textures)\.jar$/i.test(file) ? t("Default catalog") : file;
}

/** Names of the steps of the library history (the core reports them in English). */
const HISTORY_LABELS: Record<string, () => string> = {
  "change item": () => t("change item"),
  "change items": () => t("change items"),
  "move items": () => t("move items"),
  "copy items": () => t("copy items"),
  "move to library": () => t("move to library"),
  "remove items": () => t("delete items"),
  "rename library": () => t("rename library"),
  "create library": () => t("create library"),
  "remove library": () => t("delete library"),
  import: () => t("import"),
  "change icon": () => t("change icon"),
  "add from home": () => t("import from the home"),
};

export function historyLabel(label: string | null | undefined): string {
  if (!label) return "–";
  return HISTORY_LABELS[label]?.() ?? label;
}

/** Categories of the catalog of a kind plus the ones created in `path` (sorted). */
export async function categoriesFor(
  kind: CatalogItem["kind"],
  path: string | null,
): Promise<string[]> {
  const all = useStore.getState().catalogAll;
  const set = new Set((all?.items ?? []).filter((i) => i.kind === kind).map((i) => i.category));
  if (path) {
    try {
      const r = (await api.execute("library_categories", { path, lang: language() })) as {
        categories: string[];
      };
      for (const c of r.categories) set.add(c);
    } catch {
      // Unknown library: only the catalog's categories
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Asks for the name of a new category; null when cancelled. */
export function askCategoryName(): Promise<string | null> {
  return askText({ title: t("New category"), label: t("Name"), confirm: t("Create") });
}

/** An item with the library it is in. */
export type Target = { item: CatalogItem; lib: LibraryInfo };

/** The items per library: each library is changed by a command of its own. */
export function byLibrary(targets: Target[]): { path: string; items: CatalogItem[] }[] {
  const groups = new Map<string, CatalogItem[]>();
  for (const { item, lib } of targets) {
    const list = groups.get(lib.path);
    if (list) list.push(item);
    else groups.set(lib.path, [item]);
  }
  return [...groups].map(([path, items]) => ({ path, items }));
}

/**
 * Runs a command for the items of each library; returns the steps of the library history it
 * takes to undo them.
 */
export async function runForItems(
  command: string,
  targets: Target[],
  params: Record<string, unknown>,
): Promise<number> {
  const groups = byLibrary(targets);
  for (const { path, items } of groups)
    await api.execute(command, { path, indexes: items.map((i) => i.index), ...params });
  return groups.length;
}

/**
 * Copies items into the user's own library, into the library `to`, or ("duplicate") into their
 * own library under a new name. Returns the copies and the steps to undo.
 */
async function copyItems(
  targets: Target[],
  to: string | "own" | "duplicate",
  move = false,
): Promise<{ copies: { path: string; index: number }[]; steps: number }> {
  const groups = byLibrary(targets);
  const copies: { path: string; index: number }[] = [];
  for (const { path, items } of groups) {
    const r = (await api.execute("library_copy_items", {
      from: path,
      indexes: items.map((i) => i.index),
      ...(to === "duplicate"
        ? {
            to: path,
            names: items.map((i) => t("{name} (copy)", { name: i.name })),
            lang: language(),
          }
        : to === "own"
          ? {}
          : { to, move }),
    })) as { to: string; indexes: number[] };
    copies.push(...r.indexes.map((index) => ({ path: r.to, index })));
  }
  return { copies, steps: groups.length };
}

/** Undoes the last `steps` changes of libraries; returns the label of the last one undone. */
export async function undoLibrary(steps = 1): Promise<string | null> {
  let label: string | null = null;
  for (let i = 0; i < steps; i++) {
    label = ((await api.execute("library_undo")) as { undone: string | null }).undone;
  }
  return label;
}

/** Key of an item in the editor's selection. */
export function itemKey(path: string, index: number): string {
  return `${path}|${index}`;
}

/** Opens the library editor, optionally at an item. */
export function openEditor(path?: string, index?: number): void {
  useUi
    .getState()
    .openDialog("libraries", path && index !== undefined ? itemKey(path, index) : undefined);
}

/** Callbacks the context menu needs from where it is shown. */
export type MenuContext = {
  /** Shows a message; `steps`: undo steps of the library history its Undo button takes back */
  notify: (message: string, steps?: number) => void;
  /** The catalog in the side bar places furniture in the plan */
  place?: () => void;
  /** The catalog in the side bar replaces the selected furniture by the item */
  replace?: () => void;
  /** The catalog in the side bar gives a texture to the selected elements */
  apply?: () => void;
  /** The catalog in the side bar marks favorites */
  favorite?: { on: boolean; toggle: () => void };
  /** Shows items in the editor (the editor selects them, the catalog opens the editor) */
  edit: (items: { path: string; index: number }[]) => void;
  /** Called when the items were deleted */
  deleted?: () => void;
  /** Called when the items are in another library, with their place there */
  moved?: (items: { path: string; index: number }[]) => void;
};

/** Entries of an item's context menu in the catalog. */
export function itemMenu(
  item: CatalogItem,
  lib: LibraryInfo | undefined,
  categories: string[],
  ctx: MenuContext,
): MenuItem[] {
  const entries: MenuItem[] = [];
  if (ctx.place) {
    entries.push({ label: t("Place in the home"), shortcut: "Enter", action: ctx.place });
  }
  if (ctx.apply) {
    entries.push({ label: t("Apply to the selection"), shortcut: "Enter", action: ctx.apply });
  }
  if (ctx.replace) {
    entries.push({ label: t("Replace the selection with this"), action: ctx.replace });
  }
  if (ctx.favorite) {
    entries.push({
      label: ctx.favorite.on ? t("Remove from the favorites") : t("Add to the favorites"),
      action: ctx.favorite.toggle,
    });
  }
  if (!lib) return entries;
  if (entries.length > 0) entries.push({ separator: true });
  return [...entries, ...itemsMenu([{ item, lib }], categories, ctx)];
}

/** The entry "Move to" with the categories; `moveMenu` of the properties shows it alone. */
export function moveMenu(targets: Target[], categories: string[], ctx: MenuContext): MenuItem[] {
  const [first] = targets;
  const move = (category: string) =>
    void runForItems("library_move_items", targets, { category, lang: language() })
      .then((steps) =>
        ctx.notify(
          targets.length === 1
            ? t("“{name}” moved to {category}", { name: first.item.name, category })
            : t("{n} items moved to {category}", { n: targets.length, category }),
          steps,
        ),
      )
      .catch((e) => ctx.notify(errorText(e)));
  return [
    ...categories.map((c): MenuItem => {
      const current = targets.every(({ item }) => item.category === c);
      return {
        label: c,
        note: current ? t("current") : undefined,
        disabled: current,
        action: () => move(c),
      };
    }),
    { separator: true },
    {
      label: t("New category…"),
      action: () => void askCategoryName().then((name) => name && move(name)),
    },
  ];
}

/** Copies items of the installation into the user's own library and shows the copies. */
export function editAsCopy(targets: Target[], ctx: MenuContext): void {
  void copyItems(targets, "own")
    .then(({ copies, steps }) => {
      ctx.notify(
        targets.length === 1
          ? t("“{name}” was copied into your library", { name: targets[0].item.name })
          : t("{n} items were copied into your library", { n: targets.length }),
        steps,
      );
      ctx.edit(copies);
    })
    .catch((e) => ctx.notify(errorText(e)));
}

/** Duplicates items in their library and shows the copies. */
export function duplicateItems(targets: Target[], ctx: MenuContext): void {
  void copyItems(targets, "duplicate")
    .then(({ copies, steps }) => {
      ctx.notify(
        targets.length === 1
          ? t("“{name}” was duplicated", { name: targets[0].item.name })
          : t("{n} items were duplicated", { n: targets.length }),
        steps,
      );
      ctx.edit(copies);
    })
    .catch((e) => ctx.notify(errorText(e)));
}

/** Deletes items from their library after a question. */
export async function deleteItems(targets: Target[], ctx: MenuContext): Promise<void> {
  const [first] = targets;
  const sure = await askConfirm({
    title:
      targets.length === 1
        ? t("Delete “{name}” from the library?", { name: first.item.name })
        : t("Delete {n} items from the library?", { n: targets.length }),
    message: t("Homes keep the furniture and textures they use. Undo brings the items back."),
    confirm: t("Delete"),
    danger: true,
  });
  if (!sure) return;
  try {
    const steps = await runForItems("library_remove_items", targets, {});
    ctx.notify(
      targets.length === 1
        ? t("“{name}” was deleted", { name: first.item.name })
        : t("{n} items were deleted", { n: targets.length }),
      steps,
    );
    ctx.deleted?.();
  } catch (e) {
    ctx.notify(errorText(e));
  }
}

/** The libraries items of these can be copied to (not their own ones). */
function copyTargets(targets: Target[]): LibraryInfo[] {
  const own = new Set(targets.map(({ lib }) => lib.path));
  const found = new Map<string, LibraryInfo>();
  for (const l of useStore.getState().catalogAll?.libraries ?? []) {
    if (l.editable && l.kind === targets[0].item.kind && !own.has(l.path) && !found.has(l.path))
      found.set(l.path, l);
  }
  return [...found.values()];
}

/** The entry "Copy to library" with the libraries, or nothing when there is none. */
export function copyMenu(targets: Target[], ctx: MenuContext): MenuItem[] {
  return copyTargets(targets).map((l): MenuItem => {
    const library = libraryName(l);
    return {
      label: library,
      action: () =>
        void copyItems(targets, l.path)
          .then(({ steps }) =>
            ctx.notify(
              targets.length === 1
                ? t("“{name}” was copied to “{library}”", { name: targets[0].item.name, library })
                : t("{n} items were copied to “{library}”", { n: targets.length, library }),
              steps,
            ),
          )
          .catch((e) => ctx.notify(errorText(e))),
    };
  });
}

/** The entry "Move to library": as copying, but the items leave their library. */
export function transferMenu(targets: Target[], ctx: MenuContext): MenuItem[] {
  return copyTargets(targets).map((l): MenuItem => {
    const library = libraryName(l);
    return {
      label: library,
      action: () =>
        void copyItems(targets, l.path, true)
          .then(({ copies, steps }) => {
            ctx.notify(
              targets.length === 1
                ? t("“{name}” was moved to “{library}”", { name: targets[0].item.name, library })
                : t("{n} items were moved to “{library}”", { n: targets.length, library }),
              steps,
            );
            ctx.moved?.(copies);
          })
          .catch((e) => ctx.notify(errorText(e))),
    };
  });
}

/**
 * Entries of the context menu of one or several items. Read-only items (libraries of the
 * installation) can only be copied, to be edited in the user's own library.
 */
export function itemsMenu(targets: Target[], categories: string[], ctx: MenuContext): MenuItem[] {
  const several = targets.length > 1;
  const entries: MenuItem[] = [];
  if (several) entries.push({ heading: t("{n} items", { n: targets.length }) });
  const editable = targets.filter(({ lib }) => lib.editable).length;
  const copies = copyMenu(targets, ctx);
  const copyEntry: MenuItem[] =
    copies.length > 0 ? [{ label: t("Copy to library"), items: copies }] : [];
  if (editable === 0) {
    entries.push({ label: t("Edit as copy…"), action: () => editAsCopy(targets, ctx) });
    return entries;
  }
  if (editable < targets.length) {
    return [...entries, ...copyEntry, { heading: t("Some of the items are read-only") }];
  }
  if (!several) {
    const [{ item, lib }] = targets;
    entries.push({
      label: t("Edit…"),
      action: () => ctx.edit([{ path: lib.path, index: item.index }]),
    });
  }
  entries.push({ label: t("Move to"), items: moveMenu(targets, categories, ctx) });
  entries.push(...copyEntry);
  const transfers = transferMenu(targets, ctx);
  if (transfers.length > 0) entries.push({ label: t("Move to library"), items: transfers });
  entries.push({
    label: t("Duplicate"),
    shortcut: "Ctrl+D",
    action: () => duplicateItems(targets, ctx),
  });
  entries.push({ separator: true });
  entries.push({
    label: t("Delete…"),
    shortcut: "Del",
    danger: true,
    action: () => void deleteItems(targets, ctx),
  });
  return entries;
}
