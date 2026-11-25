// Size of a texture's tile from the proportions of its image.

/** Height of a tile of `width` cm for an image with this width by height (null: unknown). */
export function tileHeight(width: number, ratio: number | null): number {
  if (ratio === null || !(ratio > 0)) return width;
  return Math.round((width / ratio) * 100) / 100;
}
