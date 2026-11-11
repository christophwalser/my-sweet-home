// Collects the licenses of all third-party components shipped in the release artifacts:
// Rust crates linked into the app and the CLI (normal dependencies for the Windows target)
// and the npm packages bundled into the frontend (production dependencies).
//
// Usage from the repository root:  node scripts/third-party-notices.mjs <output file>

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const out = process.argv[2];
if (!out) {
  console.error("Usage: node scripts/third-party-notices.mjs <output file>");
  process.exit(2);
}

const TARGET = "x86_64-pc-windows-msvc";
const SHIPPED_CRATES = ["msh-app", "msh-cli"];
const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright|unlicense|authors)([-_.].*)?$/i;

// Constant arguments only (no user input): pnpm is a .cmd shim on Windows and needs a shell
function run(command, cwd) {
  return execSync(command, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function licenseTexts(dir) {
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return names
    .filter((e) => e.isFile() && LICENSE_FILE.test(e.name))
    .map((e) => e.name)
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8").replace(/\r\n/g, "\n").trim() }));
}

// ------------------------------------------------------------------ Rust

function rustComponents() {
  const meta = JSON.parse(
    run(`cargo metadata --format-version 1 --locked --filter-platform ${TARGET}`, root),
  );
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const workspace = new Set(meta.workspace_members);
  const start = meta.packages.filter((p) => SHIPPED_CRATES.includes(p.name)).map((p) => p.id);
  if (start.length !== SHIPPED_CRATES.length) throw new Error("shipped crates not found");

  const seen = new Set();
  const queue = [...start];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      // Normal dependencies only: build scripts and dev dependencies are not shipped
      if (dep.dep_kinds.some((k) => k.kind === null)) queue.push(dep.pkg);
    }
  }
  return [...seen]
    .filter((id) => !workspace.has(id))
    .map((id) => byId.get(id))
    .map((p) => ({
      kind: "Rust crate",
      name: p.name,
      version: p.version,
      license: p.license ?? (p.license_file ? `see ${p.license_file}` : "unknown"),
      url: p.repository ?? p.homepage ?? `https://crates.io/crates/${p.name}`,
      texts: licenseTexts(dirname(p.manifest_path)),
    }));
}

// ------------------------------------------------------------------ npm

function npmComponents() {
  const app = join(root, "app");
  const list = JSON.parse(run("pnpm licenses list --prod --json", app));
  const result = [];
  for (const [license, packages] of Object.entries(list)) {
    for (const p of packages) {
      p.versions.forEach((version, i) => {
        result.push({
          kind: "npm package",
          name: p.name,
          version,
          license,
          url: p.homepage ?? `https://www.npmjs.com/package/${p.name}`,
          texts: licenseTexts(p.paths[i] ?? p.paths[0]),
        });
      });
    }
  }
  return result;
}

// ------------------------------------------------------------------ output

const components = [...rustComponents(), ...npmComponents()].sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);

// Identical license texts (e.g. the Apache-2.0 text) are printed once and referenced
const uniqueTexts = new Map();
for (const c of components) {
  c.refs = c.texts.map((t) => {
    if (!uniqueTexts.has(t.text)) uniqueTexts.set(t.text, uniqueTexts.size + 1);
    return { name: t.name, id: uniqueTexts.get(t.text) };
  });
}

const rule = "=".repeat(78);
const lines = [
  "THIRD-PARTY NOTICES",
  rule,
  "",
  "My Sweet Home is licensed under the GNU General Public License version 3 or later",
  "(see LICENSE). It contains the following third-party components, each under its own",
  "license. Identical license texts are listed once at the end and referenced by number.",
  "",
  `${components.length} components`,
  "",
];
for (const c of components) {
  lines.push(rule, `${c.name} ${c.version} (${c.kind})`, `License: ${c.license}`, `Source:  ${c.url}`);
  if (c.refs.length) {
    lines.push(`License texts: ${c.refs.map((r) => `${r.name} [${r.id}]`).join(", ")}`);
  } else {
    lines.push("License text: not included in the package; see the SPDX license list at https://spdx.org/licenses/");
  }
  lines.push("");
}
lines.push(rule, "LICENSE TEXTS", rule, "");
for (const [text, id] of uniqueTexts) {
  lines.push(`[${id}]`, "-".repeat(78), text, "");
}

mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(out, `${lines.join("\n")}\n`);
const missing = components.filter((c) => !c.refs.length);
console.log(
  `${out}: ${components.length} components, ${uniqueTexts.size} distinct license texts` +
    (missing.length ? `, ${missing.length} without license file: ${missing.map((c) => c.name).join(", ")}` : ""),
);
