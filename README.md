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

Editing in the plan: tools Select, Walls, Room, Dimension, Text above the plan; drag furniture
from the catalog onto the plan (doors and windows snap into walls); drag to move, R to rotate,
Del to delete, arrow keys to nudge; properties of the selection on the right; Ctrl+Z / Ctrl+Y.

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
msh catalog list Trees.sh3f           # content of one library
msh commands                          # all editing commands with their JSON schemas
```

Editing commands are generated from the command registry of `msh-core` (`group_action` →
`msh group action`). With `--file`, the home is loaded and saved after each modifying command:

```powershell
msh --file house.sh3d home new --name "My house"
msh --file house.sh3d wall add-path --points "[[0,0],[900,0],[900,700],[0,700]]" --closed --thickness 30
msh --file house.sh3d room add --name "Living room" --points "[[15,15],[885,15],[885,685],[15,685]]"
msh catalog search --query "door"
msh --file house.sh3d furniture add-in-wall --catalog-id "eTeks#frontDoor" --wall-id <id> --offset 400
msh --file house.sh3d furniture add --catalog-id "eTeks#sofa" --x 300 --y 500 --angle-deg 180
msh --file house.sh3d view plan-image --out plan.png
msh --file house.sh3d edit undo
```

Several commands in one go (saved once at the end): `msh --file house.sh3d exec < commands.jsonl`
with one `{"command": "...", "params": {...}}` per line.

Conventions: lengths in cm, y axis points down, angles in degrees (clockwise), colors `#RRGGBB`.

## MCP server (AI control)

`msh mcp` starts a Model Context Protocol server on stdin/stdout. Every registry command is a
tool (`home_new`, `wall_add_path`, `room_add`, `catalog_search`, `furniture_add`,
`furniture_add_in_wall`, `view_plan_image`, `home_save`, `edit_undo`, …). `view_plan_image`
returns the plan as an image so the AI can check its result.

Claude Code:

```powershell
claude mcp add my-sweet-home -- D:\Data\Programming\_repos\my-sweet-home\target\debug\msh.exe mcp
```

Claude Desktop (`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "my-sweet-home": {
      "command": "D:\\Data\\Programming\\_repos\\my-sweet-home\\target\\debug\\msh.exe",
      "args": ["mcp"]
    }
  }
}
```

`msh mcp --file house.sh3d` starts with an existing home. `.\scripts\mcp-smoke.ps1` runs a
scripted MCP session and verifies the result with the original Sweet Home 3D reader.

## Live control of the running app

The app listens on the named pipe `\\.\pipe\my-sweet-home` (local clients only). With `--live`,
the CLI and the MCP server send every command to the running app, so changes appear in its
window immediately and are part of its undo history (Ctrl+Z / Ctrl+Y in the window).

```powershell
msh status                                        # is the app running, which home is open?
msh --live wall add-path --points "[[0,0],[600,0],[600,400],[0,400]]" --closed
msh --live view plan-image --out plan.png
msh screenshot --mode aerial --out view3d.png     # 3D view rendered by the app
msh mcp --live                                    # MCP server controlling the app (+ tool view_3d_image)
```

Claude Code with live control:

```powershell
claude mcp add my-sweet-home-live -- D:\Data\Programming\_repos\my-sweet-home\target\debug\msh.exe mcp --live
```

`.\scripts\live-demo.ps1` builds a house in the running app through the CLI and the MCP server.

## Layout

| Path | Content |
|---|---|
| `crates/msh-model` | Data model, 1:1 with the Sweet Home 3D 7.x format |
| `crates/msh-format` | Read and write `.sh3d` / `Home.xml` |
| `crates/msh-catalog` | Furniture and texture libraries (`.sh3f`, `.sh3t`, `.jar`) |
| `crates/msh-geometry` | Geometry: wall outlines with joins, arc walls |
| `crates/msh-core` | Core: document, command registry, undo/redo, catalog access |
| `crates/msh-export` | Plan as SVG/PNG |
| `crates/msh-cli` | Binary `msh` (CLI and MCP server) |
| `app/src-tauri` | Tauri backend of the desktop app |
| `app/src` | React/TypeScript frontend (`plan2d/`, `view3d/`, `catalog/`) |
| `tools/compat` | Java test program using the original Sweet Home 3D reader |
| `tests/corpus` | Test files (example projects; personal files in `private/`) |
| `docs/` | Architecture and decisions |

| `crates/msh-ipc` | Live connection protocol and named pipe client |

## License

GPL-2.0-or-later (derived from Sweet Home 3D, © eTeks / Space Mushrooms). Furniture and texture
libraries are not included and have their own licenses.
