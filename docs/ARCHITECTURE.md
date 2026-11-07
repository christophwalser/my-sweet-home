# My Sweet Home – Architecture and Roadmap

Last updated: 2026-11-07 · Status: draft for approval

## 1. Goal

A newly built home design application for Windows that

- reads and writes the **file formats of Sweet Home 3D** (`.sh3d` projects, `.sh3f` furniture libraries, `.sh3t` texture libraries),
- reaches feature parity with **Sweet Home 3D 7.x** (Store version 7.9.27),
- needs significantly **less RAM and CPU** (target: < 150 MB RAM for a medium-sized project, startup < 2 s; original: 300–800 MB plus JVM startup),
- has a **modern, clean UI** (light/dark theme, ribbon/toolbar, catalog search field, drag & drop),
- can be fully controlled by **AI agents through MCP** and by **scripts through a CLI**.

## 2. Starting point (analysis)

| Source | Version | Findings |
|---|---|---|
| `github.com/ralic/sweethome-3d` | 5.4 (2017) | Outdated. Reference only. The official 7.x source code (SourceForge, GPL v2+) is authoritative. |
| `C:\Program Files\Sweet Home 3D` | 7.6.1 | Java 8 + Swing + Java3D; Furniture.jar (33 MB) and Textures.jar as the default catalog. |
| Microsoft Store (`eTeks.SweetHome3D`) | 7.9.27 | Same core. Additionally: FlatLaf UI, 8 furniture libraries (~190 MB, `.sh3f`), 2 texture libraries (`.sh3t`), plus paywall, license check, analytics and review pop-ups. |

**Finding about the "Pro" version:** the Store version has no planning features of its own. It locks features that the free version also has behind a paywall: model/texture import, additional levels, render and video resolution, wall/room/3D editing. Feature parity therefore means:
1. the complete feature set of Sweet Home 3D 7.x,
2. the additional furniture and texture libraries,
3. a modern UI.

Paywall, analytics and remote config are **not** adopted.

