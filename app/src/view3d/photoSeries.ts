// Photos of several stored points of view in one go (like Sweet Home 3D's "Create photos at
// points of view"): file names of the series.

/** Characters Windows does not allow in file names (control characters are removed too). */
const INVALID = /[<>:"/\\|?*]/g;

/** `s` without control characters. */
function printable(s: string): string {
  return [...s].filter((c) => c.charCodeAt(0) >= 32).join("");
}

/**
 * Path of the photo of point of view `view` in folder `dir`: "<base> - <view>.png", made safe
 * for Windows and unique among the names in `used` (which it is added to).
 */
export function seriesFilePath(dir: string, base: string, view: string, used: Set<string>): string {
  const clean = (s: string) =>
    printable(s)
      .replace(INVALID, "_")
      .replace(/[. ]+$/, "")
      .trim() || "photo";
  const stem = `${clean(base)} - ${clean(view)}`;
  let name = `${stem}.png`;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem} (${i}).png`;
  used.add(name.toLowerCase());
  const sep = dir.endsWith("\\") || dir.endsWith("/") ? "" : "\\";
  return `${dir}${sep}${name}`;
}

/** Waits for `n` frames of the browser, so a moved 3D view has drawn its new camera. */
export function frames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(n);
  });
}
