# My Sweet Home

Modern, resource-friendly home design for Windows, compatible with the file formats of
Sweet Home 3D (`.sh3d`, `.sh3f`, `.sh3t`). Controllable through the UI, a CLI (`msh`) and MCP.

Architecture and roadmap: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
Rules for AI agents (incl. language policy): [CLAUDE.md](CLAUDE.md)

## Requirements

- Windows 11 (WebView2 is preinstalled)
- Rust (stable, via rustup) with `clippy` and `rustfmt`
- Visual Studio Build Tools 2022 with the "Desktop development with C++" workload (incl. Windows SDK)
- Node.js ≥ 22 and pnpm
- Optional for the compatibility test: Sweet Home 3D and a JDK

## Development

```powershell
cd app
pnpm install
pnpm tauri dev                          # run the app with hot reload
pnpm tauri dev -- -- C:\path\house.sh3d # open a file on startup
```

The app opens `.sh3d` files and standalone `Home.xml` files (e.g. `tests/corpus/examples`).
It shows the 2D plan, the 3D view (aerial view and virtual visit) and the catalog of all
installed Sweet Home 3D libraries.

```powershell
.\scripts\check.ps1                   # formatting, lints, tests
.\scripts\compat-check.ps1            # verify against the original Sweet Home 3D reader
```

```powershell
cd app
pnpm tauri build        # installer (MSI/NSIS) in target\release\bundle
```

## CLI (`msh`)

```powershell
cargo build -p msh-cli                # binary: target\debug\msh.exe
msh info house.sh3d                   # summary: levels, walls, rooms with area, furniture
msh dump house.sh3d                   # complete model as JSON
msh resave house.sh3d copy.sh3d       # read and save again
msh catalog scan                      # find installed furniture/texture libraries
msh catalog search "sofa"             # search all libraries
msh catalog list Trees.sh3f           # content of one library
```

All commands accept `--json` for machine-readable output.

## Layout

| Path | Content |
|---|---|
| `crates/msh-model` | Data model, 1:1 with the Sweet Home 3D 7.x format |
| `crates/msh-format` | Read and write `.sh3d` / `Home.xml` |
| `crates/msh-catalog` | Furniture and texture libraries (`.sh3f`, `.sh3t`, `.jar`) |
| `crates/msh-geometry` | Geometry: wall outlines with joins, arc walls |
| `crates/msh-core` | Core: document, commands, undo/redo (from P3) |
| `crates/msh-cli` | Binary `msh` (CLI, later MCP server) |
| `app/src-tauri` | Tauri backend of the desktop app |
| `app/src` | React/TypeScript frontend (`plan2d/`, `view3d/`, `catalog/`) |
| `tools/compat` | Java test program using the original Sweet Home 3D reader |
| `tests/corpus` | Test files (example projects; personal files in `private/`) |
| `docs/` | Architecture and decisions |

More crates (`msh-export`, `msh-ipc`) are added in the phases that need them.

## License

GPL-2.0-or-later (derived from Sweet Home 3D, © eTeks / Space Mushrooms). Furniture and texture
libraries are not included and have their own licenses.