Store libraries (`…\WindowsApps\eTeks.SweetHome3D_7.9.27.0_x86__…\Sweet Home 3D\resources\`):
`BlendSwap-CC-0`, `BlendSwap-CC-BY`, `Contributions`, `KatorLegaz`, `LucaPresidente`, `Reallusion`, `Scopia`, `Trees` (furniture), `Contributions`, `eTeksScopia` (textures). All of them are also available on sweethome3d.com. Each has its own license.

## 3. Decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Technology | Rewrite: **Rust core + Tauri 2 + TypeScript/React + three.js (WebGPU, WebGL2 fallback)** |
| D2 | AI control | **MCP server** (no built-in chat) + **CLI** |
| D3 | Distribution | Undecided. Therefore libraries are **never embedded in the repository or the application**; they are loaded from configurable folders or imported. |
| D4 | Platform | **Windows 11** only (WebView2 is preinstalled) |
| D5 | Code license | Porting algorithms from the Java code (wall geometry, format details) creates a derivative work → **GPL v2 or later**. This is unproblematic while the app stays private. If published, the source code must be GPL. |
| D6 | Language | Chat with the user in German; code, comments, docs, commits and UI strings in English (see `CLAUDE.md`). |

## 4. Architecture

```
┌──────────────────────── Tauri app (Windows) ────────────────────────┐
│  Frontend (WebView2): React + TypeScript                            │
│   ├─ 2D plan (Canvas 2D, own scene graph, HiDPI)                    │
│   ├─ 3D view (three.js WebGPURenderer, lazy model loading)          │
│   ├─ Catalog (virtual list, full-text search), property panels      │
│   └─ Photo rendering (GPU path tracer, replaces SunFlow/YafaRay)    │
│                   ▲ Tauri IPC (invoke/events)                        │
│  Rust backend ────┴────────────────────────────────────────────────  │
│   ├─ msh-core      document, selection, undo/redo, command registry  │
│   ├─ msh-model     Home, Level, Wall, Room, Piece, Polyline, …       │
│   ├─ msh-geometry  wall joins, arcs, room areas, snapping            │
│   ├─ msh-format    read + write .sh3d / .sh3f / .sh3t                │
│   ├─ msh-catalog   library index (SQLite FTS5), thumbnails           │
│   ├─ msh-export    PDF, SVG, OBJ, CSV                                 │
│   └─ msh-ipc       named pipe \\.\pipe\my-sweet-home (JSON-RPC)      │
└──────────────────────────────────────────────────────────────────────┘
        ▲ named pipe (running app)             ▲ direct (headless)
┌───────┴──────────┐                  ┌────────┴──────────┐
│ msh mcp (stdio)  │◄── Claude etc.   │ msh <command> CLI │◄── scripts
└──────────────────┘                  └───────────────────┘
```

### 4.1 Core design rule: one command registry for everything

Every action (draw a wall, place furniture, add a level …) is **a command** in `msh-core`. Every command has a name, parameters as JSON Schema (via `schemars`), undo logic and a result.

- The **UI** calls commands through Tauri IPC.
- The **CLI** generates its subcommands from the registry.
- The **MCP server** generates its tools from the same registry.

Everything the UI can do, the AI and the CLI can do as well. There is no second implementation that could drift apart.

### 4.2 Operating modes of CLI and MCP

- **Headless:** works directly on a `.sh3d` file, without a window. Good for batch jobs, tests and AI generation.
- **Live:** connects to the running app through the named pipe. Changes appear immediately in the window and are part of the undo history.

Examples:
```
msh new house.sh3d
msh wall add house.sh3d --from 0,0 --to 500,0 --thickness 20 --height 250
msh furniture search "sofa" --json
msh --live furniture add --catalog-id eTeks#sofa --x 200 --y 150 --angle 90
msh render house.sh3d --camera top --width 1920 --out image.png
msh mcp            # starts the MCP server (stdio)
```

MCP tools (excerpt): `home_open`, `home_save`, `home_describe` (structured summary for the AI), `level_*`, `wall_*`, `room_*`, `furniture_search`, `furniture_add/move/modify`, `camera_set`, `view_screenshot` (returns an image of the 2D or 3D view so the AI can verify its result), `render_photo`, `export_*`, `undo/redo`.

### 4.3 File compatibility

- `.sh3d` is a ZIP containing `Home.xml` (since SH3D 5.3, DTD `SweetHome3D.dtd`), models and textures as entries, and optionally the Java-serialized `Home` entry.
  - **Reading:** `Home.xml`. Very old files (< 5.3, `Home` only) get a limited Java serialization reader or a one-time converter. Low priority.
  - **Writing:** `Home.xml` + contents, without the `Home` entry (SweetHome3DJS does the same).
  - Unknown attributes and elements are **preserved unchanged** on save (forward compatibility), so no data is lost.
- **Results of P1 (2026-11-07):**
  - The Sweet Home 3D 7.6.1 application reads with `HomeFileRecorder(0, false, prefs, false, preferXmlEntry=true, true)`. Files without a `Home` entry are read correctly in this mode. Verified with `scripts/compat-check.ps1` against the original reader: identical structure and identical resource bytes.
  - **Limitation:** tools that read with `preferXmlEntry=false` require the Java-serialized `Home` entry and cannot open our files. This affects older versions and some plugins or third-party tools. The application itself is not affected.
  - `ContentDigests` is kept unchanged for now. As soon as resources are added or removed (P4/P5), the digests must be recomputed. The digest format for multi-file resources (`1/puerta.obj`) must then be verified against the original reader.
  - The example projects reference models in the SH3D catalog (`com/eteks/.../armchair.obj`). A standalone `.sh3d` must embed these resources. This belongs to P5 (placing furniture from libraries).
- `.sh3f` / `.sh3t`: ZIP with `PluginFurnitureCatalog.properties` / `PluginTexturesCatalog.properties` (localized keys), models (OBJ/MTL, 3DS, DAE), icons and images. Read and write (library editor later).
- 3D model formats: OBJ, 3DS, DAE (Collada) as in the original, plus glTF/GLB. Loaded in the frontend with the three.js loaders; Rust only delivers the bytes.
- **Test corpus:** `Examples.jar` (example projects) + personal files. Automatic round-trip test (read → write → read → semantic comparison).

### 4.4 Libraries

- Configurable library folders. An **import wizard** automatically finds:
  - `C:\Program Files\Sweet Home 3D\lib\Furniture.jar` and `Textures.jar` (default catalog, JAR = ZIP, same properties format),
  - the resources folder of the Store app,
  - `%APPDATA%\eTeks\Sweet Home 3D\furniture|textures` (libraries imported by the user).
- Libraries are copied into our own library folder and indexed in SQLite (FTS5): name, category, tags, dimensions, license/creator. They are not bundled with the application (see D3).
- License and creator of every item are shown. This matters for CC-BY.

### 4.5 Saving resources – concretely

- No JVM. Native Rust backend; WebView2 shares its runtime with Windows.
- Models are loaded **lazily** and shared as GPU instances (same furniture = one mesh, `InstancedMesh`), with texture compression (KTX2/Basis).
- 3D is only redrawn on changes (no continuous render loop while idle).
- Catalog: virtual list, thumbnails cached on disk instead of in RAM.
- Measurement: a benchmark script compares RAM, CPU and startup time with the original using the same example files.

### 4.6 Viewer status after P2 (2026-11-07)

Implemented:
- `msh-geometry`: wall outlines with mitered joins (end–start and start–start joins), arc walls; unit-tested.
- Tauri backend: `open_home` (`.sh3d` and standalone `Home.xml`), `catalog_load`, file passed on the command line, custom URI scheme `msh` (`http://msh.localhost/doc/{id}/{entry}` and `/lib/{index}/{entry}`) that serves resources directly from the ZIP files. Resources missing in a home (e.g. example projects referencing the SH3D catalog by class path) are resolved from the installed libraries.
- 2D plan (Canvas 2D): rooms with names and areas, walls, furniture with icons, doors/windows with sash arcs, dimension lines, labels, polylines, compass, level tabs, zoom/pan/fit, light/dark theme.
- 3D view (three.js, WebGL2): walls with heights at both ends, side and top colors, door/window openings cut with CSG (`three-bvh-csg`), floors/ceilings with textures, ground texture, sky color, furniture models (OBJ/MTL, 3DS, Collada) normalized like SH3D, Sweet Home 3D's default OBJ material table, transparent window panes (`sweethome3d_window_pane*` groups at 50 % opacity, as in SH3D's ModelManager), stored aerial and observer cameras, render on demand.
- Viewer polish (P2): wall side textures with UVs along the wall (u along the axis, v = height, in cm), baseboards as mitered prisms along the wall sides (cut by door openings), sky texture on a half sphere that follows the viewer (sky color as fallback), point lights for the light sources of lamps in the virtual visit, optional sun shadows (toggle in the 3D view; ceilings cast none so the aerial view stays lit), labels with a pitch, dimension lines marked "visible in 3D" and polylines with an elevation in 3D, aerial camera started slightly below the pole (pitch ≤ π/2 − 0.05) so that OrbitControls keep the yaw. 2D plan: wall patterns as canvas patterns of constant screen size (default `hatchUp`), baseboard outlines, room floors with color or texture at 75 % opacity like SH3D, dimension text on the outer side of the line.
- Catalog panel: all installed libraries, categories, search, icons, license and creator in the tooltip.

