// Changing catalog items and libraries: the actions shared by the catalog in the side bar and
// the library editor (the same context menu in both). Every change is a library_* command
// of msh-core, so it can be undone with library_undo and the catalog reloads afterwards.

import { api, type CatalogData, type CatalogItem, type LibraryInfo } from "../api";
import { language, t } from "../i18n";
import type { MenuItem } from "../plan2d/ContextMenu";
import { useStore } from "../store";
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
  "move items": () => t("move items"),
  "copy items": () => t("copy items"),
  "remove items": () => t("remove items"),
  "rename library": () => t("rename library"),
  "create library": () => t("create library"),
  import: () => t("import"),
  "change icon": () => t("change icon"),
  "add from home": () => t("add from home"),
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
export function askCategoryName(): string | null {
  const name = window.prompt(t("Name of the new category"), "")?.trim();
  return name ? name : null;
}

export async function moveItems(path: string, indexes: number[], category: string) {
  return api.execute("library_move_items", { path, indexes, category, lang: language() });
}

/** Copies an item into the user's own library (or `to`) and returns the copy's index. */
export async function copyItem(
  item: CatalogItem,
  from: string,
  to?: string,
  name?: string,
): Promise<{ to: string; index: number }> {
  const r = (await api.execute("library_copy_items", {
    from,
    indexes: [item.index],
    ...(to ? { to } : {}),
    ...(name ? { name, lang: language() } : {}),
  })) as { to: string; indexes: number[] };
  return { to: r.to, index: r.indexes[0] };
}

export async function removeItems(path: string, indexes: number[]) {
  return api.execute("library_remove_items", { path, indexes });
}

export async function undoLibrary(): Promise<string | null> {
  const r = (await api.execute("library_undo")) as { undone: string | null };
  return r.undone;
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
  /** Shows a message with an optional undo button */
  notify: (message: string, undo?: boolean) => void;
  /** The catalog in the side bar places furniture in the plan */
  place?: () => void;
  /** The catalog in the side bar replaces the selected furniture by the item */
  replace?: () => void;
  /** The catalog in the side bar gives a texture to the selected elements */
  apply?: () => void;
  /** The catalog in the side bar marks favorites */
  favorite?: { on: boolean; toggle: () => void };
  /** Opens an item in the editor (the editor selects it, the catalog opens the editor) */
  edit: (path: string, index: number) => void;
};

/**
 * Entries of an item's context menu. Read-only items (libraries of the installation) can only
 * be added to the home or edited as a copy in the user's own library.
 */
export function itemMenu(
  item: CatalogItem,
  lib: LibraryInfo | undefined,
  categories: string[],
  ctx: MenuContext,
): MenuItem[] {
  const entries: MenuItem[] = [];
  if (ctx.place) {
    entries.push({ label: t("Place in the plan"), shortcut: "Enter", action: ctx.place });
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
  if (entries.length > 0 && lib) entries.push({ separator: true });
  if (!lib) return entries;
  const fail = (e: unknown) => ctx.notify(String(e));
  if (!lib.editable) {
    entries.push({
      label: t("Edit as copy…"),
      action: () =>
        void copyItem(item, lib.path)
          .then((c) => {
            ctx.notify(t("“{name}” was copied into your library", { name: item.name }), true);
            ctx.edit(c.to, c.index);
          })
          .catch(fail),
    });
    return entries;
  }
  entries.push({ label: t("Edit…"), action: () => ctx.edit(lib.path, item.index) });
  const move = (category: string) =>
    void moveItems(lib.path, [item.index], category)
      .then(() =>
        ctx.notify(t("“{name}” moved to {category}", { name: item.name, category }), true),
      )
      .catch(fail);
  entries.push({
    label: t("Move to"),
    items: [
      ...categories.map(
        (c): MenuItem => ({
          label: c,
          note: c === item.category ? t("current") : undefined,
          disabled: c === item.category,
          action: () => move(c),
        }),
      ),
      { separator: true },
      {
        label: t("New category…"),
        action: () => {
          const name = askCategoryName();
          if (name) move(name);
        },
      },
    ],
  });
  entries.push({
    label: t("Duplicate"),
    shortcut: "Ctrl+D",
    action: () =>
      void copyItem(item, lib.path, lib.path, t("{name} (copy)", { name: item.name }))
        .then((c) => {
          ctx.notify(t("“{name}” was duplicated", { name: item.name }), true);
          ctx.edit(c.to, c.index);
        })
        .catch(fail),
  });
  entries.push({ separator: true });
  entries.push({
    label: t("Delete"),
    shortcut: "Delete",
    danger: true,
    action: () => {
      if (!window.confirm(t("Delete “{name}” from the library?", { name: item.name }))) return;
      void removeItems(lib.path, [item.index])
        .then(() => ctx.notify(t("“{name}” was deleted", { name: item.name }), true))
        .catch(fail);
    },
  });
  return entries;
}
