// Structural sharing for the state of the home. The backend sends the whole home after every
// change; reusing the parts that did not change keeps their identity, so views can tell with
// `===` that a piece of furniture, a wall or a whole list is the same as before and skip the
// work for it (e.g. the 3D view keeps the objects of all unchanged furniture).

type Keyed = { attrs?: { id?: unknown } };

/** ID of an element of the home (`attrs.id`), if it has one. */
function idOf(value: unknown): string | null {
  const id = (value as Keyed | null)?.attrs?.id;
  return typeof id === "string" ? id : null;
}

/**
 * `next` with every part that equals the matching part of `prev` replaced by that part of
 * `prev`. Elements of lists are matched by their ID where they have one (so adding or deleting
 * an element keeps the others), else by their position. Returns `prev` itself if nothing
 * differs.
 */
export function shareStructure<T>(prev: T, next: T): T {
  if (prev === next) return prev;
  if (typeof prev !== "object" || typeof next !== "object" || prev === null || next === null) {
    return next;
  }
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next;
    let byId: Map<string, unknown> | null = null;
    if (idOf(next[0]) !== null) {
      byId = new Map();
      for (const p of prev) {
        const id = idOf(p);
        if (id !== null) byId.set(id, p);
      }
    }
    let same = prev.length === next.length;
    const out = next.map((value, i) => {
      const id = byId ? idOf(value) : null;
      const before = id !== null ? byId?.get(id) : byId ? undefined : prev[i];
      const shared = before === undefined ? value : shareStructure(before, value);
      if (shared !== prev[i]) same = false;
      return shared;
    });
    return (same ? prev : out) as T;
  }
  if (Array.isArray(prev)) return next;
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const keys = Object.keys(n);
  let same = keys.length === Object.keys(p).length;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const shared = key in p ? shareStructure(p[key], n[key]) : n[key];
    if (!(key in p) || shared !== p[key]) same = false;
    out[key] = shared;
  }
  return (same ? prev : out) as T;
}
