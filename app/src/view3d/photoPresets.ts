// Sizes offered for photos, the settings remembered from one photo to the next and the
// remaining time of a rendering.

import type { PhotoQuality } from "./photo";

export type PhotoPreset = { id: string; width: number; height: number };

/** Fixed sizes; "view" (the proportions of the 3D view) and "custom" are no entries here. */
export const PHOTO_PRESETS: PhotoPreset[] = [
  { id: "hd", width: 1280, height: 720 },
  { id: "fullhd", width: 1920, height: 1080 },
  { id: "4k", width: 3840, height: 2160 },
  // A4 at 300 dpi: 297 mm x 210 mm
  { id: "a4landscape", width: 3508, height: 2480 },
  { id: "a4portrait", width: 2480, height: 3508 },
];

/** ID of the preset with this size, "view" for the proportions of the view, else "custom". */
export function presetOf(width: number, height: number, keepAspect: boolean): string {
  if (keepAspect) return "view";
  return PHOTO_PRESETS.find((p) => p.width === width && p.height === height)?.id ?? "custom";
}

/** File formats a photo is saved in. */
export type PhotoFormat = "png" | "jpeg";

export type PhotoSettings = {
  width: number;
  height: number;
  /** The height follows the proportions of the 3D view */
  keepAspect: boolean;
  quality: PhotoQuality;
  format: PhotoFormat;
};

const KEY = "msh.photo";
const QUALITIES: PhotoQuality[] = ["draft", "good", "best"];

/** Settings of the last photo, or the defaults for a view of the given proportions. */
export function loadPhotoSettings(viewAspect: number, raw = read()): PhotoSettings {
  const fallback: PhotoSettings = {
    width: 1600,
    height: Math.round(1600 / viewAspect),
    keepAspect: true,
    quality: "good",
    format: "png",
  };
  try {
    const v = JSON.parse(raw ?? "") as Partial<PhotoSettings>;
    const size = (n: unknown) => typeof n === "number" && n >= 16 && n <= 8000;
    if (!size(v.width) || !size(v.height)) return fallback;
    const width = v.width as number;
    const keepAspect = v.keepAspect !== false;
    return {
      width,
      height: keepAspect ? Math.max(16, Math.round(width / viewAspect)) : (v.height as number),
      keepAspect,
      quality: QUALITIES.includes(v.quality as PhotoQuality) ? (v.quality as PhotoQuality) : "good",
      format: v.format === "jpeg" ? "jpeg" : "png",
    };
  } catch {
    return fallback;
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function savePhotoSettings(settings: PhotoSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the settings apply until the window is closed
  }
}

/**
 * Seconds a rendering still takes, from the time it ran and its progress (0..1). Null while
 * too little is done to tell.
 */
export function remainingSeconds(elapsedMs: number, progress: number): number | null {
  if (!(progress >= 0.03) || progress >= 1 || elapsedMs < 1500) return null;
  return Math.max(1, Math.round((elapsedMs / 1000) * ((1 - progress) / progress)));
}

/** Seconds as "45 s" or "3:05 min". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} min`;
}

/** Whether a path asks for a JPEG file. */
export function isJpegPath(path: string): boolean {
  return /\.jpe?g$/i.test(path);
}

/** File extension of a format. */
export function formatExtension(format: PhotoFormat): string {
  return format === "jpeg" ? "jpg" : "png";
}

/**
 * The path a photo of this format is saved to: a name without the extension of the format
 * gets it (the dialog of Windows keeps a typed ".png" when JPEG is chosen).
 */
export function pathForFormat(path: string, format: PhotoFormat): string {
  if (format === "jpeg") return isJpegPath(path) ? path : `${path.replace(/\.png$/i, "")}.jpg`;
  return /\.png$/i.test(path) ? path : `${path.replace(/\.jpe?g$/i, "")}.png`;
}
