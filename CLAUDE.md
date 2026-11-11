# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

## Language policy (mandatory)

- **Chat with the user: German.** All conversation in the chat is in German.
- **Everything else: English.** This includes source code, identifiers, code comments,
  doc comments, error messages, log output, CLI output and help texts, UI strings,
  tests, scripts, README and all files in `docs/`, commit messages, PR descriptions
  and issue texts.
- **Do not translate programming terms.** Use the established English term
  (e.g. "Exception", "Commit", "Branch", "Build", "Pull Request") even in the German chat.
- UI strings are English in code and wrapped in `t()` from `app/src/i18n`
  (`t("Delete level")`, placeholders `t("Saved {pages} pages", { pages })`). German texts go
  into `app/src/i18n/de.json`, never hard-coded. `check.ps1` runs the i18n check, which fails
  on unused entries and mismatched placeholders; `node scripts/i18n-check.mjs --missing`
  (in `app/`) lists untranslated texts.
- Exceptions: test data and user content in their original language (e.g. German
  furniture names from catalog translations, `tests/corpus/private/*`).

## Project

My Sweet Home is a rewrite of Sweet Home 3D (Rust core + Tauri 2 + React/TypeScript +
three.js), file-compatible with `.sh3d`, `.sh3f` and `.sh3t`, controllable through the UI,
a CLI (`msh`) and an MCP server. Architecture and roadmap: `docs/ARCHITECTURE.md`.

Key rule: every user-facing action is implemented as a command in `msh-core`, so that UI,
CLI and MCP all get it from the same registry.

New or changed commands get tests in `crates/msh-core/tests/cmd_<module>.rs` (helpers in
`tests/common/mod.rs`); new pure frontend logic gets a `*.test.ts` next to it.

## Commands

```powershell
.\scripts\check.ps1          # rustfmt, clippy (-D warnings), Rust tests, Biome, tsc, Vitest, i18n, compat-check
cd app; pnpm test            # frontend unit tests (Vitest, src/**/*.test.ts)
.\scripts\compat-check.ps1   # verify written files with the original Sweet Home 3D reader
.\scripts\mcp-smoke.ps1      # scripted MCP session, result verified with the SH3D reader
.\scripts\live-demo.ps1      # live control of the running app (start target\debug\msh-app.exe first)
.\scripts\build-installer.ps1  # MSI installer (app, CLI and license files; no libraries)
cd app; pnpm tauri build --debug --no-bundle  # app with embedded frontend (no Vite port needed)
cd app; pnpm tauri dev       # run the desktop app
```

## Environment notes (Windows)

- Shell tools run Windows PowerShell 5.1: no `&&`; quote arguments like
  `'-Djava.awt.headless=true'`; do not name helper functions `rd`, `rm`, `del` (aliases of
  `Remove-Item`).
- Refresh `PATH` in new shells if `cargo`/`pnpm` are not found:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- Never commit library files (`.sh3f`, `.sh3t`) or files from `tests/corpus/private/`.
