// Changes of the home sent by the backend after a command (`HomePatch` in
// app/src-tauri/src/state.rs, `home_changes` in msh-core): the window applies them to the
// state it has instead of receiving the whole home again. Everything that did not change
// stays the same object, so the views redo only what changed.

import type { OpenedHome, WallShape } from "./model";

/** Changes of a list whose elements have IDs. */
export type ListPatch = {
  /** IDs of all elements in their new order, if elements were added, removed or moved */
  order?: string[];
  /** The changed and the added elements */
  changed: unknown[];
};

export type HomePatch = {
  id: number;
  /** Number of the state the changes apply to, and of the state they give */
  base: number;
  seq: number;
  path: string | null;
  modified: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoHistory: string[];
  redoHistory: string[];
  cameraMoves: number;
  changes: {
    /** Changed fields of the home with their new values */
    fields: Record<string, unknown>;
    /** Changed lists of elements by the name of their field */
    lists: Record<string, ListPatch>;
    wallShapes?: ListPatch;
  };
};

/** What the backend sends when the home changed: the whole home or the changes. */
export type HomeUpdate = OpenedHome | HomePatch;

export function isPatch(update: HomeUpdate): update is HomePatch {
  return "base" in update;
}

/** The list with the patch applied, or null if an element of the new order is unknown. */
export function patchList<T>(
  prev: T[],
  patch: ListPatch,
  idOf: (element: T) => string | null | undefined,
): T[] | null {
  const changed = new Map<string, T>();
  for (const element of patch.changed as T[]) {
    const id = idOf(element);
    if (id === null || id === undefined) return null;
    changed.set(id, element);
  }
  if (!patch.order) {
    return prev.map((element) => changed.get(idOf(element) ?? "") ?? element);
  }
  const old = new Map<string, T>();
  for (const element of prev) {
    const id = idOf(element);
    if (id !== null && id !== undefined) old.set(id, element);
  }
  const out: T[] = [];
  for (const id of patch.order) {
    const element = changed.get(id) ?? old.get(id);
    if (element === undefined) return null;
    out.push(element);
  }
  return out;
}

type WithId = { attrs: { id?: string | null } };

/**
 * The state after the changes, or null if they do not fit the state the window has (another
 * home, another state, an unknown element): the window then asks for the whole home.
 */
export function applyPatch(prev: OpenedHome, patch: HomePatch): OpenedHome | null {
  if (prev.id !== patch.id || prev.seq !== patch.base) return null;
  const home = { ...prev.home, ...patch.changes.fields } as Record<string, unknown>;
  for (const [name, list] of Object.entries(patch.changes.lists)) {
    const before = home[name];
    if (!Array.isArray(before)) return null;
    const after = patchList(before as WithId[], list, (e) => e.attrs.id);
    if (!after) return null;
    home[name] = after;
  }
  let wallShapes = prev.wallShapes;
  if (patch.changes.wallShapes) {
    const after = patchList<WallShape>(prev.wallShapes, patch.changes.wallShapes, (s) => s.id);
    if (!after) return null;
    wallShapes = after;
  }
  return {
    ...prev,
    home: home as unknown as OpenedHome["home"],
    wallShapes,
    seq: patch.seq,
    path: patch.path,
    modified: patch.modified,
    canUndo: patch.canUndo,
    canRedo: patch.canRedo,
    undoHistory: patch.undoHistory,
    redoHistory: patch.redoHistory,
    cameraMoves: patch.cameraMoves,
  };
}
