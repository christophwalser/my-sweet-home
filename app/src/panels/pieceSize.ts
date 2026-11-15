// New size of a piece of furniture when one of its dimensions is changed, keeping its
// proportions when asked to (or when its model may not be deformed).

export type Size = { width: number; depth: number; height: number };
export type Dimension = keyof Size;

/**
 * Size after setting `dimension` to `value`. With `keep` all dimensions scale by the same
 * factor; with `keepWidthDepth` (models whose base may not be deformed) only width and depth
 * do, and the height stays free. Values are rounded to 0.1 cm.
 */
export function resizedPiece(
  size: Size,
  dimension: Dimension,
  value: number,
  keep: boolean,
  keepWidthDepth = false,
): Partial<Size> {
  const r = (v: number) => Math.round(v * 10) / 10;
  const old = size[dimension];
  if (!(old > 0) || !(value > 0)) return { [dimension]: r(value) };
  const f = value / old;
  if (keep) {
    return { width: r(size.width * f), depth: r(size.depth * f), height: r(size.height * f) };
  }
  if (keepWidthDepth && dimension !== "height") {
    return { width: r(size.width * f), depth: r(size.depth * f) };
  }
  return { [dimension]: r(value) };
}
