// Homes opened or saved last, newest first, for "Open recent" in the File menu. Kept in the
// browser storage, which all windows of the app share.

const KEY = "msh.recentHomes";
/** Entries kept in the list */
export const MAX_RECENT = 10;

const sameFile = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function recentHomes(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function store(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // Not kept: the list stays as it was
  }
}

/** Puts a home file at the top of the list. */
export function addRecentHome(path: string): void {
  store([path, ...recentHomes().filter((p) => !sameFile(p, path))]);
}

export function removeRecentHome(path: string): void {
  store(recentHomes().filter((p) => !sameFile(p, path)));
}

export function clearRecentHomes(): void {
  store([]);
}

/** Name shown in the menu: the file name, with its folder when two files share a name. */
export function recentLabel(path: string, all: string[]): string {
  const parts = path.split(/[\\/]/);
  const name = (parts.pop() ?? path).replace(/\.sh3d$/i, "");
  const twins = all.filter(
    (p) =>
      (p.split(/[\\/]/).pop() ?? p).replace(/\.sh3d$/i, "").toLowerCase() === name.toLowerCase(),
  );
  const folder = parts.pop();
  return twins.length > 1 && folder ? `${name} (${folder})` : name;
}
