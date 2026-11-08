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

Editing in the plan: tools Select, Walls, Room, Line, Dimension, Text above the plan; a hint
bar at the bottom of the plan explains the next step.
- Drawing: click the points; finish by clicking the first point (closes the outline), Enter,
  Esc, a right click or a double-click; Backspace removes the last point; type a number + Enter
  for an exact length; drag with the wall tool for a single wall. Magnetism snaps to wall ends
  and corners, alignment guides, right angles to the joined wall, multiples of 45°, the
  directions of nearby walls and 5° steps (Shift: 1° steps, Alt: no magnetism).
- Double-click inside walls with the room tool creates the room of that area.
- Handles of a selected wall: ends (length/angle), side square (thickness), middle diamond
  (arc), circle (rotation). Furniture: resize and rotate handles; furniture docks to walls.
- Corner angles are shown for selected walls (green = exactly 90°) and can be typed in the
  properties ("Angle at start/end", "Angle between", "Make 90°"); drawing and dragging snap to
  right angles relative to the joined wall (Alt: free).
- Walls: select two and press J (or "Join walls") to connect them at the intersection of their
  axes; "Detach" removes connections, "Split" cuts a wall in two. Near an existing wall, the
  wall tool shows where a new wall can start (ends, middle, flush with the end face).
- Drag to move (a single wall moves straight; corner angles are shown), R to rotate, Del to
  delete, arrow keys to nudge; Ctrl+C / X / V / D copy, cut, paste and duplicate (also into
  another home), Ctrl+A selects all; Ctrl+Z / Ctrl+Y.
- Several selected walls, rooms or pieces of furniture can be edited together in the
  properties panel (common values are shown, different ones as "mixed").
- Levels: tabs above the plan; the level below is shown faded. Furniture groups (Ctrl+G /
  Ctrl+Shift+G), Flip ↔ / ↕, compass settings in the home panel, and the furniture of the home
  as a sortable list ("In home" tab next to the catalog).
- Materials of a piece of furniture (color, texture, shininess per model material) in the
  "Materials" section of its properties.
- Libraries: "Libraries…" imports .sh3f/.sh3t files and removes your own ones; "Import
  furniture…" imports OBJ, DAE, 3DS, glTF or GLB models, "Import…" in the texture chooser
  imports images. Imported items go to "My furniture" / "My textures" in Sweet Home 3D's user
  library folders, so both applications show them.
- "Print / Export…" (Ctrl+P) prints the home like Sweet Home 3D (furniture list, plan of each
  level, 3D view; with print preview) or saves it as PDF, and exports the plan as PDF (paper
  size, orientation, scale such as 1:100, all levels as pages), SVG or PNG, the furniture list
  as CSV and the 3D view as OBJ with MTL and textures.
- "Photo…" in the 3D view renders the current view as image: draft (with sun shadows, in
  seconds) or path traced on the GPU ("Good" / "Best": soft shadows, indirect light, glass).
- "Video…" in the 3D view creates an MP4 video along a camera path: add the current view or a
  stored point of view as key points, choose size, frame rate and speed; the video moves from
  point to point (draft in seconds, path traced frames on request). The path is saved in the
  home, as in Sweet Home 3D.
- Plan: rulers along the edges, "Measure" tool for distances, "Lock base plan" (only movable
  furniture stays selectable), "Preferences…" to switch rulers, grid and magnetism.
- Right click in the select mode opens a context menu: cut, copy, paste, paste style, duplicate,
  delete, flip, group, align furniture (sides, top, bottom, side by side) and distribute it,
  reverse, split, join or detach walls, add or delete points of rooms and lines, lock the base
  plan.
- Selected furniture has four handles drawn as icons: rotate, elevation, resize and height.
  Doors and windows slide along their wall with the free space to both sides shown, snap to
  the middle of the free space and into line with openings in parallel walls (also on other
  levels); their depth follows the wall thickness. The spaces can be typed in the properties.
- A selected wall or piece shows its dimensions; the context menu adds them as dimension lines
  or adds a height dimension. Dimensions snap to furniture corners.
- Text styles (font, bold, italic, size) for labels, dimensions, room names and areas, and
  furniture names ("Name in plan"); polylines can be curved; the compass can be dragged,
  turned and resized in the plan.
- Virtual visit like in games: drag to look around, W A S D to walk, Q / E down and up, Shift
  faster, mouse wheel to zoom. Walls stop the visitor, doors can be walked through; the
  visitor is shown in the plan, where it can be selected, dragged and turned. "Points of view" stores views and goes back to them; "All
  levels" shows every level in 3D.
- Furniture in the plan is drawn as seen from above, rendered from its 3D model with its
  colors and materials (Preferences: off shows the catalog icons); exports and prints use
  the view from above too, or the icons ("Furniture in plans" in the export dialog).
- Background image per level: import an image or a page of a PDF (e.g. the architect's plan),
  set its scale with a marker on a known distance and its origin, then draw walls and rooms
  on top of it (level properties: Import…, Modify…, Hide, Delete).
- Window layout: drag the borders of the side panels and between plan and 3D view; plan and 3D
  view can be maximized or minimized, the 3D view can open in its own window.
- Drag furniture from the catalog onto the plan (doors and windows snap into walls); properties
  of the selection on the right (incl. textures and baseboards).

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
msh --file house.sh3d room add --name "Living room" --inside-point "[300,300]"
msh catalog search --query "door"
msh furniture import --model-path chair.glb --name "My chair"   # into "My furniture"
msh texture import --path oak.jpg --width 60                    # into "My textures"
msh --file house.sh3d furniture add-in-wall --catalog-id "eTeks#frontDoor" --wall-id <id> --offset 400
msh --file house.sh3d furniture add --catalog-id "eTeks#sofa" --x 300 --y 500 --angle-deg 180
msh --file house.sh3d view plan-image --out plan.png
msh --file house.sh3d export plan --path plan.pdf --level all --scale 100 --paper a3
msh --file house.sh3d export furniture-csv --path furniture.csv
msh --file house.sh3d export document --path house.pdf --columns "[\"NAME\",\"PRICE\"]"
msh --file house.sh3d wall join --ids "[\"<wall id>\",\"<wall id>\"]"
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
msh export-obj house.obj                          # 3D view as OBJ + MTL + textures
msh photo --quality good --width 1600 --height 1000 --out photo.png   # photo of the 3D view
msh --live camera path-add --stored Kitchen      # key point of the video (or --x --y --yaw)
msh video render --out tour.mp4                   # video along the camera path (MP4, H.264)
msh --live background image-set --path plan.png --scale-distance 873 --x-start 120 --y-start 80 --x-end 1150 --y-end 80
msh --live export document --path house.pdf       # printed home incl. the 3D view
msh mcp --live                                    # MCP server controlling the app (+ tools view_3d_image, render_photo, render_video, export_obj)
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