Deliberate deviations:
- The renderer is WebGL2 for now (stable with all three.js loaders and CSG). WebGPU will be evaluated in P7.
- Missing texture images referenced by MTL files are dropped, so the material falls back to its diffuse color (SH3D behaves the same; three.js would render black).
- The `visible` attribute of levels is ignored for 3D: SH3D saves it as derived state (levels above the selected one). Only `viewable` is respected.

Known gaps (planned for later phases):
- Sun position from the compass (latitude, longitude, time); the sun direction is fixed
- Lamp lights only in the virtual visit and capped to the 12 nearest; no spot cones, light source materials do not glow
- Arc walls: side textures run along the chord, not the arc length
- Polyline arrows and dash styles in 3D; staircase cut-outs; room floor thickness on upper levels (dark gap between levels)
- Selection, tooltips and editing (P3/P4)
- Memory and CPU measurement of the release build (P7 benchmark; only dev builds were run so far)

### 4.7 Status after P3a (2026-11-07)

P3 is split in two steps. **P3a (done):** command registry and headless operation.
**P3b (next):** live mode through a named pipe to the running app, 3D screenshot from the app.

Implemented in P3a:
- `msh-core`: `Document` (home, resources, path, snapshot-based undo/redo with 100 steps; failed
  commands restore the previous state), `Registry` with typed parameters (`schemars` JSON Schema).
  23 commands: `home_new/open/save/describe/set`, `level_add/update/select`,
  `wall_add/add_path/update`, `room_add/update`, `catalog_search`,
  `furniture_add/add_in_wall/update`, `label_add`, `dimension_add`, `edit_delete/undo/redo`,
  `view_plan_image`.
