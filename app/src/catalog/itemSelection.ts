// Selection of items in the library editor: a click selects one, Ctrl+click adds or takes out
// one, Shift+click selects from the anchor to the clicked item; the arrow keys walk the list.

export type ItemSelection = {
  /** Keys of the selected items (see itemKey), in the order they were selected */
  keys: string[];
  /** The item clicked or walked to last; it has the focus and its properties are shown */
  primary: string | null;
  /** Where a range starts */
  anchor: string | null;
};

export const NO_ITEMS: ItemSelection = { keys: [], primary: null, anchor: null };

export function selectOnly(key: string | null): ItemSelection {
  return key === null ? NO_ITEMS : { keys: [key], primary: key, anchor: key };
}

export function selectAll(order: string[], sel: ItemSelection): ItemSelection {
  if (order.length === 0) return NO_ITEMS;
  const primary = sel.primary !== null && order.includes(sel.primary) ? sel.primary : order[0];
  return { keys: [...order], primary, anchor: order[0] };
}

/** The keys from `a` to `b` in the list, in its order. */
function range(order: string[], a: string, b: string): string[] {
  const [i, j] = [order.indexOf(a), order.indexOf(b)];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** A click on `key` in the list of the shown keys `order`. */
export function clickItem(
  sel: ItemSelection,
  order: string[],
  key: string,
  mods: { shiftKey?: boolean; ctrlKey?: boolean },
): ItemSelection {
  const { anchor } = sel;
  if (mods.shiftKey && anchor !== null && order.includes(anchor)) {
    const keys = range(order, anchor, key);
    const before = mods.ctrlKey ? sel.keys.filter((k) => !keys.includes(k)) : [];
    return { keys: [...before, ...keys], primary: key, anchor };
  }
  if (!mods.ctrlKey) return selectOnly(key);
  if (!sel.keys.includes(key)) return { keys: [...sel.keys, key], primary: key, anchor: key };
  const keys = sel.keys.filter((k) => k !== key);
  return { keys, primary: keys[keys.length - 1] ?? null, anchor: key };
}

/** One step up or down (or to an end of the list) with the arrow keys; Shift selects a range. */
export function walkItems(
  sel: ItemSelection,
  order: string[],
  to: "up" | "down" | "first" | "last",
  shiftKey: boolean,
): ItemSelection {
  if (order.length === 0) return sel;
  const at = sel.primary === null ? -1 : order.indexOf(sel.primary);
  const last = order.length - 1;
  const next =
    to === "first"
      ? 0
      : to === "last"
        ? last
        : to === "up"
          ? Math.max(0, at < 0 ? last : at - 1)
          : Math.min(last, at + 1);
  return clickItem(sel, order, order[next], { shiftKey });
}

/** The item to select after the selected ones are deleted: the next one, else the one before. */
export function afterRemoval(order: string[], removed: string[]): string | null {
  const gone = new Set(removed);
  const first = order.findIndex((k) => gone.has(k));
  if (first < 0) return null;
  const next = order.slice(first).find((k) => !gone.has(k));
  return next ?? (first > 0 ? order[first - 1] : null);
}

/** The value all items share, or null when they differ. */
export function sharedValue<T>(items: T[], value: (item: T) => string): string | null {
  if (items.length === 0) return null;
  const first = value(items[0]);
  return items.every((i) => value(i) === first) ? first : null;
}
