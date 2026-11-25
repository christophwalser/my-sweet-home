// Previews of image files for the texture import.

import { api } from "../api";
import { extensionOf } from "./modelConvert";

/** Images the WebView shows as preview (TIFF and ZIP have none). */
const PREVIEW_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** Name of a file without folder and extension. */
export function fileStem(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "");
}

/**
 * URL of an image file to show (to be released by the caller) with its width by height, or null
 * if the WebView cannot show it.
 */
export async function imagePreview(
  path: string,
): Promise<{ url: string; ratio: number | null } | null> {
  const type = PREVIEW_TYPES[extensionOf(path)];
  if (!type) return null;
  try {
    const bytes = await api.readFile(path);
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      // No image, whatever its name says
      URL.revokeObjectURL(url);
      return null;
    }
    const ratio = image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : null;
    return { url, ratio };
  } catch {
    // No preview, the import still works
    return null;
  }
}