- Catalog furniture and textures are **embedded** into the home (single-file models as `N`,
  multi-part models as folder `N/…`, icons, texture images). Catalog values in cm/degrees are
  converted to the relative values of `Home.xml` (sash axes, wall thickness/distance, light
  sources, drop-on-top elevation). Unreferenced resources are pruned on save; `ContentDigests` is
  dropped when resources changed (Sweet Home 3D accepts files without it — verified).
- `msh-export`: plan as SVG and PNG (`resvg`) with rooms, areas, furniture names, doors/windows,
  dimensions, labels and scale bar.
- CLI: subcommands generated from the registry, `--file` with auto-save, `exec` (JSON lines),
  `commands` (schemas).
- MCP server (`msh mcp`): JSON-RPC 2.0 over stdio (`initialize`, `ping`, `tools/list`,
  `tools/call`), tools generated from the registry, plan image returned as MCP image content,
  conventions as server instructions. Implemented without SDK to avoid churn of the young
  Rust MCP SDKs; the protocol surface is small.
- Verified: a house built through MCP (walls, room with floor texture, door, window, furniture)
  is read by the original Sweet Home 3D reader without errors and with all resources
  (`scripts/mcp-smoke.ps1`).

Findings:
- Door/window sash angles follow Java's `Arc2D` convention (counter-clockwise on screen): a point
  at angle θ lies at (cos θ, −sin θ) in plan coordinates. The P2 plan view drew them mirrored;
  fixed in the app and in the export.

### 4.8 Status after P3b (2026-11-07)

Implemented:
- The app keeps the open home as `msh_core::Document` and changes it only through the registry
  (Tauri command `execute`). After every change it emits `home-changed` with the new state
  (home, wall shapes, path, modified, can undo/redo); the frontend applies it. Toolbar: New,
  Open, Save (Save as), Undo, Redo; shortcuts Ctrl+Z, Ctrl+Y, Ctrl+S, Ctrl+Shift+S.
- `msh-ipc`: protocol (newline-delimited JSON requests/responses) and synchronous client for the
  named pipe `\\.\pipe\my-sweet-home`. Methods: `execute`, `capture_3d`, `status`.
- Pipe server in the app (tokio named pipes, remote clients rejected, one instance per user
  session; a second app instance simply runs without pipe).
- 3D screenshots: the app asks the frontend (`capture-3d` event) to render the 3D view after all
  models have loaded and returns a PNG.
