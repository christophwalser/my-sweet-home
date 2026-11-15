// Checks the translation files against the texts in the code: every t("...") key of the
// frontend, entries that are no longer used, and placeholders ({name}) that differ.
// Usage (in app/): node scripts/i18n-check.mjs [--missing]
//   --missing  also lists texts without translation (they show in English)

import fs from "node:fs";
import path from "node:path";
// The parser of Vite (oxc): TypeScript 7 has no JavaScript compiler API any more
import { parseAst } from "vite";

const SRC = path.resolve("src");
const LANGUAGES = ["de", "fr", "it"];
/** Texts that stay the same in every language (names, units, shortcuts of other keys). */
const SAME = new Set(["My Sweet Home", "Sweet Home 3D", "Sweet Home 3D (Store)", "Tab", "cm", "cm ·", "km/h", "px", "px ·"]);

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return files(p);
    // Unit tests (*.test.ts) call t() with test texts, not with texts of the user interface
    return /\.(ts|tsx)$/.test(d.name) && !/\.test\.ts$/.test(d.name) ? [p] : [];
  });
}

/** All texts passed to t(): string literals, also both branches of a condition. */
function collectKeys() {
  const keys = new Set();
  const add = (e) => {
    if (!e) return;
    if (e.type === "Literal" && typeof e.value === "string") keys.add(e.value);
    else if (e.type === "TemplateLiteral" && e.expressions.length === 0) {
      keys.add(e.quasis[0].value.cooked);
    } else if (e.type === "ConditionalExpression") {
      add(e.consequent);
      add(e.alternate);
    } else if (e.type === "ParenthesizedExpression") add(e.expression);
  };
  const visit = (n) => {
    if (Array.isArray(n)) {
      for (const c of n) visit(c);
      return;
    }
    if (!n || typeof n !== "object") return;
    if (n.type === "CallExpression" && n.callee?.type === "Identifier" && n.callee.name === "t") {
      add(n.arguments[0]);
    }
    for (const [k, v] of Object.entries(n)) {
      if (k !== "parent" && v && typeof v === "object") visit(v);
    }
  };
  for (const file of files(SRC)) {
    const src = fs.readFileSync(file, "utf8");
    visit(parseAst(src, { lang: file.endsWith("x") ? "tsx" : "ts" }));
  }
  return keys;
}

const placeholders = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
const keys = collectKeys();
let errors = 0;
for (const lang of LANGUAGES) {
  const table = JSON.parse(fs.readFileSync(path.join(SRC, "i18n", `${lang}.json`), "utf8"));
  for (const [key, value] of Object.entries(table)) {
    if (!keys.has(key)) {
      console.log(`${lang}: unused entry ${JSON.stringify(key)}`);
      errors++;
    } else if (placeholders(key) !== placeholders(value)) {
      console.log(`${lang}: placeholders differ in ${JSON.stringify(key)}`);
      errors++;
    }
  }
  const missing = [...keys].filter((k) => !(k in table) && !SAME.has(k));
  if (process.argv.includes("--missing")) {
    for (const k of missing) console.log(`${lang}: missing ${JSON.stringify(k)}`);
  }
  console.log(`${lang}: ${Object.keys(table).length} entries, ${missing.length} texts untranslated`);
}
process.exit(errors > 0 ? 1 : 0);
