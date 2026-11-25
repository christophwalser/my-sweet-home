// Which of the chosen or dropped files are models to import one after another.

import { extensionOf } from "./modelConvert";

/** Model formats in the order one is chosen when a model comes in several formats. */
export const MODEL_ORDER = [
  "gltf",
  "glb",
  "fbx",
  "obj",
  "dae",
  "3ds",
  "3mf",
  "kmz",
  "stl",
  "ply",
  "wrl",
  "vrml",
  "xyz",
  "asc",
];

/** Path of a file without its extension, for comparing. */
function stem(path: string): string {
  return path.replace(/\.[^.\\/]+$/, "").toLowerCase();
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * The models among `paths`, by name; a model that comes in several formats (chair.obj and
 * chair.glb in one folder) is taken once. `zips` are archives known to hold a model.
 */
export function modelQueue(paths: string[], zips: string[] = []): string[] {
  const best = new Map<string, string>();
  const rank = (p: string) => MODEL_ORDER.indexOf(extensionOf(p));
  for (const p of paths) {
    if (rank(p) < 0) continue;
    const known = best.get(stem(p));
    if (!known || rank(p) < rank(known)) best.set(stem(p), p);
  }
  return [...best.values(), ...zips].sort((a, b) =>
    fileName(a).localeCompare(fileName(b), undefined, { numeric: true }),
  );
}
