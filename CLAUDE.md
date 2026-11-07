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
- UI strings are English in code. A German translation is provided later through the
  i18n layer (translation files), never by hard-coding German strings.
- Exceptions: test data and user content in their original language (e.g. German
  furniture names from catalog translations, `tests/corpus/private/*`).

## Project

My Sweet Home is a rewrite of Sweet Home 3D (Rust core + Tauri 2 + React/TypeScript +
three.js), file-compatible with `.sh3d`, `.sh3f` and `.sh3t`, controllable through the UI,
a CLI (`msh`) and an MCP server. Architecture and roadmap: `docs/ARCHITECTURE.md`.

Key rule: every user-facing action is implemented as a command in `msh-core`, so that UI,
CLI and MCP all get it from the same registry.

## Commands

```powershell
.\scripts\check.ps1          # rustfmt, clippy (-D warnings), tests, Biome, tsc
.\scripts\compat-check.ps1   # verify written files with the original Sweet Home 3D reader
cd app; pnpm tauri dev       # run the desktop app
```

## Environment notes (Windows)

- Shell tools run Windows PowerShell 5.1: no `&&`; quote arguments like
  `'-Djava.awt.headless=true'`; do not name helper functions `rd`, `rm`, `del` (aliases of
  `Remove-Item`).
- Refresh `PATH` in new shells if `cargo`/`pnpm` are not found:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- Never commit library files (`.sh3f`, `.sh3t`) or files from `tests/corpus/private/`.
