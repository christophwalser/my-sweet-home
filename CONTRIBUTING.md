# Contributing to My Sweet Home

Thank you for your interest! Bug reports, ideas and pull requests are welcome.

## Before you start

- **Bugs and ideas:** open an [issue](https://github.com/christophwalser/my-sweet-home/issues)
  with the templates. Please attach a small `.sh3d` file if the problem depends on a home, but
  only files you are allowed to share.
- **Larger changes:** open an issue first so the approach can be agreed on.
- **Security problems:** never in public issues; see [SECURITY.md](SECURITY.md).
- Everyone takes part under the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

See "Building from source" in the [README](README.md). Architecture, decisions and the
roadmap are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```powershell
cd app; pnpm install; pnpm tauri dev   # run the app
.\scripts\check.ps1                     # all checks, as in CI
```

## Rules for changes

- **Every user-facing action is a command in `msh-core`**, so the UI, the CLI and the MCP
  server get it from the same registry. New or changed commands get tests in
  `crates/msh-core/tests/cmd_<module>.rs`; new pure frontend logic gets a `*.test.ts` next to
  it.
- **Language:** code, identifiers, comments, docs, commit messages and UI strings are in
  English. UI strings are wrapped in `t()` from `app/src/i18n`; translations go into
  `app/src/i18n/<lang>.json` (`node scripts/i18n-check.mjs --missing` in `app/` lists missing
  ones).
- **File compatibility** with Sweet Home 3D must not break. If you have Sweet Home 3D and a
  JDK installed, run `.\scripts\compat-check.ps1` with your own homes in
  `tests/corpus/private/` (never committed).
- **Never commit** furniture or texture libraries (`.sh3f`, `.sh3t`, `.jar`), personal homes
  or other files you have no right to publish under the project's license.
- `scripts/check.ps1` must pass: rustfmt, clippy without warnings, Rust tests, Biome,
  TypeScript, Vitest and the i18n check. CI runs the same checks on every pull request.

## Pull requests

- Keep pull requests focused on one topic and describe what changes and why.
- Add an entry under "Unreleased" in [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
- By contributing you agree that your contribution is licensed under the
  [GNU GPL v3.0 or later](LICENSE), the license of the project.

## AI-assisted contributions

Contributions written with AI assistants are welcome; [CLAUDE.md](CLAUDE.md) holds the rules
for coding agents. You are responsible for every line you submit: review it, test it and
make sure it may be published under the GPL.