- CLI `--live` for all registry commands and `exec`; `msh screenshot`, `msh status`.
- MCP `--live`: tool calls are forwarded to the app; extra tool `view_3d_image`.
- Plan and 3D view keep the user's camera during live edits; homes without stored camera are
  re-fitted until the user moves the view.
- Verified with `scripts/live-demo.ps1`: house built in the running app through CLI and MCP,
  undo from the window, saved file read by the original Sweet Home 3D reader.

Findings:
- The DTD default of a room's `nameYOffset` is -40 (name above the area); the plan view used 0.

### 4.9 Status after P4a (2026-11-07)

Implemented (editing in the 2D plan; every action is a registry command and one undo step):
- Selection: click, Shift+click, rubber band; highlight in the plan; properties panel on the
  right for furniture, walls, rooms, labels, home and level.
- Moving by dragging (`edit_move`, joined walls keep their connection), arrow keys (1 cm,
  Shift 10 cm), rotating furniture with R / Shift+R (15°), Delete.
- Tools: walls (click chain with magnetism to wall ends, 15° angles and whole centimeters,
  click the first point to close, double-click/Enter to finish), rooms (snap to the corners of
  the wall sides), dimension lines, text labels; Alt disables magnetism.
- Catalog drag & drop: furniture at the drop point, doors/windows into the nearest wall
  (`furniture_add_in_wall`); the translated catalog name becomes the piece name.
- "+ Level" in the level tabs.
- Core: `edit_move`, `label_update`; homes of older versions get IDs on open (needed for
  selection and commands; Sweet Home 3D reads them — verified).

Findings:
- Tauri intercepts drag & drop on Windows for file drops; HTML5 drag & drop in the WebView only
  works with `dragDropEnabled: false` on the window.
- Tilted furniture (roofs): Sweet Home 3D uses rotY(−angle) · rotZ(−roll) · rotX(−pitch) and
  centers at elevation + heightInPlan / 2; the 3D view used +pitch (roofs were upside down).

Next (P4b): wall end and furniture resize handles, copy/paste, room detection by double-click
inside walls, polylines, multi-level editing details, more properties (textures, baseboards).

### 4.10 Status after P4b (2026-11-07)

Implemented:
- Handles of a single selected element: wall ends (magnetism to other wall ends and 15° angles;
  the joined wall follows), room and polyline points, dimension line ends, furniture resize
  (bottom-right corner, top-left corner stays; proportional for non-deformable pieces; not for
  tilted pieces) and rotation (top-left corner, 15° steps, Alt for free angles).
- Copy/paste: `edit_copy`, `edit_paste`, `edit_duplicate` (Ctrl+C / X / V / D, Ctrl+A selects
  all on the level). The clipboard (`msh_core::clipboard`) holds the elements and their
  resources and survives `home_open`/`home_new`, so pasting into another home works; resources
  with the same name but other data get a new numeric prefix. Joins are kept between copied
  walls; copies get new IDs and the target level.
- Room detection: `room_add` with `inside_point` (double-click with the room tool) takes the
  smallest hole of the union of the wall outlines (`msh_geometry::enclosed_area`, boolean ops
  of the `geo` crate) that contains the point.
- Polylines: tool "Line", `polyline_add` / `polyline_update` (thickness, color, dash style,
  arrows, closed); arrows are drawn in the plan.
- `wall_update`: baseboards per side (height 0 removes), pattern, "" removes colors/textures,
  joined walls follow moved end points. `room_update`: "" removes colors/textures.
  `dimension_update`.
- Properties panel: texture chooser (searchable grid of all installed texture libraries) for
  wall sides, baseboards, floors and ceilings; wall pattern; baseboards; polyline and dimension
  line properties; Copy / Duplicate / Delete buttons.

Verified: tests for all new commands; a file built with them (baseboards, textures, detected
rooms, duplicated furniture, polylines) and the same file edited and saved in the app are read
by the original Sweet Home 3D reader.

### 4.11 Usability pass of the plan editor (2026-11-07)

