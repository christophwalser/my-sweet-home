// Generates every icon of the app from the SVG masters in src-tauri/icons/source:
// - the Tauri icon set (PNGs, icon.icns) from logo.svg,
// - icon.ico (exe, window, taskbar, shortcuts) and sh3d-file.ico (.sh3d files): 16-32 px from
//   the *-small.svg masters without the dimension line, which is too fine there, 48 px and
//   larger from the full masters,
// - public/favicon.svg.
// Usage (in app/): node scripts/build-icons.mjs

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ICONS = path.resolve("src-tauri/icons");
const SOURCE = path.join(ICONS, "source");
const SMALL_SIZES = [16, 20, 24, 32];
const LARGE_SIZES = [40, 48, 64, 96, 128, 256];

function tauriIcon(svg, args = "") {
  execSync(`pnpm tauri icon "${path.join(SOURCE, svg)}" ${args}`, { stdio: "inherit" });
}

/** Renders `svg` at `sizes` and returns the PNG files by size. */
function renderPngs(svg, sizes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "msh-icons-"));
  tauriIcon(svg, `--png ${sizes.join(",")} -o "${dir}"`);
  const pngs = sizes.map((s) => ({ size: s, data: fs.readFileSync(path.join(dir, `${s}x${s}.png`)) }));
  fs.rmSync(dir, { recursive: true, force: true });
  return pngs;
}

/** Writes an ICO file with PNG-compressed images (supported since Windows Vista). */
function writeIco(file, pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  fs.writeFileSync(file, Buffer.concat([header, ...pngs.map((p) => p.data)]));
  console.log(`Wrote ${path.relative(process.cwd(), file)} (${pngs.map((p) => p.size).join(", ")} px)`);
}

function ico(file, small, large) {
  writeIco(path.join(ICONS, file), [...renderPngs(small, SMALL_SIZES), ...renderPngs(large, LARGE_SIZES)]);
}

// Tauri icon set; the mobile icons are not needed (Windows only)
tauriIcon("logo.svg");
for (const dir of ["android", "ios"]) fs.rmSync(path.join(ICONS, dir), { recursive: true, force: true });

ico("icon.ico", "logo-small.svg", "logo.svg");
ico("sh3d-file.ico", "file-sh3d-small.svg", "file-sh3d.svg");

// Cargo does not watch the icons: touching build.rs makes the next build embed the new icon.ico
const now = new Date();
fs.utimesSync(path.resolve("src-tauri/build.rs"), now, now);

fs.mkdirSync("public", { recursive: true });
fs.copyFileSync(path.join(SOURCE, "logo.svg"), path.join("public", "favicon.svg"));
console.log("Wrote public/favicon.svg");
