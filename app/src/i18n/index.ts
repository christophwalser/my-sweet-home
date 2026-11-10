// Translations of the user interface. UI strings are English in the code and are their own
// keys (like gettext): `t("Save as…")`. Translation files map them to other languages; a
// missing entry shows the English text. Placeholders are written {name}:
// `t("Delete the level \"{name}\"?", { name })`.
//
// Changing the language reloads the windows, so texts built when a module loads (menus,
// option lists) are translated too.

import de from "./de.json";

export type Language = "en" | "de";
export type LanguageChoice = "system" | Language;

export const LANGUAGES: { id: LanguageChoice; label: string }[] = [
  { id: "system", label: "Like Windows" },
  { id: "en", label: "English" },
  { id: "de", label: "Deutsch" },
];

const TRANSLATIONS: Record<Language, Record<string, string>> = {
  en: {},
  de: de as Record<string, string>,
};

const KEY = "msh.language";

/** The language chosen in the preferences (or "system"). */
export function languageChoice(): LanguageChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "en" || v === "de" ? v : "system";
  } catch {
    return "system";
  }
}

function resolve(choice: LanguageChoice): Language {
  if (choice !== "system") return choice;
  return navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
}

let current: Language = resolve(languageChoice());

/** Language of the user interface. */
export function language(): Language {
  return current;
}

/**
 * BCP 47 locale for number and date formats: the system's region when it speaks the language
 * of the user interface (de-CH keeps its decimal point), otherwise a default region.
 */
export function locale(): string {
  const system = navigator.language;
  if (system.toLowerCase().startsWith(current)) return system;
  return current === "de" ? "de-DE" : "en-US";
}

/** Sets the language and reloads all windows of the app (they share the local storage). */
export function setLanguage(choice: LanguageChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage unavailable: the language applies until the window is closed
  }
  current = resolve(choice);
  window.location.reload();
}

/** Reloads this window when another window changed the language. */
export function followLanguage(): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY && resolve(languageChoice()) !== current) window.location.reload();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/** The text in the language of the user interface, with {placeholders} filled in. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const translated = TRANSLATIONS[current][text] || text;
  if (!vars) return translated;
  return translated.replace(/\{(\w+)\}/g, (all, name: string) =>
    name in vars ? String(vars[name]) : all,
  );
}

/** Number formats by locale and decimals: creating one per call is slow in long lists. */
const numberFormats = new Map<string, Intl.NumberFormat>();

/** A number in the format of the language (decimal comma in German), without grouping. */
export function formatNumber(value: number, maxDecimals = 2, minDecimals = 0): string {
  const loc = locale();
  const key = `${loc}|${maxDecimals}|${minDecimals}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(loc, {
      maximumFractionDigits: maxDecimals,
      minimumFractionDigits: minDecimals,
      useGrouping: false,
    });
    numberFormats.set(key, format);
  }
  return format.format(value);
}

/** A date and time in the format of the language. */
export function formatDateTime(date: Date): string {
  return date.toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
}

/** Names of keys in shortcuts as shown in the language (Ctrl → Strg in German). */
const KEY_NAMES: Record<Language, Record<string, string>> = {
  en: {},
  de: { Ctrl: "Strg", Shift: "Umschalt", Del: "Entf", Esc: "Esc", Space: "Leertaste" },
};

/** A shortcut like "Ctrl+Shift+S" in the notation of the language. */
export function formatShortcut(shortcut: string): string {
  const names = KEY_NAMES[current];
  return shortcut
    .split("+")
    .map((part) => names[part] ?? part)
    .join("+")
    .replace(/\+\+$/, "++");
}
