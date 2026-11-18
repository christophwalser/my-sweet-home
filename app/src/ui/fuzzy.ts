// Tolerant matching for the command search: a word matches a text that contains it, or that
// contains its letters in this order ("rtwl" finds "Round walls").

/**
 * How well `word` matches `text`, both lower case: 0 for a text that starts with it, small
 * numbers for a word found inside, larger ones for letters spread over the text; null if the
 * letters do not occur in this order.
 */
export function fuzzyScore(text: string, word: string): number | null {
  if (!word) return 0;
  const at = text.indexOf(word);
  if (at === 0) return 0;
  if (at > 0) return /[\s›:,(/-]/.test(text[at - 1]) ? 1 : 2;
  let pos = -1;
  let gaps = 0;
  for (const ch of word) {
    const next = text.indexOf(ch, pos + 1);
    if (next < 0) return null;
    if (pos >= 0) gaps += next - pos - 1;
    pos = next;
  }
  return 3 + gaps;
}

/** Sum of the scores of all words of a query, or null if one of them does not match. */
export function queryScore(text: string, words: string[]): number | null {
  let sum = 0;
  for (const w of words) {
    const s = fuzzyScore(text, w);
    if (s === null) return null;
    sum += s;
  }
  return sum;
}