Based on user feedback; Sweet Home 3D's interaction is the baseline, with additions:
- Finishing a drawing: clicking the first point (closes walls and lines, finishes rooms),
  Enter, Escape (keeps what was drawn), a right click without dragging, or a double-click.
  Backspace removes the last point. A right click without a drawing leaves the tool.
- Single walls: press, drag and release with the wall tool. New walls are drawn with their
  real thickness (thickness field in the plan toolbar while the wall tool is active).
- Typed lengths: digits while drawing set the length of the current segment, Enter confirms.
- Magnetism (`plan2d/snapping.ts`): points (wall ends, wall side corners, room corners, the
  first point), then directions from the previous point (15° steps, parallel/perpendicular to
  nearby walls, shown as "∥ wall" / "⊥ wall"), along which the point snaps to alignment guides
  (same x or y as a reference point, drawn as dashed lines) and to wall axes (walls) or wall
  sides and room edges (rooms, dimensions). The angle to the previous segment is drawn at
  each corner; right angles get a green square mark.
- Wall handles: both ends (length and direction, with the same magnetism), a filled square
  beside the middle (thickness), a diamond in the middle (bend into an arc, 5° steps) and a
  circle beyond the end (rotate around the center, 15° steps). A hint bar at the bottom of
  the plan explains the current tool, state and the handle under the cursor.
- Moving walls: the preview shows the stretched joined walls and the angles at their corners;
  with magnetism a single wall moves straight (perpendicular to or along itself), so the
  corners keep their angles. Doors and windows inside a moved wall move with it (`edit_move`).
- Furniture docks to wall sides while dragged (back against the wall, parallel), like Sweet
  Home 3D's magnetism; Alt disables it.
- `wall_add_path` joins an open path to a free wall end at its first or last point (mitered
  corner instead of two overlapping walls).
- Joining and separating walls: `wall_join` (two walls; their axes are extended or shortened to
  the intersection: mitered corner near both ends, T junction if the intersection lies inside
  one wall, end-to-end for collinear walls), `wall_detach`, `wall_split` (at a point or the
  middle). UI: "Join walls" (or J) for two selected walls, "Detach", "Split". Moving a free wall
  end onto a free end of another wall (`wall_update`, handles) joins them.
- Placing a wall against an existing one: near a wall, the wall tool shows its snap points (ends
  and middle as circles, "flush" points as crosses) and names the point the cursor snaps to.
  A flush point lies half the new wall's thickness inside the end, so a wall drawn across from
  there ends flush with the end face of the existing wall.
- Walls are drawn as one area in the plan (outlines first, fills on top), so overlapping walls
  show no inner lines, like Sweet Home 3D.
- Corner angles: selected walls show the angle at each of their joined corners (green square
  for exactly 90°); handle drags of wall ends and rotations show them live. The properties panel
  has "Angle at start/end" (one wall) or "Angle between" (two joined walls) and "Make 90°";
  they run `wall_set_angle`, which rotates the wall around the corner, keeps its length and
  lets the wall joined at its other end follow.
- Corner magnetism: when drawing or dragging a wall end, right angles and straight
  continuations relative to the wall joined at the previous point (or the previous segment)
  win over all other directions within 10° ("90° to wall"); Alt disables magnetism.
