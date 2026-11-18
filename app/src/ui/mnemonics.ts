// Access keys of the menu bar (Alt+letter) and choosing menu entries by their first letter.

/**
 * One access key per label: its first letter that no earlier label took, lower case. A label
 * whose letters are all taken gets none (null).
 */
export function mnemonics(labels: string[]): (string | null)[] {
  const taken = new Set<string>();
  return labels.map((label) => {
    for (const ch of label.toLowerCase()) {
      if (/\p{L}/u.test(ch) && !taken.has(ch)) {
        taken.add(ch);
        return ch;
      }
    }
    return null;
  });
}

/** The label split around its access key, for underlining it: [before, key, after]. */
export function splitAtMnemonic(label: string, key: string | null): [string, string, string] {
  const i = key ? label.toLowerCase().indexOf(key) : -1;
  return i < 0 ? [label, "", ""] : [label.slice(0, i), label.slice(i, i + 1), label.slice(i + 1)];
}

/**
 * Index of the next entry after `current` whose label starts with the typed letter, going
 * round; -1 if none does. `unique` tells that it is the only one, so it can be run at once.
 */
export function nextByLetter(
  labels: string[],
  current: number,
  letter: string,
): { index: number; unique: boolean } {
  const l = letter.toLowerCase();
  const matches = labels
    .map((label, i) => (label.trim().toLowerCase().startsWith(l) ? i : -1))
    .filter((i) => i >= 0);
  if (matches.length === 0) return { index: -1, unique: false };
  const next = matches.find((i) => i > current) ?? matches[0];
  return { index: next, unique: matches.length === 1 };
}
