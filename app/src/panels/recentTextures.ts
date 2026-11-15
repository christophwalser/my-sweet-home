// Textures chosen last, offered first in the texture chooser.

/** Number of textures kept. */
export const RECENT_TEXTURES = 5;

/**
 * The list after choosing `id`: it moves to the front (once only), and the texture chosen the
 * longest ago drops out when there are more than `max`.
 */
export function addRecent(list: string[], id: string, max = RECENT_TEXTURES): string[] {
  if (!id) return list;
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}