- Staged angle magnetism (replaces Sweet Home 3D's fixed 15° steps, `snapAngleDeg`):
  1. right angles / straight continuation to the wall at the corner (±10°),
  2. multiples of 45° (±5°),
  3. parallel/perpendicular to nearby walls (±4°, only if closer than a 45° multiple),
  4. otherwise 5° steps; Alt disables magnetism.
  With Shift only 1° steps apply (no other stage), counted from the wall at the corner if
  there is one, so corner angles like 89° or 91° can be set precisely.
  The same staging applies to wall end, wall rotation, arc and furniture rotation handles.
  Finer steps alone would make the important angles harder to hit (±2.5° capture instead of
  ±7.5°); the stages keep them easy while allowing 5° and 1° angles.

Next (P4c): multi-level editing details (elements of other levels as background, walls through
levels), arc walls and wall splitting in the plan, furniture groups, text style and room label
positions, mirrored copy, keyboard input of lengths while drawing.

## 5. Feature scope (parity with SH3D 7.x)

Required (implemented in phases):
- Levels (incl. same elevation), walls (straight, arc, heights at both ends, patterns, baseboards), rooms (floor/ceiling, areas), polylines, dimension lines, labels, compass
- Furniture: place, rotate (3 axes), resize, mirror, change materials/textures, group; doors and windows with wall cut-outs; light sources
- Furniture list with sortable columns, price and VAT
- 3D: aerial view and virtual visitor, background images/sky, lights
- Photo rendering (quality levels) and video along a camera path
- Import: furniture and texture wizards, background plan image, libraries
- Export: PDF/print, SVG, OBJ, CSV, image
- Preferences, units, magnetism/grid, undo/redo, copy/paste between projects
- Languages: German, English (more through translation files)

Deliberately **not** adopted: SH3D Java plugins (not compatible; replaced by CLI/MCP commands and later our own plugin system), paywall, analytics.

## 6. Roadmap

| Phase | Content | Result / acceptance |
|---|---|---|
| **P0 Setup** | Rust (rustup, MSVC Build Tools), pnpm, Tauri CLI, Git repository, Cargo workspace + frontend scaffold, CI scripts, lint/format | `pnpm tauri dev` opens an empty window |
| **P1 Format & model** | `msh-model`, `msh-format` (read/write Home.xml), catalog reader `.sh3f/.sh3t/.jar`, round-trip tests | All example files round-trip; readable again by SH3D 7.6.1 |
| **P2 Viewer** | Open files, 2D plan, 3D view (read-only), catalog search | Example projects look essentially like in the original |
| **P3 Commands + CLI + MCP** | Command registry, undo/redo, headless `msh` CLI, MCP server, named pipe for live mode, `view_screenshot` | Claude can create and save a simple house (walls, rooms, furniture) through MCP |
| **P4 Editing** | All drawing tools in the 2D plan, property dialogs, levels, magnetism, copy/paste | A real floor plan can be drawn entirely in the app |
| **P5 Libraries & import** | Library import wizard, furniture and texture import (OBJ/DAE/3DS/glTF), material editor | All installed libraries usable, own models importable |
| **P6 Rendering & export** | Photo rendering (path tracer), video, PDF/SVG/OBJ/CSV, printing | Exports match the original |
| **P7 Polish** | Preferences, i18n, accessibility, performance benchmarks, installer (MSI via Tauri), optional auto-update | Release candidate 1.0 |

Realistic assessment: P0–P3 quickly produce an AI-controllable foundation. Full parity (P4–P7) is a project of **several months**. The phases are cut so that each one delivers something usable.

## 7. Repository layout

```
my-sweet-home/
├─ Cargo.toml                  # workspace
├─ CLAUDE.md                   # rules for AI agents (language policy, commands)
├─ crates/
│  ├─ msh-model/  msh-geometry/  msh-format/  msh-catalog/
│  ├─ msh-core/   msh-export/    msh-ipc/
│  └─ msh-cli/                 # binary "msh" (CLI + "msh mcp")
├─ app/
│  ├─ src-tauri/               # Tauri backend (uses the crates)
│  └─ src/                     # React/TS frontend (plan2d/, view3d/, catalog/, panels/)
├─ tools/compat/               # Java test program using the original SH3D reader
├─ tests/corpus/               # test files (only own/free files in the repository)
├─ docs/
└─ libraries/                  # local, in .gitignore – imported libraries
```

## 8. Open points (not blocking)

- Name of the app (working title "My Sweet Home", binary `msh`)
- Distribution / license model (D3), at the latest before the first distribution
- Whether a converter for very old `.sh3d` files (< 5.3) is needed
