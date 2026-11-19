// Where an imported model is placed when it keeps the zero point of its file.

/**
 * Where a piece lies if the zero point of its model is put on the zero point of the plan:
 * `center` is the middle of the model's box (in its units, turned upright), `extent` the size
 * of that box and `size` the width, depth and height in cm the piece is imported with.
 */
export function originPlacement(
  center: { x: number; y: number; z: number },
  extent: { x: number; y: number; z: number },
  size: [number, number, number],
): { x: number; y: number; elevation: number } {
  const factor = (given: number, own: number) => (own > 0 ? given / own : 1);
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    x: r(center.x * factor(size[0], extent.x)),
    y: r(center.z * factor(size[1], extent.z)),
    elevation: r(center.y * factor(size[2], extent.y) - size[2] / 2),
  };
}
