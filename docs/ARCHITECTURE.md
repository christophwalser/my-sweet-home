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
| D3 | Distribution | Open source on GitHub (decided 2026-11-11). Libraries are **never embedded in the repository or the release artifacts**; they are loaded from configurable folders, imported or downloaded through the online catalog. |
| D4 | Platform | **Windows 11** only (WebView2 is preinstalled) |
| D5 | Code license | Porting algorithms from the Java code (wall geometry, format details) creates a derivative work of Sweet Home 3D (GPL v2 or later). My Sweet Home is licensed **GPL-3.0-or-later** (decided 2026-11-11): dependencies licensed only under Apache-2.0 are compatible with GPL v3 but not with GPL v2. See `LICENSE` and `NOTICE.md`. |
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
  dimensions, labels and scale bar (since P6a also as the app draws it, PDF pages via `krilla`,
  furniture list as CSV).
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
  arrows, closed, `visible_in_3d`: an elevation, as SH3D 6.0 shows such polylines in 3D);
  arrows are drawn in the plan.
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
- Joining and separating walls: `wall_join` (two or more walls; their axes are extended or shortened to
  the intersection: mitered corner near both ends, T junction if the intersection lies inside
  one wall, end-to-end for collinear walls; two collinear walls of the same thickness whose ends
  meet, e.g. the parts of a split wall, become one wall again), `wall_detach`, `wall_split` (at a point or the
  middle). With more than two walls, each one not yet joined to another of them is joined to the
  nearest one without breaking the joins between them. UI: "Join walls" (or J) for two or more
  selected walls, "Detach", "Split". Moving a free wall
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
- Editing several elements at once: with a multi-selection the properties panel shows
  sections for the selected walls (thickness, heights, pattern, side colors, textures and
  baseboards), rooms (visibility, floor and ceiling colors and textures) and furniture
  (elevation, angle, size, color, mirrored, visible). Fields show the common value or
  "mixed"; a change applies to all elements of that kind as one command and undo step.
  `wall_update`, `room_update` and `furniture_update` accept `ids` instead of `id`
  (coordinates, outlines and x/y only for one element).


### 4.12 Status after P4c (2026-11-07)

Implemented:
- Levels: the level below is drawn faded behind the selected level in the plan; level
  panel with "Visible in 3D", "Add level at same elevation" and "Delete level" (undoable);
  hidden levels are shown in italics in the level tabs.
- Furniture groups: `furniture_group` / `furniture_ungroup` (Ctrl+G / Ctrl+Shift+G, panel
  buttons). A click on a piece of a group selects the group; groups move, copy and flip as a
  whole; the group gets the bounding box of its pieces.
- Furniture list: "In home" tab next to the catalog with sortable columns (name, size,
  elevation, level, price), search, visibility checkbox and selection (also of the level).
- `edit_flip` (Flip ↔ / Flip ↕): mirrors the selection around its center; walls reverse their
  direction so their left/right sides keep their physical sides, furniture gets a mirrored
  model (doors open to the other side), dimension offsets are mirrored.
- `compass_update` and a compass section in the home panel (position, diameter, north
  direction, latitude/longitude, visibility).
- Room name and area font sizes (`room_update` `name_font_size` / `area_font_size`).

Verified: tests for groups, flipping and label offsets; a file with a group, a flipped group,
two levels, compass settings and room text styles is read by the original Sweet Home 3D reader.

Still open from the feature scope (moved to later phases): stairs and walls spanning several
levels, a draggable compass, font families and text alignment, prices with VAT in the list.


### 4.13 Status after P5a/P5b (2026-11-07)

Implemented:
- Libraries (P5a): `library_list`, `library_import` (copies a .sh3f/.sh3t into Sweet Home 3D's
  user library folders `%APPDATA%\eTeks\Sweet Home 3D\furniture|textures`), `library_remove`
  (moves a user library to a `removed` folder next to them). `CatalogIndex` and the app's
  library store reload afterwards; the backend emits `catalog-changed` and the frontend
  reloads the catalog. "Libraries…" dialog in the catalog panel.
- Own libraries (`msh_catalog::user_library`): imported items are appended to "My
  furniture.sh3f" / "My textures.sh3t" in the user folders (Plugin*Catalog.properties +
  files, written atomically), so they stay in the catalog of both applications.
- Texture import: `texture_import` (JPEG/PNG/BMP/GIF, tile size in cm); "Import…" in the
  texture chooser imports and applies the texture.
- Furniture import: `furniture_import` (OBJ with MTL and textures, DAE, 3DS, glTF/GLB) via
  `msh_core::model_package` (collects referenced files; converts glTF to OBJ + MTL +
  textures, since Sweet Home 3D cannot read glTF; computes the size of OBJ/glTF models).
  "Import furniture…" wizard: preview, 90° rotations (stored as `modelRotation`), name,
  category, size with proportions, elevation, door/window, icon rendered from the preview,
  optional placement in the home. Models are staged for the preview under `msh://stage/`.
- 3D view: missing normals are computed (OBJ without `vn`), and the view redraws when
  textures of models finish loading (they stayed black until the next interaction).

Verified: Sweet Home 3D's `DefaultFurnitureCatalog` / `DefaultTexturesCatalog` read the
written libraries (`tools/compat/ReadCatalog.java`), and a home with imported OBJ and glTF
furniture is read by its home reader.

### 4.14 Status after P5c (2026-11-07)

- Material editor: the furniture panel lists the materials of the model ("Materials",
  names read from the loaded model) with color, texture and shininess per material, "Model
  material" per row and "Reset all materials". `furniture_update` takes `materials`
  ([{name, color, texture, shininess}], "" or a negative shininess restores the model's
  value) and `reset_materials`; materials without changes are removed. The 3D view applies
  material textures (model UVs, repeating). Written as `<material>` elements with a texture
  child like Sweet Home 3D; verified with its home reader.
- Window layout: the catalog, the properties panel and the plan / 3D split are resized by
  dragging their borders (double-click: default size); sizes are remembered in the WebView's
  local storage. Plan and 3D view can be maximized or minimized; a collapsed pane comes back
  through the bar at the split (button or drag). The 3D view can open in a separate window
  (`index.html#view3d`), which follows the open home through the `home-changed` event and
  shares the selected level and view mode with the main window (`ui-state` event).
- Levels are renamed by double-clicking their tab; a new level starts in rename mode.

### 4.15 Status after P6a (2026-11-07)

- `export_plan`: the plan as the app draws it (rooms with floor colors / textures at 75 %,
  furniture icons, wall hatch patterns, doors and windows with sashes, polylines with arrows,
  dimensions, labels, room names and areas, compass; furniture names only where shown) as SVG,
  PNG or PDF. `msh-export` renders the SVG headless; icons and textures come from the file or,
  for homes referencing the Sweet Home 3D catalog by class path, from the installed libraries.
  PDF: one page per level ("all"), A4 / A3 / Letter, automatic orientation, scale 1:N or fit,
  title and scale on the page. SVG pages are converted with `krilla` + `krilla-svg` (vector,
  fonts embedded); `resvg` is pinned to 0.47 so both share one `usvg`.
- `export_furniture_csv`: columns of the furniture table (`furnitureVisibleProperties`, else
  Sweet Home 3D's defaults) or given ones (CATALOG_ID … PRICE_VALUE_ADDED_TAX_INCLUDED), all
  levels, pieces of groups one by one, UTF-8 with BOM.
- OBJ export of the 3D view (walls, rooms, furniture as shown, cm, y up) with MTL (sRGB colors,
  shininess, opacity) and PNG textures. Built by the frontend from the three.js scene
  (`view3d/objExport.ts`), written by the Tauri command `write_obj_files`. Reached through the
  pipe method `export_obj` (CLI `msh export-obj`, live MCP tool `export_obj`) or the export
  dialog; the window that shows the 3D view (main or separate) answers.
- App: "Export…" dialog in the toolbar for all three exports.

### 4.16 Status after P6b (2026-11-07)

- `export_document`: the printed home like Sweet Home 3D: furniture list as table pages
  (columns of the furniture table, check marks, totals of price columns, landscape when wide),
  the plan of every level (fitted or 1:N) and the 3D view, with titles, "Page n of m" and the
  scale. Written as PDF, or returned as SVG pages (`pages`, `landscape`, `paper_mm`) without a
  path. The 3D image is a parameter (`view_3d_image`, PNG): the app's pipe adds it for
  `--live` calls by capturing the 3D view, the dialog captures it through the Tauri command
  `capture_3d_image`; headless calls leave the page out and say so in `notes`.
- `msh-export::pages`: one page frame for all page kinds (`Page`, `page_svgs`), plan, table and
  image pages.
- Printing: the SVG pages go into a hidden frame with `@page` sizes per orientation (named
  pages) and the WebView's print dialog (preview, printer choice). Ctrl+P opens the dialog
  ("Print / Export…", now with a shared page setup).

### 4.17 Status after P6c (2026-11-07)

- Photo rendering of the current 3D view ("Photo…" in the 3D view, also in the separate 3D
  window): "draft" rasterizes the scene at the photo size with sun shadows; "good" (256
  samples) and "best" (1024 samples, more bounces) path trace on the GPU with
  `three-gpu-pathtracer` 0.0.27 (WebGL, own renderer and canvas, tiles for long renders,
  progress preview, "Finish now" keeps the samples so far).
- The path tracing scene is a copy of the 3D view's content: Lambert / Phong materials
  become physical ones (shininess -> roughness, see-through untextured materials -> glass by
  transmission, cut-out textures keep alpha), the sky color and ground color become a
  gradient environment at the hemisphere light's intensity, labels and dimensions and hidden
  objects are left out. The path tracer supports one material per mesh, so meshes with
  geometry groups are split into one mesh per group (shared vertex attributes).
- Live control: pipe method `render_photo` ({width, height, quality, path}), CLI `msh photo`,
  live MCP tool `render_photo`. The BVH is built synchronously (no BVH worker yet), which
  blocks the window for a few seconds on large homes.

### 4.18 Status after P6d (2026-11-07)

- Camera path of the video: commands `camera_path_get`, `camera_path_add` (stored point of view
  by name, or position with yaw / pitch or a point to look at), `camera_path_remove`, `camera_path_move`,
  `camera_path_clear` and `video_settings_update` (width, aspect ratio 4:3 / 16:9 / 24:10, frame
  rate, speed in m/s). As in Sweet Home 3D the key points are `<camera attribute="cameraPath">`
  elements in the environment and the settings are the `video*` attributes of the environment;
  the Sweet Home 3D reader reads both (checked with `HomeEnvironment.getVideoCameraPath()`).
- Timing (same in msh-core and the frontend): each segment lasts as long as the slower of moving
  at the video speed and turning at 45°/s; position, yaw (shortest way), pitch and field of view
  are interpolated linearly, like Sweet Home 3D. The path goes straight from point to point, also
  through walls.
- "Video…" in the 3D view opens a panel that is not modal, so the 3D view can be moved to the
  next key point while it is open ("Add current view", stored points of view, remove, clear,
  settings, quality, preview with progress, save as MP4).
- Rendering (`app/src/view3d/video.ts`): every frame is rendered on its own canvas like a photo,
  "draft" rasterized with sun shadows, "good" / "best" path traced with 32 / 128 samples per
  frame (one scene and BVH for all frames, only the camera moves). Frames are encoded with
  WebCodecs (H.264 High, fallback VP9 or AV1) and muxed into MP4 with `mp4-muxer` 5.2.2; the file
  is written by the `save_file` command (raw request body, path in a header).
- Live control: pipe method `render_video` ({path, quality, width, height, frame_rate}; sizes and
  frame rate default to the home's video settings), CLI `msh video render --out file.mp4`, live
  MCP tool `render_video`.
- Measured: 285 draft frames at 640 x 480 in 3.7 s; path traced at 320 x 240 and 32 samples
  about 1.2 s per frame. Path traced frames of interiors are noisy and dark at 32 samples
  without lamps (aerial view), and the noise changes from frame to frame.

### 4.19 Status after P7a (2026-11-08)

- Rulers along the top and left edge of the plan (`plan2d/rulers.ts`, own canvases in a CSS
  grid around the plan canvas): marks in cm that follow zoom and scrolling (labeled steps at
  least ~70 px apart, tenths or halves as minor marks) and a mark at the mouse position.
- Preferences (`preferences.ts`, local storage of the WebView) with a first dialog
  ("Preferences…"): rulers, grid, magnetism. With magnetism off, Alt turns it on for the current
  action (Alt inverts the preference).
- Measuring tool ("Measure"): two clicks or a drag measure a distance with the magnetism of the
  dimension tool; the overlay shows length, direction (degrees, clockwise from the x axis) and
  the horizontal and vertical parts. Nothing is added to the home; Esc or a right click clears.
  Dimensions and measurements snap to the corners of the wall faces and align with them, not
  with the wall axis (outer lengths can be measured corner to corner).
- Lock base plan: `home_set` `base_plan_locked` (written only when locked, as Sweet Home 3D
  does). While locked, clicks, the rubber band and Ctrl+A select only movable furniture; walls,
  rooms, dimensions, labels, polylines, doors, windows and pieces with `movable="false"` are
  skipped (`isBasePlanPiece`). Locking clears the selection; choosing a tool that creates base
  plan elements unlocks the plan, like Sweet Home 3D. Checkbox in the plan toolbar of the select
  tool.

### 4.20 Status after P7b (2026-11-08)

- Background image per level (the home's own one without levels), stored like Sweet Home 3D's
  `backgroundImage`: image resource, scale marker in image pixels with its real length
  (`scaleDistance*`), origin of the plan on the image in cm (`xOrigin`, `yOrigin`), `visible`
  only written when hidden. Commands `background_image_set` (file path or base64 image),
  `background_image_update` (marker, origin, visibility) and `background_image_remove`; the
  first `level_add` moves the home's image to "Level 0", as Sweet Home 3D does. Verified with
  the Sweet Home 3D reader (scale, marker, origin, image bytes; home and level images).
- Plan: the image of the shown level is drawn at `scale` cm per pixel shifted by the origin,
  at 70 % opacity (like Sweet Home 3D) above the grid and under everything else. A level with
  only its image yet fits the view to the image; after an import the plan fits again.
- Wizard (level or home properties: Import… / Replace…, Modify…, Hide / Show, Delete):
  1. image (PNG, JPEG, BMP, GIF) or a PDF page, rendered with `pdfjs-dist` 5.5.207 at up to
     300 dpi and 4000 px (white paper behind transparent content) and imported as PNG;
  2. scale: the marker ends are dragged onto two points of known distance (Shift: horizontal or
     vertical) or the marker as a whole, with a magnifier (4x) while dragging an end; the length is typed in cm, the resulting
     cm per pixel and the real size of the image are shown;
  3. origin: click or drag the point that becomes (0, 0), or type it in cm.
  Zoom with the wheel, move by dragging, double-click to fit; zoom and position are kept
  between the steps. Files are read through the Tauri command `read_file` (raw bytes).
- Checked with a 1:100 PDF exported by `export_plan`: 0.848 cm per pixel at 300 dpi (exact:
  0.8467), the A4 sheet comes out as 29.7 x 21 m, and a dimension of 873 cm from the origin
  ends on the image's corner within about 1 cm.
- The 3D view never shows the background image (also not for files with
  `backgroundImageVisibleOnGround3D`); not yet: rotating the image, the image in exports and in
  the printed plan.

### 4.21 Status after P7c (2026-11-08)

- Furniture seen from above in the plan (`plan2d/topView.ts`), like Sweet Home 3D's preference
  "furniture icon in plan: top view": the piece's model, normalized and colored exactly as in
  the 3D view (`createPieceObject`: model rotation, size, mirroring, pitch/roll, color,
  materials and their textures), rendered with an orthographic camera looking down onto its
  footprint (`widthInPlan` x `depthInPlan`), 384 px on the long side, ambient light plus a
  light from above, transparent background. One shared offscreen WebGL renderer works through
  a queue; results are cached as canvases per home and appearance (model, rotation,
  mirroring, color, materials, size, tilt), so an edit renders only the changed piece. The
  plan draws the catalog icon until a view is ready and redraws once per frame as views
  arrive. Models come from the 3D view's model cache; their geometry is not disposed.
- Doors and windows: the frame seen from above is drawn in the opening, the sash arcs on top.
- Preference "Furniture seen from above" (default on); off draws the catalog icons as before.
- Exports and the printed plan draw the furniture from above by default too:
  `export_plan` / `export_document` take `furniture_icons` ("top_view" default, "catalog") and
  `top_views` ({images: key -> PNG base64, pieces: piece ID -> key}; pieces that look the same
  share one image). The frontend renders them (`collectTopViews`): the export dialog itself
  ("Furniture in plans" in the page setup), and for `--live` calls the pipe asks the main
  window (event `render-top-views`) before running the command. Headless exports have no 3D
  renderer and fall back to the icons with a note in `notes`. `msh-export` draws a top view
  stretched to the footprint, for doors and windows under the sashes (the group's mirroring is
  undone for it, the view is rendered mirrored already).

### 4.22 Status after P8a (2026-11-08)

- Commands: `wall_reverse` (start and end swap; side colors, shininess, textures and
  baseboards change sides, heights at start and end swap, the arc extent changes its sign, so
  the wall looks the same), `furniture_align` (left / right / front / back side in the leading
  piece's orientation, top, bottom, side by side; the leading piece is `leader` or the last of
  `ids`, i.e. the one selected last, like Sweet Home 3D), `furniture_distribute` (equal gaps
  along x or y, the outer pieces stay), `edit_paste_style` (style of the first copied element
  of the same kind: wall colors, textures, baseboards and pattern (thickness and heights
  stay, they are geometry); room
  floor, ceiling and text styles; furniture color, texture and materials of the same model;
  polyline, dimension and label styles; textures of the copied element are merged into the
  home first, `Clipboard::merged_into`).
- Context menu of the plan (`plan2d/ContextMenu.tsx`), only in the select mode; in drawing
  tools the right click still finishes the drawing. A right click selects the element under
  the pointer (empty space clears the selection); a selected room or line keeps the selection
  near its outline, which often lies under a wall. Items depend on the selection: clipboard,
  delete, flip, group / ungroup, align and distribute (two or three pieces and more), wall
  operations (reverse, split here, join, detach), "Add point here" / "Delete point" for rooms
  and polylines (`room_update` / `polyline_update` with the new points), select all, fit, lock
  or unlock the base plan. The menu stays inside the plan and scrolls when the plan is low.

### 4.23 Status after P8b (2026-11-08)

- Furniture handles like Sweet Home 3D's indicators, drawn as icons just outside the corners
  (they no longer hide small pieces): rotate (top-left), elevation (top-right), resize
  (bottom-right) and height (bottom-left), in the piece's orientation. Elevation and height
  follow the vertical drag distance (cm of the plan); a non-deformable piece keeps its
  proportions when its height changes. Cursors say what a handle does: SVG cursors for
  rotating, elevation, height and bending walls, resize cursors along the actual direction
  (piece corners, wall thickness across the wall).
- Doors and windows in walls (msh-core `fit_in_wall`): the depth follows the wall thickness
  (the `wallThickness` part of the depth is the wall, if the piece is resizable and
  width/depth deformable), and the piece moves across the wall so that this part lies on the
  wall axis (Sweet Home 3D's placement; the example homes keep their positions exactly).
  Used by `furniture_add_in_wall` and by `wall_update` when the thickness changes (pieces
  parallel to the wall with their center inside it).
- Dragging a single door or window (`moving.ts` `slideInWall`): within 30 px of a straight
  wall it slides along that wall, keeps the side it opens to and takes the wall's depth. The
  free space to the neighbors (the inner faces at the wall ends, or other openings in that
  wall) is drawn on both sides with its length. Magnetism snaps to the middle of the free
  space and puts the center or an edge in line with doors and windows of parallel walls,
  also on other levels (guide line and note at the pointer); otherwise to whole cm.
- Properties of a door or window in a wall: "Space left / right" (or top / bottom for walls
  running down the plan) to its neighbors; typing a value moves the piece along the wall.

### 4.24 Status after P8c (2026-11-08)

- Text styles (msh-core `commands/text.rs`): font family, bold, italic and size for labels
  (`label_update`), dimensions (`dimension_update`), room name and area (`room_update`,
  `name_*` / `area_*`) and furniture names (`furniture_update`, `name_visible` and `name_*`).
  Stored as SH3D `textStyle` elements (an empty font name means the default font; bold and
  italic are written only when set). Properties panel: shared `TextStyleFields`; furniture
  have "Name in plan". The plan and the SVG/PDF export draw the styles.
- Height dimensions: `dimension_add_height` creates SH3D elevation dimensions (start and end
  at the same point, different elevations, visible in 3D). The plan shows them as a marker
  with the measured height; the context menu adds one for a selected wall (0 to its height at
  the start) or piece (its elevation to its top, at the front right corner).
- Automatic dimensions: while a single wall (both faces) or piece (width at the back, depth at
  the right) is selected, its dimensions are drawn next to it (`plan2d/autoDims.ts`); "Add
  dimensions of the wall / piece" in the context menu turns them into dimension lines.
  Placing a dimension also snaps to furniture corners, with guide lines and "corner of …".
- Curved polylines: `curved` on `polyline_add` / `polyline_update` sets SH3D's `CURVED` join
  style; plan, export and 3D draw a Catmull-Rom curve through the points (`plan2d/curve.ts`).
- Compass in the plan: selectable (unless the base plan is locked), draggable, a handle beyond
  the north arrow turns north (5° steps, Shift 1°), a handle on the ring changes the diameter.
  Delete or "Hide compass" hides it (the compass is part of every SH3D home).

### 4.25 Status after P9a (2026-11-08)

- Virtual visit with game-like controls (`view3d/visitor.ts`): drag with the mouse to look
  around, W A S D (or the arrow keys) to walk, Q / E down and up, Shift faster, the mouse
  wheel changes the field of view (20°..120°). Keys typed in the 3D view never reach the plan.
- Collision: walls stop the visitor (radius 20 cm) when they overlap its body between the
  floor of its level (+ 30 cm step) and its eyes; it slides along them. The floor comes from
  the levels, not from a fixed eye height (points of view use different eye heights). Doors and windows starting near the floor (≤ 30 cm) and at
  least 150 cm high open a passage through their wall. A visitor placed close to a wall (e.g.
  by a stored point of view) may move along it or away from it, never closer.
- The visitor is drawn in the plan (body and field of view) on the level it stands on; it
  follows the selected level like Sweet Home 3D's "adjust elevation to level".
- In the plan the visitor (selection id `observer`, not an element of the home) can be selected,
  dragged and turned with a handle in front of it; arrow keys move it, R turns it by 15°.
  Its properties (position, eye height above its floor, direction, head tilt, field of view)
  are editable; all of it goes through `camera_set`.
- Cameras: moving in the 3D view is kept in the frontend (no undo steps, no scene rebuilds)
  and written into the home with `camera_set` before saving. `Registry::add_view` registers
  commands that change only the view (no undo step, home not marked modified); the UI
  follows camera changes made by commands (CLI, MCP, points of view); `HomeView.cameraMoves`
  counts them, so choosing the same point of view again moves the view too.
- Points of view: `viewpoint_store` / `viewpoint_go` / `viewpoint_rename` / `viewpoint_delete` / `viewpoint_list`
  (Sweet Home 3D `storedCamera`: `observerCamera` element for the visit, `camera` for the
  aerial view, newest first, at most 50); "Points of view" menu in the 3D view. Going to one
  switches the view mode and selects the level of the point of view.
- `view3d_update all_levels_visible` and the "All levels" switch in the 3D view.
- `camera_get` returns both cameras and the active one. Verified with Sweet Home 3D's reader.

### 4.26 Status after P9b (2026-11-08)

- 3D view settings (non-modal "3D settings…" panel, `view3d_update`): ground and sky color or
  catalog texture, light brightness (stored as Sweet Home 3D's gray `lightColor`, 100 % =
  0xD0) and walls transparency (`wallsAlpha`), besides "all levels".
- Location: `location_search` asks OpenStreetMap Nominatim (msh-core uses `ureq`, one request
  per search, identified by the application name); `location_set` stores latitude,
  longitude and the IANA time zone in the compass. The time zone cannot be derived offline
  from a position: the home's (else this computer's) is kept and can be chosen in the panel.
- Sun: `sun_update` stores the date and time (in the home's time zone, `chrono-tz`) as the
  `time` of both cameras like Sweet Home 3D; without one the sun stands at summer noon.
  "Follow the current time" is the home property `mySweetHome.sunFollowsClock`.
  `sun_get` computes azimuth, elevation and the direction in the plan offline (Astronomical
  Almanac formulas; within 0.1° of Sweet Home 3D's `Compass.getSunAzimuth/Elevation`).
- The 3D view places the sun light (and its shadows) from `sun_get`, updates it every minute
  when it follows the clock, dims the sun near the horizon (warmer color) and turns it off at
  night, when the ambient light is lowered. Photos and videos use the same sun.
- Verified with Sweet Home 3D's reader: compass time zone and position, camera time, colors,
  light, walls alpha and the property.

### 4.27 Status after P9c (2026-11-08)

- Tilting: `furniture_update pitch_deg / roll_deg` (not doors, windows or pieces that are not
  horizontally rotatable) stores `widthInPlan`, `depthInPlan`, `heightInPlan` like Sweet Home
  3D (box rotated with Rz(−roll) · Rx(−pitch); identical values to its own computation), so
  plan, dimensions and 3D use the tilted size. Properties: "Tilt forward / sideways".
- Lights: `furniture_update power` (percent) and `spot_angle_deg` (our piece property
  `mySweetHome.spotAngle`; the cone lights downwards through the bottom of the piece and
  follows its tilt; narrow cones are brighter). The 3D view lights the 16 lamps nearest to
  the visitor; photos use up to 48 lamps of the shown levels, also in the aerial view. Lamp
  light positions now use exactly the piece's transform.
- Glowing light sources: model materials listed as light source materials (Sweet Home 3D 7)
  are emissive in the light's color while the lamp is on; path traced photos let them emit.
- Photos: `render_settings_update` stores the lens (camera `lens`) and the ceiling lights
  (`ceillingLightColor`). Fisheye (180°, circular, equidistant) and spherical (360°
  panorama) photos render a panorama first (path traced with three-gpu-pathtracer's
  EquirectCamera, drafts from a cube map) and convert it (`view3d/lens.ts`). Ceiling lights
  are point lights under the ceiling of each room, brighter for larger rooms. The photo
  dialog also sets the date and time of the sun.
- At night the sky darkens with the daylight (background, sky texture, photos).
- Fixed: changing the sun time or the lens moved the 3D view back to the stored camera (only
  the pose of a stored camera counts now).

### 4.28 Status after P10 (2026-11-08)

- Staircases cut holes (`view3d/staircase.ts`): the piece's `staircaseCutOutShape` (SVG path
  in the unit square; M, L, H, V, C, S, Q, T, A, Z) placed like the piece removes its outline
  from the floors of the levels it reaches up to and from the ceilings it reaches through
  (CSG on the floor slab; ceilings are cut as a thin slab whose lower faces are kept).
- Walls and pieces of other levels in the plan, like Sweet Home 3D's `isAtLevel`
  (`wallAtLevel`, `pieceAtLevel` in model.ts): walls of lower levels that reach into the
  level, pieces whose top reaches above its floor (staircases up to its floor), and items of
  lower levels at the same elevation are drawn, picked, snapped to and edited there.
- Shelf units: catalog pieces with `shelfElevations` / `shelfBoxes` become `shelfUnit`s
  with shelves relative to their size (as Sweet Home 3D stores them, so resizing keeps
  them). With magnetism a smaller piece moved onto a larger one lands on its top
  (`dropOnTopElevation`) or on the shelf of a shelf unit nearest to its elevation, and back
  on the floor when moved off it (`plan2d/support.ts`); the elevation handle snaps to tops
  and shelves. Verified with Sweet Home 3D's reader.
- Walking stairs in the virtual visit: on a staircase's footprint the floor rises from its
  front to its back up to the level it leads to; the eyes keep their height above the
  steps. The level ahead is selected while on the stairs, so the floor above is shown
  instead of the sky through the hole.

### 4.29 Status after P11 (2026-11-08)

- One window per home, like Sweet Home 3D: the backend keeps a document per window label
  ("main", "home-2", ...); Tauri commands act on the home of the calling window (a separate
  3D window "view3d-<home window>" on its home). Events go to the home window and its 3D
  window only (`emit_home`); the frontend listens per window. "New" and "Open…" (Ctrl+N,
  Ctrl+O) use the current window while it is untouched, otherwise a new window
  (`new_window`). The clipboard is shared, so elements can be copied between homes.
- The CLI and the MCP server control the home of the window focused last.
- Window titles show the home's name and * for unsaved changes. Closing a window with
  unsaved changes asks Save / Don't save / Cancel; the app ends with its last home window.
- Autosave and recovery (`app/src-tauri/src/autosave.rs`): every 5 minutes a copy of each
  home changed since its last save or autosave goes to `%APPDATA%\ch.mysweethome.app\
  recovery` (`<key>.sh3d` and `<key>.json`); saving or closing a home removes it. After a
  crash the first window offers the copies (Open / Discard / Later); a recovered home keeps
  its original path and is marked as changed. `MSH_AUTOSAVE_SECONDS` shortens the interval
  for tests.

### 4.30 Status after P12b (2026-11-08)

- The approved P12a design is in the app. All UI actions are defined once in
  `app/src/ui/commands.ts` (label, icon, shortcut, enabled / checked state, action); the menu
  bar, the tool bar, the keyboard shortcuts, the command search and the shortcut overview
  are built from these definitions. The actions run registry commands of msh-core, so UI,
  CLI and MCP stay equivalent.
- Menu bar with eight categories (File, Edit, Plan, Levels, Furniture, 3D view, Extensions,
  Help), submenus, check marks and shortcuts. Ctrl+K opens the command search over all menu
  commands (name, menu path, keywords); F1 lists the keyboard shortcuts.
- Tool bar in groups (file, history, selection, drawing, levels, arrangement, view; on the
  right the view mode, photo, video, theme and preferences). Split buttons run the variant
  chosen last with one click; only the small arrow lists the variants (straight / round
  walls, room by corners / from walls, dimension / height dimension, flip horizontally /
  vertically); the choice is remembered. New plan tools for the variants: pan, round walls
  (`wall_add_path` with `arc_extent_deg`, one undo step), room from walls by one click,
  height dimension by one click.
- Icon set of 79 icons (24 px grid, 1.75 stroke) as React component (`app/src/ui/Icon.tsx`).
- Light and dark theme with the colors of the design; the default follows Windows, the
  tool bar switches it; the choice applies to all windows of the app (local storage).
- All dialogs and panels move by dragging their header (`app/src/ui/dialogDragging.ts`,
  no change to the dialogs needed). Dialogs opened by commands live in a small UI store
  (`app/src/ui/uiStore.ts`); dialogs of the 3D view open in the separate 3D window when the
  view is shown there.

### 4.31 Status after P12c (2026-11-08)

- Preferences dialog on tabs (Plan, New elements, 3D view, General); changes apply at once,
  are kept in the WebView's local storage (`app/src/preferences.ts`) and reach all windows
  of the app. "Reset all" restores the defaults.
- Units cm, mm, m and inch / foot (`app/src/units.ts`). Homes, commands, CLI and MCP stay in
  cm; the UI converts what it shows and what is typed: input fields with unit "cm", plan
  dimensions, lengths while drawing (typed lengths too), rulers (feet and inches for the
  inch unit), areas (m² or ft²), catalog sizes. Fields also accept an explicit unit, e.g.
  "12 mm", "1.5 m" or 5'3".
- Defaults of new elements: wall thickness, wall height of new homes, wall pattern and side
  colors, room floor color, floor thickness of new levels, text size. `wall_add_path`
  accepts `pattern`, `left_side_color` and `right_side_color`, so a new wall gets them in
  the same undo step.
- Plan: angle steps of the magnetism (1°, 5°, 15°, 45°), room rendering (floor color or
  texture, or one color), colors of the wall side marks; rulers, grid, furniture seen from
  above and magnetism as before.
- 3D view: quality (resolution and shadow map size) and walking speed of the virtual visit.
- General: theme (like Windows, light, dark) and autosave interval (off to 30 minutes; the
  backend gets it through `set_autosave_interval`). Size, position and maximized state of
  the windows are remembered (`tauri-plugin-window-state`).
- The language setting comes with the German translation (P12d).

### 4.32 Status after P12d (2026-11-08)

- German user interface. UI strings stay English in the code and are wrapped in `t()` from
  `app/src/i18n` (the English text is the key, like gettext; placeholders `{name}`);
  `app/src/i18n/de.json` holds the German texts, a missing entry shows English. Menus,
  tool bar, panels, dialogs, plan hints, context menus and native dialogs are translated;
  shortcuts show German key names (Strg, Umschalt, Entf).
- Language preference (like Windows, English, Deutsch) in the General tab; changing it
  reloads all windows, so texts built when a module loads are translated too. The catalog
  shows its furniture names and categories in the same language where the libraries have
  translations.
- Number and date formats follow the language with the region of Windows when it speaks
  that language (decimal comma for de-DE, point for de-CH), in fields, plan dimensions,
  areas and rulers; typed numbers accept comma and point.
- `scripts/check.ps1` runs `app/scripts/i18n-check.mjs`: it fails on entries no longer
  used in the code and on placeholders that differ, and reports untranslated texts
  (`--missing` lists them).
- Error messages of msh-core (also used by CLI and MCP) stay English.

### 4.33 Status after P12e-a (2026-11-08)

- Furniture import of more formats, in msh-core (`model_formats.rs`, so CLI and MCP get them
  too): 3MF (colors of base materials and color groups, units, components and build
  transforms), STL (binary and ASCII), PLY (ASCII and binary, vertex colors as one average
  color) and ZIP / KMZ archives (unpacked; the main model inside is chosen by format and
  depth). STL and 3MF are millimeters with z up and become y up in cm. All become OBJ + MTL.
- FBX and VRML (WRL) have no Rust reader: the import dialog reads them with the three.js
  loaders (textures next to the file are found in a first pass), exports GLB and hands it to
  the glTF converter of msh-core. FBX units are guessed from the size (cm or mm to meters).
- Texture import (`texture_formats.rs`): WebP and TIFF are converted to PNG, SVG is rendered
  to a 1024 px PNG, and from PBR material packages (ZIP) the color map is taken (by name:
  base color, albedo, diffuse, color). The other maps are not used yet.
- Files dropped onto the catalog: libraries (.sh3f / .sh3t) are imported, a model opens the
  furniture import with it (MTL and textures dropped along lie next to it), images and
  material packages become textures of "My textures"; a ZIP is tried as model first.

### 4.34 Status after P12e-c (2026-11-08)

- Online sources in msh-core (`commands/online.rs`): `online_search` lists the free
  libraries of Sweet Home 3D (newest version folder of the SourceForge RSS listing), the CC0
  materials of ambientCG (API v3, with preview, real tile size and package size) and the
  CC0 textures and models of Poly Haven (most downloaded first, filtered by the search
  words). `online_download` fetches one item into a temporary folder: a library is
  unpacked from its ZIP, an ambientCG material is its JPG package (ZIP), a Poly Haven
  texture its color map, a Poly Haven model its glTF with all included files. Only the
  search text is sent; downloads are limited to 500 MB.
- The app's "Online catalogs" dialog (Furniture menu, catalog link "Online…", command
  search) shows the results with previews and imports with one click: libraries with
  `library_import`, textures with `texture_import` (name, creator and tile size of the
  source, category = source name), models through the furniture import dialog (icon,
  upright position, size). Resolution 1K / 2K / 4K for textures and models. Poly Haven's
  required credit ("Powered by Poly Haven") is shown on its tab.
- Preference "Online catalogs" (General, on by default) hides the dialog and its entries.
  The CSP allows preview images from cdn.polyhaven.com and ambientCG's media server.
- Parsers are tested offline with sample answers; a live search test is marked
  `#[ignore]` (`cargo test -p msh-core online -- --ignored`).
- Own catalog servers: the format "msh-catalog" (one JSON feed listing models, textures and
  libraries, see `docs/CATALOG_FEED.md`) is read from HTTPS, a file share or a local folder
  (`online_search` / `online_download` with `source: "feed"`, `url`, optional `token`; the
  token is sent as Bearer only to the feed's own host). Catalogs are added in Preferences ›
  Catalogs (or "Add catalog…" in the online dialog) with Test button; each appears as an own
  tab. Downloaded models and textures are named after the item; category and creator are
  passed to the import.
- The online dialog keeps its state (source, search, results, scroll position): after the
  furniture import dialog closes (import or cancel), the user returns to the same place.
  The import preview can be rotated with the mouse (drag), zoomed (wheel) and reset
  (double-click).

### 4.35 Catalog management (2026-11-08)

- Where catalog content lives: the default catalog of an installed Sweet Home 3D
  (`Furniture.jar` / `Textures.jar`); the installer does not bundle it (see 4.36).
  Everything the user adds — imported libraries, single imported models and textures, items
  from online catalogs — is written to Sweet Home 3D's user library folders
  (`%APPDATA%\eTeks\Sweet Home 3D\furniture` / `textures`, "My furniture.sh3f",
  "My textures.sh3t"). The catalog is therefore global: every home, new or old, sees it,
  and Sweet Home 3D shares it. Homes embed the models and textures they use, so they stay
  portable.
- My Sweet Home's own catalog settings (`catalog_settings.rs`,
  `%APPDATA%\ch.mysweethome.app\catalog.json`) hold hidden libraries and categories the user
  gave items. They work for read-only libraries too and leave the library files untouched.
  Commands: `library_set_visible`, `catalog_set_category`; `library_list` reports `hidden`.
  Both the core's catalog index and the app's `catalog_load` apply them.
- UI: the Libraries dialog has a "Shown" checkbox per library (remove stays for the user's
  own libraries). Catalog items are dragged onto another category, or onto the "new
  category" zone shown while dragging, to move them. The furniture and texture import
  dialogs pick the category from the existing ones or take a new one.

### 4.36 Status after P12f (2026-11-09)

- `scripts/build-installer.ps1` builds the MSI: it collects `LICENSE`, `NOTICE.md` and the
  generated `THIRD-PARTY-NOTICES.txt` (`scripts/third-party-notices.mjs`) into
  `app/src-tauri/resources/legal/` (git-ignored), builds the CLI as Tauri external binary
  (`app/src-tauri/binaries/msh-<target triple>.exe`, git-ignored) and runs
  `pnpm tauri build` with `tauri.installer.conf.json` merged in. Normal builds
  (`cargo build`, `pnpm tauri dev`) do not need these inputs.
- The installer (per machine, `C:\Program Files\My Sweet Home`) contains the app, `msh.exe`,
  and the license files in `legal\`; it adds the folder to the system `PATH`
  (WiX fragment `wix/cli-path.wxs`, removed on uninstall), registers `.sh3d` files and embeds
  the WebView2 bootstrapper (WebView2 is part of Windows 11; on systems without it the
  bootstrapper downloads it).
- Library discovery (`msh_catalog::find_libraries`): a catalog folder given by
  `MSH_CATALOG_DIR` (or `catalog` next to the executable, e.g. in a portable setup) comes
  first; an installed Sweet Home 3D only adds default catalog files that folder lacks, so no
  item appears twice. Since 2026-11-11 the installer no longer bundles Sweet Home 3D's
  default catalog (license and attribution duties of redistributing it; see D3). User libraries and the Store version's libraries are found as
  before.
- Single instance (`tauri-plugin-single-instance`): starting the app again, e.g. by double
  clicking a `.sh3d` file, opens the file in a new window of the running app (or brings the
  focused window to the front), so one app owns the pipe of the CLI and the MCP server.
- Updates prepared: `-Sign` creates the update artifacts (`.msi.sig`) with the private key
  from `TAURI_SIGNING_PRIVATE_KEY` or `%USERPROFILE%\.msh\updater.key` (created on first use,
  never in the repository). The updater plugin is added once the update source is decided.

### 4.37 Wall length and dimension placement (2026-11-09)

- Walls have one length: the distance between their end points (the axis), the same value
  as the coordinates. The properties panel edits it (`wall_update` with `length`: the start
  stays, the end moves along the wall, and the wall joined at the end moves in parallel, so
  corners keep their angles). The selected wall shows exactly this length as a single
  dimension with extension lines, on the side away from its joined walls; "Add dimensions
  of the wall" adds that dimension. The lengths of both faces are no longer shown.
- Dimension tool: start click, end click, then the mouse places the dimension line (left
  or right, any distance), a third click finishes it; a typed number + Enter sets the
  distance, Esc cancels.
- With the centimeter unit, lengths are always shown in cm (dimension lines, panels,
  previews), no switch to meters from 1 m on.

### 4.38 Logo and icons (2026-11-09)

- Logo: isometric house (white gable with door and window, coral roof, chimney) with a
  dimension line along the side wall, on a dark blue rounded tile; it stands for 3D view and
  planning. Masters in `app/src-tauri/icons/source/`: `logo.svg` (48 px and larger),
  `logo-small.svg` (16–32 px, without the dimension line, which is too fine there) and the
  `.sh3d` file icon (`file-sh3d*.svg`: page with the logo).
- `node scripts/build-icons.mjs` (in `app/`) generates everything from them: the Tauri icon
  set, `icon.ico` (exe, window, taskbar, shortcuts) and `sh3d-file.ico` with small and large
  images mixed, and `public/favicon.svg`. It touches `build.rs`, because Cargo does not
  notice changed icons.
- The MSI installs `sh3d-file.ico` and sets it as `DefaultIcon` of the advertised ProgId
  `My Sweet Home.sh3d` (WiX fragment `wix/cli-path.wxs`), because Tauri registers file
  associations without an icon of their own.

### 4.39 Doors and windows: sashes and opening side (2026-11-09)

- Sashes are drawn as pie (both edges and the arc) like Sweet Home 3D; models differ in which
  of their angles is the open position, so one edge only lost the open sash of some windows.
- A door or window opens to the side of the wall it is dropped on, and turns to the other
  side when it is dragged clearly across the wall (its wall part more than a quarter of the
  wall thickness, at least 5 cm, off the axis).
- Thick walls get a reveal instead of a stretched door: the part `wallThickness` of the depth
  is the wall. Up to that thickness the depth follows the wall as in Sweet Home 3D. In a
  thicker wall the piece keeps its real depth (from its catalog item, else its current depth),
  so frame and handle keep their size; it sits flush with the wall side it opens to and gets
  `wallCutOutOnBothSides` (msh-core `fit_in_wall`, frontend `fitInWall`). The 3D view always
  cuts openings through the whole wall; the plan now clears the wall across the width of every
  door and window as well.

### 4.40 Imported staircases and walking on real steps (2026-11-09)

- `furniture_import` takes `staircase` (and optionally `staircase_cut_out_shape`, an SVG path
  in the unit square; default the whole piece), stored as `staircaseCutOutShape` in the user
  library like Sweet Home 3D. The import dialog has a "Staircase" check box.
- The virtual visitor walks on the steps of the model instead of a straight ramp: a ray down
  through the loaded staircase models (`view3d/stepSurfaces.ts`) gives the upward faces at its
  position, and it stands on the highest one at most a step above its feet, or on a floor
  where the staircase cuts no hole. Spiral and other curved staircases can be walked up; the
  straight ramp is still used while a model is loading.

### 4.41 Library editor (2026-11-09)

- One place for everything about libraries; it replaces the libraries dialog and takes in the
  import steps. Principle: one way per result. The catalog in the side bar keeps two entries,
  "Add…" (opens the editor and at once the file dialog for models or images, for furniture and
  textures alike since 2026-11-18; online search and furniture of the home are in the editor's
  Add menu; files dropped onto the catalog lead to the same import) and "Libraries…"; the menus offer "Add to library…" and
  "Libraries…". Moving items to another category is no longer done by drag and drop but through
  the item's context menu ("Move to" with the categories and "New category…"), the same menu in
  the catalog and in the editor (`catalog/library.ts`, `plan2d/ContextMenu.tsx` with sub-entries).
- msh-catalog `library_edit.rs`: `EditableLibrary` reads only the properties of a library (main
  and translations `…_de.properties`) and the names of its files; resources are read when an
  item is copied. Saving writes the properties and copies unchanged files without unpacking them
  (`raw_copy_file`), then replaces the file atomically: a change to a 30 MB library takes well
  under a second instead of half a minute. Items are changed, moved (a category shown through a
  translation keeps both languages), copied with their resources and a new catalog ID, removed
  with the resources no other item uses. `record` keeps copies of the files before and after
  each change in the temporary folder for undo / redo (30 steps).
  `user_library` adds imports to any editable library through it.
- Commands (msh-core `commands/library_edit.rs`): `library_create`, `library_rename`,
  `library_items` (search over all libraries), `library_item`, `library_update_item` (keys of
  Sweet Home 3D's format, with `lang` for translations), `library_move_items`,
  `library_copy_items` (also "edit as copy" for read-only items and duplicate),
  `library_remove_items`, `library_add_category` (empty categories are kept in the catalog
  settings), `library_categories`, `library_set_icon`, `library_add_from_home`, `library_undo`,
  `library_redo`, `library_history`; `furniture_import` / `texture_import` take a target
  `library`. Editable are the libraries in the user's library folders (also imported ones, shared
  with Sweet Home 3D); the installation's libraries are read-only. `library_list` reports
  `editable`.
- App (`catalog/LibraryEditor.tsx`): kind switch, libraries (rename, new category, show or hide,
  remove), search over all libraries, items by category; preview by kind: 3D model (turned by
  dragging, "Icon from view", upright in 90° steps), texture on a 4 × 2.5 m wall at its real tile
  size, the opening of doors and windows on their front and the floor hole of staircases from
  above, both drawn as a rectangle with handles (`catalog/ShapeEditor.tsx`); properties in tabs
  (general, size and model, kind: furniture, door or window, staircase, light with its light
  sources, shelf). Changes are saved at once; Ctrl+Z / Ctrl+Y and the buttons undo and redo.
  The catalog DTO lists hidden libraries too (`catalogAll` in the store, the catalog filters
  them) and gives each item its index in the library; `catalog_load` keeps parsed libraries
  and reads again only files whose size or time changed. The editor window is moved by its
  title bar, resized at its edges, maximized (button or double-click on the title bar); the
  side panes and the split between libraries and items are dragged (double-click: default);
  the layout is kept in the browser storage.
- The 3D view now cuts openings with their own outline (`doorOrWindowCutOutShape`, e.g. round
  arches or an opening smaller than the frame) instead of the whole box.

### 4.42 Tests (2026-11-10)

- Every command module of msh-core has its own integration test file
  `crates/msh-core/tests/cmd_<module>.rs`: result, exact undo/redo (serialized home before
  and after), no undo step for getters, view commands and exports, invalid input, and
  saving and reopening where the value is stored in the file. Shared helpers are in
  `tests/common/mod.rs`; `run_err` also checks that a failing command leaves the home and
  the undo history unchanged.
- Library and import tests run in a child process of the test binary
  (`common::isolated_catalog`) whose user folders point at a temporary folder, so they
  never touch the user's libraries. Tests that need the installed Sweet Home 3D catalog
  skip without it; online tests use local feeds and only checks that fail before a request.
- The frontend uses Vitest (`pnpm test` in `app/`, `src/**/*.test.ts`, config in
  `vitest.config.ts`): pure logic of the plan (snapping, moving, handles, hit testing,
  drawing helpers), the 3D view (visitor, staircases, scene helpers), units, i18n and the
  recent homes. React components and WebGL are not tested. `src/testFixtures.ts` builds
  homes for the tests; `src/testSetup.ts` fixes the language to English.
- `scripts/check.ps1` runs the Rust tests, Vitest and, when Sweet Home 3D and a JDK are
  installed, `compat-check.ps1`.
- Bugs found and fixed: a failing command emptied the redo history; `furniture_group`
  accepted the same piece twice; a failed `camera_set` left a new camera behind;
  `label_add` accepted empty text and non-positive font sizes; `polyline_update` closed
  two-point lines; the plan's direction readout showed 360° instead of 0°.

### 4.43 Pivot of the aerial view, icons (2026-11-10)

- The point the aerial view turns around (target of OrbitControls, `view3d/pivot.ts`) is
  shown while the pointer is over the 3D view: a crosshair in the middle of the view and,
  when the point is above or below the ground, a dashed line down to the ground with a ring
  there (drawn only by the live render loop, not in photos, videos or captures).
- Double-click on a surface (not the sky; else the plane at the pivot's height) makes it the
  new pivot; the camera slides along so the point comes to the middle. The crosshair button
  at the bottom right fits the home from the current direction and turns around its middle.
- A stored camera now turns around the point of its view line nearest to the middle of the
  home (before: where the view hit the ground, which could be far away).
- "Fit" in the plan, toolbar and 3D view uses a crosshair icon; the pane buttons
  (maximize, restore, minimize, separate window) and the library editor use SVG icons of the
  icon set. The 3D view settings open centered in the window.

### 4.44 Textures of model materials, texture cache (2026-11-10)

- A texture given to a material of a model without texture coordinates (e.g. the default
  doors) used to show as one color. Such meshes now get texture coordinates in centimeters
  of the piece (`view3d/textures.ts`, `boxProjectedUvs`): each triangle takes the two axes
  across its normal, so a door shows the image upright at its real size (texture width,
  height, scale and angle). Models with their own texture coordinates keep them.
- Texture images of the 3D view are loaded once per open home and shared
  (`cachedTexture`). Rebuilding the scene after a change no longer renders all textured
  surfaces black until their images load again; a new image shows a white placeholder
  until it is there. When it arrives, the texture's GPU memory is freed first: three.js
  allocates it at the size of the first upload (the 1×1 placeholder), and a larger image
  would otherwise not show until the next rebuild. The top view icons and the OBJ export wait for or skip such textures.

### 4.45 Faster scene rebuilds (2026-11-10)

Every change rebuilds the 3D scene. A profile of the release build showed that most of the
time went into cutting door and window openings into all walls (CSG) and into compiling the
shader programs again; the GPU needs 1–8 ms per frame and is not the limit.

- `WallGeometryCache` (`buildScene.ts`) keeps the cut geometries of walls and baseboards
  from one build to the next. A geometry is found by everything that shapes it: the prism
  (outline, edge kinds, base, heights at the outline's points, texture axis) and the
  attributes of the openings whose cut touches it. A changed wall or a moved door is cut
  again, everything else is reused; unused geometries are freed after each build. Only the
  3D view passes a cache, other callers build as before.
- The replaced scene is freed after the first frame of the new one (`trash` in `View3D`),
  so the new materials take over the compiled programs instead of compiling them again. At
  most one replaced scene waits; content that was never drawn is freed at once.
- Geometries, materials and textures of cached models belong to the model cache
  (`modelParts` in `models.ts`) and are freed with it, not with every scene: pieces share
  them, and freeing them uploaded them to the GPU again after every change.
- Materials are marked for recompilation only when shadows are switched on or off.
- `formatNumber` keeps one `Intl.NumberFormat` per locale and decimals instead of creating
  one for every cell of the furniture list.
- A texture image is stored once per home (`Document::add_or_reuse_content`, used by
  `embed_texture`): a texture on another wall, floor or piece, or applied again, reuses the
  top-level resource with the same bytes, as Sweet Home 3D shares a content between its
  users. Before, every assignment added a copy; a home with its rooms and walls textured
  one by one grew from 3 to 59 MB instead of 5 MB, and the views loaded each copy again
  because they cache resources by name.
- The same holds for furniture (`embed_furniture_resources`): a piece placed again reuses
  its model (a single file, or a model folder with exactly the same files through
  `Document::add_or_reuse_folder`), icon and plan icon; background images too. Sweet Home 3D
  reads such files with the same content bytes as files with copies.

Measured over CDP on the release build (median of 10 edits, time until the changed view is
drawn): example home 226 → 66 ms, a real home with 47 pieces and 48 walls 152 → 40 ms; the
3D images before and after are identical.

### 4.46 Furniture dialog and furniture list like Sweet Home 3D (2026-11-10)

- `furniture_update` takes the rest of Sweet Home 3D's furniture dialog: `texture` (catalog
  ID of a texture for the whole piece, written without a role; it and a color exclude each
  other), `shininess` (0 matt, Sweet Home 3D's "shiny" 0.25, negative = the model's),
  `description`, `price`, `vat_percent` (stored as Sweet Home 3D's fraction,
  `valueAddedTaxPercentage` 0.081 = 8.1 %), `currency` and `base_plan_item` (`movable`
  false; doors and windows always belong to the base plan).
- The 3D view follows Sweet Home 3D's order: a color of the piece replaces everything, else
  its texture, else the changes of single materials; a shininess of the piece applies to all
  its materials (matt also drops the highlight color).
- Preferences › General › Prices: currency (none by default; like Sweet Home 3D, prices are
  shown only with a currency), value added tax on or off, default VAT for pieces whose price
  is set without one (`app/src/prices.ts` formats amounts with `Intl.NumberFormat`).
- The properties panel shows description, price, VAT and the price with VAT, texture and
  surface (like the model, matt, shiny) for the whole piece, "Part of the base plan", and
  creator, license and information link. The light power and cone fields were hidden in the
  German interface (the kind was compared with a translated word); fixed.
- Furniture list (`catalog/furnitureColumns.ts`): all of Sweet Home 3D's columns, chosen per
  home with `home_set furniture_columns` and stored as `furnitureVisibleProperty` (so Sweet
  Home 3D shows the same columns); defaults when a home stores none. Price columns need a
  currency, VAT columns VAT switched on; a totals row sums price, VAT and price with VAT.
  Groups count the prices of their pieces.
- Matt or shiny wall sides, floors and ceilings: `wall_update left_side_shininess /
  right_side_shininess`, `room_update floor_shininess / ceiling_shininess` (Sweet Home 3D's
  attributes; "shiny" = 0.25), a "Surface" choice in the panels; the 3D view uses a Phong
  material with a highlight for shiny surfaces (`surfaceMaterial`).
- Photos of points of view (like Sweet Home 3D's "Create photos at points of view"): the
  photo dialog lists the stored points of view; for the chosen ones it goes to each with
  `viewpoint_go`, renders a photo with the dialog's settings and saves it into a chosen
  folder as "<home> - <point of view>.png" (`view3d/photoSeries.ts`), then returns to the
  view it started from (`syncCameras`, `camera_get`, `camera_set`). CLI and MCP get the same
  with `viewpoint_go` and `msh photo`.
- Header and footer of printed pages (`export_document header / footer`, default: the
  home's page setup `<print headerFormat footerFormat>` from Sweet Home 3D) with Sweet Home
  3D's variables `$pageNumber`, `$pageCount`, `$planScale` (plan pages), `$name`, `$file`,
  `$date`, `$time` and `$$` (`msh_export::expand_page_format`); the header stands at the top
  right, a footer replaces the default footer text. The print dialog has both fields,
  preset from the home. The page setup itself is not yet stored in the home.
- Not adopted: rotating the background image (Sweet Home 3D cannot either).
- User guide (Help › User guide, F1; the shortcut overview stays in the Help menu): one
  Markdown file per language, `app/src/help/guide.<lang>.md` (English as fallback), one
  topic per `# ` heading, shown with topics, search and links between topics. A small reader
  of our own (`help/markdown.ts`) builds plain objects that React renders, so no HTML from
  the text reaches the page. Long help texts live in these files rather than in `de.json`;
  a test checks that every language has the same topics and sections.
- French and Italian user interface (`i18n/fr.json`, `i18n/it.json`, machine translated with
  the terms of the French and Italian Sweet Home 3D; key names Maj / Maiusc, Suppr / Canc).
  "Like Windows" picks them from the system language; number formats use the region of
  Windows when it speaks the language, else fr-FR / it-IT. The catalog shows `_fr` / `_it`
  names where the libraries have them. The user guide is English in these languages.
  `i18n-check.mjs` checks all three translation files.

### 4.47 Memory and startup measured (2026-11-10)

Release build on Windows 11 (RTX 2070), the same home (47 pieces, 48 walls, 2 levels) opened
by double click; time until the window title shows the home, memory 15 s later, summed over
the process tree (the app and its WebView2 processes; Sweet Home 3D 7.6.1 is one Java process).

| | My Sweet Home | Sweet Home 3D |
|---|---|---|
| Start until the home is shown | 1.0–2.0 s | 6.6–8.4 s |
| Private working set (RAM used only by the program) | 206–210 MB | 283 MB |
| Without a home / example home with 132 pieces | 109 MB / 288 MB | – |

- The goal of section 1 (< 2 s start) is met; < 150 MB RAM is not: WebView2 alone needs
  ~100 MB before a home is open, and the page grows with the models (their geometry stays in
  JavaScript for picking, collisions and wall cuts). The Rust core needs 12 MB.
- The GPU process commits ~400 MB of private memory on this NVIDIA driver, of which only
  ~90 MB are resident; Chromium flags limiting GPU memory changed nothing. The furniture top
  views and the 3D quality preference make no measurable difference.
- Working set without "private" double-counts pages shared between the WebView2 processes
  and is therefore not compared.

### 4.48 Selection list, tool keys, rulers, arrow keys (2026-11-11)

- Several selected elements are listed under the common properties
  (`panels/selectionItems.ts`): × takes one out of the selection, a click on its name selects
  only it.
- Keys 1–6 choose the tools in the order of the tool bar: walls, rooms, lines, dimension,
  text, measure.
- Rulers (second mode of the measure tool, split button "Measure / Ruler"): a guide line that
  stays in the plan to help place elements, drawn like a measurement but without its length.
  Kept in the home property `mySweetHome.guides` (JSON list of id, level, start, end), which
  Sweet Home 3D keeps without showing; commands `guide_add`, `guide_list`, `guide_clear`
  (msh-core `commands/guide.rs`), moved with `edit_move` and deleted with `edit_delete` like
  other elements. Selectable by click and rectangle, drawn on screen only (`plan2d/guides.ts`),
  never printed or exported. Each ruler may have its own `color` and `dash_style` (the dash
  styles of polylines; `guide_update`); new rulers get the defaults of Preferences › Tools,
  which also holds the color of the measure tool. A ruler follows the pointer while it is
  moved (`movedGuides`), and a selected ruler has handles at both ends (`guide-start`,
  `guide-end`, snapping like dimensions) that change it with `guide_update`.
- Arrow keys: while a move runs, further presses (also the repeats of a held key) add up and
  go as one move when it is done (`plan2d/nudge.ts`); before, every repeat queued a command
  and the plan kept moving after the key was released.
- The plan keeps the icons, floor textures and background images it has loaded for a home;
  it reloaded all of them after every change and drew floors grey until they arrived.
- Not done on purpose: skipping the 3D scene while the 3D view is minimized. A rebuild costs
  5–15 ms since 4.45 and a hidden view draws next to nothing; photos, videos, printing,
  screenshots and the OBJ export would all need the scene built on demand.
- Ceiling pieces: catalog elevations assume a 250 cm ceiling, so a ceiling spot put on a
  lower level of 238 cm ended inside the floor of the level above and showed on that floor
  (Sweet Home 3D does the same: a piece of a lower level shows on the level above when its
  top is higher than that level's elevation). `furniture_add` without an elevation now lowers
  pieces whose top is above the ceiling of their level until they touch it (not doors and
  windows), and `level_update` keeps pieces touching the ceiling at the ceiling when the level
  height changes. Pieces placed before are not changed.

### 4.49 Location in the home, north from a map, lamp lights (2026-11-11)

- One location component (`panels/LocationFields.tsx`: address search, latitude and longitude
  with four decimals, time zone, north direction) is shown in the 3D settings and in the
  compass section of the home properties; both read the compass, so each shows changes made
  in the other at once.
- North from a map: `location_map` downloads the OpenStreetMap tiles around the location
  (zoom 15 to 19, 3 × 3 tiles, same user agent as the address search, one download per
  opening, zoom step or move of the map beyond the downloaded part) and joins them into one PNG in msh-core, so the WebView's CSP stays as it is.
  The dialog draws the wall outlines over it (`panels/northMap.ts`) at the map's scale; the
  angle that puts the walls onto the building becomes the compass's north direction. The map
  shows the required attribution.
- Lamps whose light comes from materials of their model (Sweet Home 3D 7
  `lightSourceMaterialName`, e.g. the contributed "Mini spot") were placed as plain pieces
  without light; they are now lights with their `lightSourceMaterial`s, and the 3D view gives
  them one white light in the middle of the piece. Pieces placed before stay plain pieces.
- Lamp lights in the virtual visit passed through walls (no shadows). The four lamps nearest
  to the visitor now cast shadows (512 px maps, drawn once and again when models are loaded,
  not every frame); lamp models themselves cast none, since their light source lies inside.

### 4.50 Precise drawing after the UX review (2026-11-17)

- Keys: an open dialog (`.dialog-backdrop`) takes all keys; `ui/keyTarget.ts` tells text
  fields (all keys theirs) from check boxes, drop-downs and sliders (plain keys theirs, Ctrl
  shortcuts for the app). Letters choose tools (`TOOL_LETTERS` in `ui/toolKeys.ts`; R and J
  stay rotate and join), Space held pans with the left button.
- `edit_rotate` (IDs, angle, optional point): rotates walls, rooms, furniture, lines,
  dimensions, texts (upright) and guide lines around a point, by default the center of
  their bounding box. Doors and windows in a rotated wall follow (`carried_openings`, shared
  with `edit_move`), the touching end of joined walls too. `furniture_update` takes
  `rotate_deg` (each piece around its own center). R in the plan rotates furniture each
  around itself and any other selection as a whole. **Edit › Rotate… / Move…** type the
  values (`ui/TransformDialog.tsx`).
- Reference line of walls: `wall_add_path` takes `side` (axis, left, right): the points are
  that line and the axis is the path offset by half the thickness with mitered corners.
  `wall_update` takes `keep_side` (the line that stays when the thickness changes) and
  `direction_deg` (the end turns around the start). Neither is stored: Sweet Home 3D walls
  have only an axis. The plan mirrors the offset for the preview (`sideAxis` in
  `plan2d/snapping.ts`).
- Tool options above the plan (`ui/ToolOptions.tsx`): thickness, height, reference line or
  arc for walls, text size for texts. They live in the store until the window closes.
- Pasting on another level keeps the position (20 cm offset only on the level copied from).
  Paste style leaves wall thickness and heights alone.
- Selection: Ctrl+click toggles like Shift+click, a rubber band with Shift or Ctrl adds,
  **Select similar** (`similarElements`) selects the same kind on the level.
- Context menu of the plan: entries of commands come from the registry (`reg` in
  `PlanView.tsx`), so labels, shortcuts and enabled states match the menus; entries that need
  the clicked point (split wall here, add point) stay local. `ContextMenu` takes the focus:
  arrow keys, Home / End, Enter, Escape; Shift+F10 or the menu key opens it for the selection.
- "Ruler" in the UI now only means the rulers along the edges; the lines drawn in the plan
  are guide lines (the tool and store IDs keep `ruler` / `guide`).
- Open from the review: door and window tools with built-in models, guide lines dragged out
  of the edge rulers, configurable shortcuts, align and array copy for walls and texts.

### 4.51 Levels after the UX review (2026-11-18)

- `level_duplicate` (ID, optional name and elevation; `rooms`, `openings`, `furniture`,
  `annotations`): a new level on top of the highest one with copies of the walls of the
  given level at the same place, made with the clipboard code (`Clipboard::copy` and `paste`
  with a zero offset), so joins between the copies and their resources are kept. The dialog
  is `ui/LevelDuplicateDialog.tsx`.
- `level_update` takes `shift_above` (levels above move by the change of this level's top),
  `adjust_walls` (walls as high as the old level height get the new one; lower walls and
  sloped ends stay) and `elevation_index` (order among levels at the same elevation, the
  others are renumbered). The two switches of the properties panel live in the store and are
  on by default; the command defaults stay off.
- Underlay of the plan: the preference `underlay` (below, above, off; switch in the status
  bar) chooses the level drawn faded under the plan (`underlayLevel` in `plan2d/drawPlan.ts`).
  `snapContext` offers the wall ends and side corners of that level as points and alignment
  references ("wall end (other level)", "wall corner (other level)").
- Level tabs: "+" adds a level, a right-click selects the tab and opens a menu made from the
  registry (`ui/menuItems.ts`, also used by the plan): rename, duplicate, add at the same
  elevation, move left or right, show in 3D, delete. A level hidden in 3D shows an icon.
- Levels in 3D: `view3d_update` takes `levels` (selected, up_to_selected, all). "All" is
  Sweet Home 3D's `allLevelsVisible`; "selected" is the home property
  `mySweetHome.levelsIn3d`, which Sweet Home 3D keeps and ignores. `view3d/levels3d.ts` holds
  the mode and `visibleLevels`. The 3D view has one **Levels** popover with the mode and a
  tick per level; the "All levels" check box and the "Visible in 3D" field of the properties
  are gone.
- Open from the review: a table of all levels.

### 4.52 Furnishing and textures after the UX review (2026-11-18)

- `commands/surface.rs` works on the look (color, texture, shininess) of a surface: `floor` and
  `ceiling` of a room, `left_side`, `right_side` and `top` of a wall, `piece` for furniture.
  `surface_copy` gives surfaces the look of another one (the pipette), `texture_apply` gives
  rooms, walls and furniture a catalog texture in one step (default surfaces: floor, both wall
  sides, the whole piece), `texture_adjust` sets angle, size factor and shift of a texture
  (`angle`, `scale`, `xOffset`, `yOffset` of Sweet Home 3D; the 3D view applies the shift as
  texture offset).
- `room_walls` lists the wall sides that face a room: side lines of the wall outlines
  (`msh_geometry::wall_shapes`) are probed 2 cm outside the wall at five points per segment
  against the room polygon. `room_walls_update` changes color, texture, shininess and
  baseboard of these sides. Walls are not split: a wall longer than the room changes on its
  whole side.
- `furniture_replace` swaps pieces for a catalog item and keeps ID, position, angle,
  elevation, level, visibility and mirroring (`keep_size` keeps the size too).
  `furniture_update` takes `keep_proportions`: one given dimension scales the other two of
  each piece; pieces that are not deformable always do so.
- Plan: `plan2d/surfaces.ts` finds the surface under a point (the nearer side of a wall, a
  floor, a piece). A texture dragged from the catalog (`TEXTURE_DRAG_TYPE`) highlights it and
  is applied on the drop. Two modes of `ui/uiStore.ts` wait for a click in the plan: `pick`
  (the pipette of `TextureField`) and `placing` (a catalog piece hanging at the pointer after
  a double-click in the catalog; Shift+click places several). Escape ends both.
- Catalog (`catalog/CatalogPanel.tsx`, `catalog/catalogPrefs.ts`): favorites, pieces used
  last, open categories and list or tiles are kept in the local storage; rows take the
  keyboard and run the menu entries whose shortcuts the menu shows; search results have
  "Show all". Several models dropped together are named instead of skipped silently.
- Furniture list (`catalog/furnitureRows.ts`): search over all shown columns, remembered
  order, range selection, renaming with F2, equal pieces combined with their number.
- Properties: a color field shows and takes #RRGGBB, marks "no color" and offers the colors
  of the home (`panels/homeColors.ts`); the room has "Walls of this room"; several pieces
  have texture, surface and "Keep proportions"; "mixed" is translated.
- Open from the review: the import chain of the library editor (dialog stack, queue for
  several models, tile sizes of several textures), sorting and a library filter in the
  catalog, grouping the furniture list by level or room, sections for several texts,
  dimensions and lines, RAL and NCS palettes.

### 4.53 Shell and accessibility after the UX review (2026-11-18)

- Menu bar (`ui/MenuBar.tsx`, `ui/MenuList.tsx`, `ui/mnemonics.ts`): Alt or F10 goes to the
  bar and shows the access keys (the first free letter of each menu), Alt+letter opens a
  menu, arrow keys, Home, End, Enter and Escape move in it, a letter goes to the entries
  starting with it and runs the only one. An open menu takes all keys (listener on the
  document, before those of the window). Submenus open and close after 250 ms and overlap
  their menu. Alt held while a mouse button is down stays the magnetism switch of the plan.
- Menus: a **View** menu (zoom, grid, rulers, magnetism, side panels, plan or 3D alone,
  theme, size of the user interface, command search); the Plan menu groups its tools; the
  empty Extensions menu and the second entry for the 3D settings dialog are gone.
- Layout (`layout/layout.ts`) is a store: the commands `view.catalog` (F6) and
  `view.properties` (F4) hide the side panels, a panel dragged below 110 px hides too, the
  splitters take the arrow keys. The size of the user interface is the zoom of the WebView
  (`core:webview:allow-set-webview-zoom`), so plan, 3D view and texts scale together.
- Properties: `Section` (`panels/fields.tsx`) groups fields in parts that close, remembered
  per kind in the local storage; the actions of the selection are a header that stays in
  view; `furniture_update` takes `level`, offered as a field of a piece.
- Plan: Escape discards the drawing (Enter, a double-click or a right click keep it); a
  double-click on nothing no longer fits the plan. The grid has a fixed distance or follows
  the zoom (`gridStep`), the status bar shows the nominal scale and the grid distance, the
  angle step is free, "Zoom to the selection" fits the selected elements.
- Messages: errors and notices are laid over the window (no layout jump), errors stay until
  closed, saving reports success, `ui/messages.ts` keeps the last 30 for the status bar. The
  catalog and the import dialogs show core errors through `errorText`.
- Undo: `Document::undo_labels` and `redo_labels` give the command names of the steps, sent
  to the window as `undoHistory` and `redoHistory`; `ui/undoLabels.ts` turns a command name
  into "Wall: changed". The tool bar lists the steps to take back several at once.
- Background image: the calibration length and the origin use the unit of the preferences,
  the buttons are in the order Back, Next, Cancel, the opacity is a preference
  (`backgroundOpacity`).
- One precision for lengths (`lengthDecimals` in `units.ts`, preference) in the plan, the
  fields and the status bar. Sizes in the furniture import and the texture import of a
  texture field accept units.
- Command search: letters in their order match (`ui/fuzzy.ts`), the commands used last are
  listed first, the active entry scrolls into view. Resetting the preferences asks first.
  The letter keys of the plan tools can be changed (`toolKeys` preference, `ui/toolKeys.ts`).
- Open from the review: plan and 3D view side by side, snapping to the grid, progress and
  cancel for export, open and save, straightening a skewed background image, feet and inches
  with fractions in the fields, units in the library editor, preferences that apply only
  with OK.

### 4.54 Speed of edits (2026-11-18)

Measured with `scripts/perf.ps1`: the app is started with `MSH_PERF_OUT`, opens a home, runs
typical edits through `execute` (the path of the user's actions) and writes when each stage
was reached (`app/src/perf.ts`, marks from `perfMarks.ts`, timings of the core from
`state::execute`). Example home with 49 walls and 132 pieces, window 2560 x 1369, release
build: an edit is in the window after about 7 ms and the window is done with it after 12 to
30 ms; before these changes it was about 50 ms and 60 to 75 ms in a debug build.

- **Only the changes are sent.** After a command the windows get a `HomePatch`
  (`msh_core::patch::home_changes`): the changed fields of the home and, for its lists, the
  changed or added elements plus the order of the IDs if it changed. The backend keeps the
  state it sent last (`ActiveDoc::sent`), each state has a number (`seq`), and a window whose
  state does not fit the base of a patch asks for the whole home (`applyUpdate` in
  `store.ts`, `homePatch.ts`). Sending the whole home (240 KB of JSON here) cost about 45 ms
  per edit in serializing, transfer and parsing.
- **Unchanged parts keep their identity.** `applyPatch` reuses every element that did not
  change; a whole home that arrives (opening, reload) goes through `shareStructure`. Views
  compare with `===`: the 3D view keeps the objects of unchanged furniture (`pieces`) and of
  the sky, ground, walls, rooms and annotations when their inputs are the same (`parts` in
  `View3D.tsx`; of the furniture only doors, windows and staircases count for walls and
  rooms). The catalog, the furniture list, the menu bar and the status bar are memoized and
  subscribe to the parts of the home they show.
- **The plan comes first.** After a change of the home the 3D view draws one frame later
  (`renderLater`), so the plan is on the screen before the graphics card gets the new scene.
  The plan is drawn once per change (the resize observer is no longer set up again for every
  change, and fitting an unchanged view draws nothing).
- The position of the sun is asked from the core only when the compass, the cameras, the
  properties or the attributes of the home changed, not after every edit.
- A plan that is collapsed keeps its view (a negative scale made the drawing of the handles
  of a selected wall throw, which took the whole window down); the plan has an error boundary.
- What is left per edit: about 5 ms for a call to the backend and back (WebView2 and Tauri),
  about 7 ms for rendering the panels and drawing the plan, 0 to 10 ms for the 3D scene (the
  cut of the openings of a moved wall), and the wait for the next frame.
- Changed parts of a patch are turned into JSON through text (`patch::value`), not through
  `serde_json::to_value`: that widens `f32` to `f64`, so a patch carried 1.5707963705062866
  where the whole home said 1.5707964. The 3D view took the stored camera for moved by a
  command and went back to it at the first change of a camera (the sun, a point of view).

### 4.55 3D view after the UX review (2026-11-18)

Package 6 of the UX review (D1 to D7). What is deliberately left out is listed in
`OFFENE-PUNKTE.md` of the working copy.

- **Selecting and moving (D1).** A click in the 3D view selects the element under the
  pointer: objects of the scene are named `piece:<id>`, `wall:<id>`, `floor:<id>` ...
  (`select3d.ts`, `elementOf`); a piece of a group selects its group, and the plan goes to
  the level of the element. The selection of the plan is outlined (`SelectionOutline`: a
  box around furniture, the edges of walls and floors, drawn over everything and only by the
  render loop, so photos and exports do not contain it). Selecting rebuilds nothing of the
  scene: its effect only draws the outline anew. Dragging a selected piece moves its objects
  over the horizontal plane through the grabbed point and runs one `edit_move` on release
  (Esc cancels, a refused move goes back). The press is taken in the capture phase before
  the controls of the view. The selection is part of the state the main window and the
  separate 3D window share (`syncUiState`).
- **Standard views and projection (D2).** `standardViews.ts` gives the view direction of
  the top view, the four sides and four isometric views from the north of the compass. The
  parallel projection is a second (orthographic) camera that the orbit controls move
  instead; the perspective camera follows it (`syncPerspective`), so points of view, photos
  and the camera stored in the home keep working. `ctx.place` places both. View actions are
  commands (`view3d.view.<name>`, `view3d.parallel`, `view3d.fit`, `view3d.zoomSelection`)
  that reach the view through `view3dBridge.ts`, also in the separate window.
- **Section (D3).** Two clipping planes (above a height, a share of the home from one side
  of the plan) are set on the materials of the home, not on the ground and the sky
  (`setSectionPlanes`, `clipMaterials`); the number of planes of a material never changes,
  an unused plane lies far away. Clicks ignore what is cut away. The section is view state
  (`useUi.section`), not stored and not part of photos.
- **Navigation (D4).** The wheel zooms towards the pointer (`zoomToCursor`), the view stops
  at the horizon and its pivot stays above the ground, the arrow keys turn (Shift: move, +
  and -: zoom).
- **Sun study (D5).** Sliders for the time of day and the day of the year show the sun of
  that moment while they move (`sun_get` with `at`, no change of the home) and run
  `sun_update` on release; "Play the day" moves the time on. Light brightness and walls
  transparency are previewed the same way. A north arrow turns with the view
  (`northOnScreen`). The settings panel stands at the right edge instead of over the view.
- **Photo and video (D6).** The photo dialog is a panel beside the view like the video
  panel, with size presets, JPEG, the remaining time and remembered settings
  (`photoPresets.ts`). Key points of the video show a picture, go to their place on a click
  and are moved with `camera_path_move`; the plan draws the path while the panel is open
  (`cameraPathShown`).
- **Points of view (D7).** `viewpoint_rename`; `viewpoint_store` under an existing name sets
  that point of view where it is in the list. Pictures are drawn when the menu opens: the
  scene is rendered into a corner of the canvas and copied from there before the view is
  drawn again (`ctx.thumbnails`); they are not stored in the file.
- **After the hand test (2026-11-18).** Rooms from walls: outlines of walls that meet edge
  to edge (the miter of joined walls of different thickness) missed each other by a few
  1/100000 cm, which left the enclosed area open; `enclosed_area` grows the outlines by
  0.004 cm before it unites them (`JOINT_TOLERANCE`, below the 0.01 cm the outline is
  rounded to). Doors and windows dragged along a wall (`slideInWall`): only the middle of
  the free space and openings that matter are snap targets (the same wall line on other
  levels, parallel walls of the level up to 8 m away, at half the snap distance); before,
  every parallel opening of the home gave three targets and the wall was covered with
  them. Between targets the free space to the nearer neighbor is a multiple of the drag
  step. The piece keeps the side it opens to and its wall while the hand strays
  (`SlideState`): it turns only when pulled out of the wall on the other side. Escape and
  Del typed in the 3D view reach the plan (drop or delete the selection). The panels of the
  3D view stand below the tool bar. The photo preview keeps its proportions, the file
  format (PNG, JPEG) is chosen in the panel (the dialog of Windows kept ".png" when JPEG
  was picked there), and while path tracing prepares its scene the view as it is is shown.
  Number fields of the tool options can be emptied while typing.
- **After the second hand test (2026-11-19).** In a wall thicker than the piece a dragged
  door or window follows the hand across the wall too (`slideInWall`: the offset of its
  wall part from the axis, between the two faces): it stays where it is while it slides
  along, and catches the middle of the wall and both faces within a small distance. Before,
  it could only sit flush with the side it opens to and jumped there with every move, so
  another place across the wall needed the arrow keys. The virtual visit is lit by the
  lamps of the level the visitor stands on only (`visitLampLevels`): lamps are lights that
  no floor stops, and the ones under the ceiling of the level below lit the foot of the
  walls through the floor as a white band. The drawing callback of the plan lists the grid
  distance and the opacity of the background image among what it depends on: it kept the
  values it was created with, so a new grid distance showed only after the next change of a
  tool.
- **Grid snap (2026-11-19).** Preference `snapGrid` (off at first; command `plan.snapGrid`
  in the Magnetism menu, a switch in the status bar). `gridSnap.ts`: the grid that catches
  is the one the plan draws at its zoom (`snapGridStep`, from `gridStep`). While drawing
  it replaces the rounding to whole centimeters, the last stage of `snapDraw`: the first
  point lands on a grid point, a segment keeps the direction the angle magnetism gave it and
  ends on the nearest grid line (`gridAlong`). Points, faces and alignments of objects and
  guide lines come first. A moved selection lands with its anchor on the grid
  (`gridAnchor`: the start of the first wall, else the upper left corner of its bounds;
  `gridOffset`), before the smart guides and the docking to walls, which win. Not caught:
  pieces dropped from the catalog, the arrow keys, doors sliding in a wall.
- **Testing in the real app.** The debug or release build is started with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`; a script then
  clicks, drags and types in the real window through the Chrome DevTools Protocol
  (`Input.dispatchMouseEvent`) and takes screenshots. Package 6 was checked this way.

### 4.56 Terrain and scans (2026-11-19)

Package 7 of the UX review (G1–G6). Reference objects stay pieces of furniture in the file;
what is new is kept in piece properties `mySweetHome.*`, which Sweet Home 3D keeps.

- **Model package.** `ModelPackage` also carries `center_cm` (the middle of the model's box
  from the zero point of its file, as `f64`) and `unit_cm` (the centimeters per unit its size
  assumes). `furniture_import` takes `unit` (mm, cm, m, in, ft) and returns `origin`: the
  position (x, y, elevation) at which the zero point of the model lies on the zero point of
  the plan, after the model rotation and in the size it is imported with. The import dialog
  computes the same from the staged model (`importPlacement.ts`).
- **Terrain.** `model_formats.rs` reads height grids: ASC (Esri ASCII grid) and XYZ (lines
  "east north height"; regular grids keep their grid, scattered points are averaged on a
  grid of 1.5 times their mean distance and small gaps are filled). `HeightGrid::into_mesh`
  thins it to `TERRAIN_MAX_SIDE` (300) nodes per side and moves it to its middle and its
  lowest point (`Mesh::shift`), because `f32` cannot hold national coordinates to the
  centimeter; the shift comes back in `center_cm`. Grids in degrees and PLY point clouds are
  refused with a reason.
- **Properties of reference objects** (`furniture_update`): `plan_visible`
  (`mySweetHome.planHidden`), `view3d_visible` (`hidden3d`), `plan_opacity` (`planOpacity`),
  `section_height` (`sectionHeight`), `section_snap` (`sectionSnap`), `terrain` (`terrain`).
  Hidden in both views is the piece's own `visible`, which Sweet Home 3D knows
  (`referenceObjects.ts`: `shownIn`, `showParams`).
- **Cut in the plan** (`plan2d/section.ts`). `cutTriangles` intersects the triangles of the
  model with a horizontal plane; the lines are kept in the frame of the piece (a `Path2D` to
  draw, a `Float32Array` for the magnetism) and cached by piece and height, computed in the
  queue of the views from above. The height is measured from the floor of the shown level
  (`sectionHeightIn`), so every level shows its own cut, and a reference object with a cut
  shows on all levels. The lines are drawn on top of the background image. With
  `section_snap` the lines within eight snap radii of the pointer (at most 200, nearest
  first) join the lines of `snapContext` ("on section line"). A thickness of the cut is not
  needed for meshes; it will matter for point clouds.
- **Two-point alignment.** `furniture_align_points {id, from, to, resize}` turns and moves a
  piece so that the middle between two points on it lands on the middle between their
  targets; with `resize` it is scaled so that both fit. In the plan `uiStore.pointPick`
  takes the four clicks (`alignPoints.ts`), with the magnetism of dimensions; the overlay
  draws each pair as a numbered point with an arrow.
- **Ground.** `terrain.ts`: `groundHoles` gives the footprints of terrain objects shown in
  3D; `buildGround` cuts them out of the flat ground (the first of two overlapping ones).
- **Map as background image.** The north dialog turns the downloaded map into the plan
  (`mapBackground`), writes the attribution onto the image and sets it with
  `background_image_set`; the map tiles are the ones the dialog had already loaded.
- **Self-test beside an open app.** The app is single-instance by its identifier. A build
  with `pnpm tauri build --debug --no-bundle -c <json with another identifier>` runs beside
  the app the user has open; started with its own `APPDATA`, it keeps the furniture library
  apart. It does not own the live-control pipe, so it is driven through the debugging port
  only. Package 7 was checked this way.
- Left open: point clouds (LAS/LAZ, E57, PLY without faces), GeoTIFF, DXF and IFC, a common
  geographic zero point for several data sets, cuts in exports and prints, a parcel boundary
  with setback areas, contour lines.

### 4.57 Roofs (2026-11-19)

Package 8a of the UX review (D8). The file format of Sweet Home 3D has no roofs, so a roof is
a piece of furniture with a generated model that keeps what it was made from.

- **Generator** (`msh-geometry::roof`). Every eave of a convex outline carries a plane that
  rises inwards with the pitch; the roof is the lowest of these planes at each point, and a
  gable edge carries none. One rule gives gable, hip and shed roofs and their mixtures for any
  convex outline: the surface of an eave is the outline (moved outwards by the overhang)
  clipped by the half-planes in which its plane is the lowest. Clipping a convex polygon by
  half-planes needs no polygon library and has no special cases; each edge of a clipped
  polygon remembers where it comes from, which gives the lines for the plan (eave, verge,
  ridge, hip) and the faces around the edge. A sloped roof passes through the outline with
  its upper surface, so the walls end inside the roof; a flat roof lies on them. The walls
  under gable edges are part of the model. `roof()` returns triangles with a normal each
  (corners counter-clockwise around it) and the lines.
- **Outlines with corners that point inwards** carry no single roof here (that needs a
  straight skeleton). `rectangles()` splits an outline whose edges run in two directions at a
  right angle into its largest rectangles, each with a roof of its own; the roofs run through
  each other, which looks right from outside. `roof_areas()` is what "Roof over the walls"
  uses on the outline of the walls (`walls_outlines()`, the outer ring of their union): the
  rectangle around the outline if the outline fills it up to 60 cm, else the convex hull if no
  dent is deeper, else the rectangles (short slanted edges such as a cut inner corner are
  allowed, the rectangles keep clear of them), else the hull.
- **Commands** (`commands/roof.rs`). `roof_add` (points or the walls of the level; shape,
  pitch, overhang, thickness, turn, edges, base, colors) and `roof_update`. The model is an
  OBJ with normals and the materials `roof_cover`, `roof_soffit` and `roof_gable`, stored like
  an imported model; the piece lies on the level with its bottom at `base + lowest`. The
  piece is turned so that the longest edge runs along its width or depth (by no more than
  45°), and the property `mySweetHome.roof` holds as JSON: shape, turn, the corners relative
  to the middle of the piece before its rotation, the kind of each edge, pitch, overhang,
  thickness, colors, the lowest point, the size as made and the lines for the plan. The
  height the roof starts at is not stored: it is the elevation of the piece minus the lowest
  point, so lifting the piece with `furniture_update` survives the next change.
- **Textures.** The mesh carries the place of each corner on its surface in cm (along the
  eave and up the slope on the covering, along the wall and up on a gable wall, not mirrored
  seen from outside); the commands divide it by the tile size of the texture. `texture` and
  `gable_texture` of `roof_add` and `roof_update` take a catalog texture; its image becomes a
  file of the model (`cover.*`, `gable.*`, `map_Kd` in the MTL), so the textured roof shows
  in Sweet Home 3D too and is made again from the files of its own model, without the
  catalog. The property keeps name, catalog ID, file and tile size of each texture.
- **Resizing.** `furniture_update` makes a roof again when the size of its piece changes: the
  covered area is stretched, what the roof reaches beyond it stays, and the height follows
  from the pitch. The handles of the plan therefore resize a roof without changing its pitch.
- **Undo after saving.** Every change of a roof stores a new model, and saving left out the
  resources nothing used any more, including those a step of the history needs. `save` now
  puts the resources back that the undo and redo steps refer to; the file is unchanged.
- **Plan.** `plan2d/roof.ts` reads the property (cached per piece object). A roof is drawn as
  its lines on top of the walls, is picked by its lines only, is selected by a rubber band
  only when it lies inside completely, and is left out of the alignment guides and of the
  surfaces furniture can stand on. Exports and prints draw the same lines (`msh-export`).
  "Roof over a rectangle…" uses the point picking of the plan with an outline preview
  (`PointPick.outline`).
- **3D.** The model is shown like any piece; "3D view › Roofs" (`roofs` in the UI store,
  forwarded to the separate 3D window) leaves roofs out.
- Left open: one roof over an outline with corners that point inwards (valleys), walls cut to
  the roof, dormers, half-hip and mansard roofs, a pitch for each edge, turning or resizing a
  texture on the roof, a texture for the underside, editing the corners in the plan.

### 4.58 Stairs and floor openings (2026-11-21)

Package 8b of the UX review (D9, D10). Both are pieces of furniture with a generated model and
a staircase cut-out, like the roofs of 4.57; the code they share with roofs (textures that are
files of the model, writing the OBJ and MTL, reading the JSON property, the frame of an
outline) is in `commands/generated.rs`.

- **Generator** (`msh-geometry::stair`). A stair is built in its own frame: the middle of the
  front edge of the first step at the origin, climbing towards -y of the plan; a stair that
  turns left is the mirror image of one that turns right. `risers` risers of the same height,
  the last one onto the floor above, so one tread fewer than risers; a landing takes the place
  of one tread. Straight (one flight), L (two flights at right angles with a square landing),
  U (two flights side by side with a landing across both and a gap between them) and spiral
  (wedges around a column, the tread measured on the walking line in the middle). Every part
  is a prism of a convex outline: solid steps are blocks down to the floor (a spiral stair:
  blocks one riser high), open treads have a thickness and lie on two stringers, whose side
  view is the line through the front edges of the treads cut off at the floor below. A board
  in front of the floor above (the last riser) makes the model reach up to it. Handrails run
  90 cm above the front edges of the treads and level along the landings, with posts at the
  ends, at the corners and no more than 120 cm apart, standing on the step below them. The
  mesh comes with the edges of the treads and landings for the plan, the walking line, the
  outline seen from above, and the cut-out: the treads and landings whose top is higher than
  `cut_from` (the floor above minus its thickness minus a headroom of 2 m), one rectangle per
  flight; a spiral stair cuts its whole circle.
- **Checks.** `default_risers` (about 17.5 cm each, none higher than 19 cm) and
  `default_tread` (step rule 2 × riser + tread = 63 cm). `warnings` names what fails DIN 18065
  for homes (riser 14–20 cm, tread 23–37 cm, step rule 59–65 cm) and the headroom under the
  turn above a spiral stair (the risers of one turn times the riser height, less the tread).
- **Commands** (`commands/stair.rs`). `stair_add` (start point, `angle_deg` of the climbing
  direction clockwise from up in the plan, shape, turn, width, rise, risers, tread,
  first_flight, gap, diameter, column, style, thickness, rails, colors, texture),
  `stair_update` and `stair_calc` (the same without adding: counts, checks and the outline,
  used by the preview of the tool). Without a rise the stair reaches the next higher level,
  else the height of its level plus its floor thickness. A new rise sets the riser count, a
  new riser height the tread, unless they are given too. The piece is not resizable (the
  steps fit only their measures); its `staircaseCutOutShape` is the cut-out in the unit
  square of the piece, so Sweet Home 3D cuts the floor too. The property `mySweetHome.stair`
  keeps the measures, colors, texture, the start relative to the middle of the piece (an
  update keeps the start where it is), the treads per flight, the size as made, the lines,
  the walking line and the failed checks. Materials `stair_steps` (color or texture) and
  `stair_frame` (stringers, column, handrails).
- **Floor openings** (`commands/opening.rs`). Staircases already cut floors and ceilings, so
  an opening is a staircase piece on the level whose floor it cuts, from 2 cm below the floor
  slab (elevation minus floor thickness minus 2) up to the floor, with the cut-out of its
  outline. The model is the edge of the hole (faces looking into it); in the 3D view of the
  app the cut floors show that edge themselves, so the piece is left out there. The property
  `mySweetHome.opening` keeps the outline relative to the middle; `opening_update` and the
  handles (`furniture_update`) stretch it; a new floor thickness is taken on the next change.
- **Plan.** `plan2d/stair.ts` reads both properties (cached per piece object). A stair is drawn
  as the edges of its treads and its walking line from a dot to an arrow, an opening as its
  outline dashed (crossed when it has four corners), on the level below faint like other
  pieces reaching up; exports and prints draw the same (`msh-export`). The tools use the point
  picking of the plan: two points for a stair with its outline from `stair_calc` as preview,
  three for an opening (the rectangle of a roof).
- Left open: winders instead of landings, stairs that follow a drawn path, balusters and a
  railing around the hole above, a stair whose rise follows a later change of the level
  heights, openings of any outline drawn in the plan (only through `opening_add`), a railing
  around an opening.

### 4.59 Output: paper, title block, DXF and glTF (2026-11-21)

Package 8c of the UX review (H1, H2). Dimensioning (H3) and the catalog (H4, H5) follow.

- **Pages** (`msh-export::pages`). Papers A0 to A5, Letter, Legal, Tabloid and any size in mm
  (`Paper::by_name("500x700")`). `plan_pages` replaces `plan_page`: fitted, the plan takes one
  page; at a scale, it takes as many pages as it needs, columns × rows of the content area,
  the whole plan centered on them, each page clipped to its part and noted "part 2 of 6 (row
  1, column 2)". Without a given orientation the one with fewer pages wins. A given whole
  scale is shown as it is (1:75); a fitted one is rounded as before. `Page` now carries its
  scale and its title block; `$planScale` comes from the scale instead of the footer note.
- **Title block.** `TitleBlock` (project, drawing, author, date, north direction) is drawn by
  `page_svgs_framed` at the bottom right above the footer, 26 mm high and up to 150 mm wide:
  north arrow (from the compass), scale bar (the longest round length that fits, in
  alternating quarters) with the scale, project and drawing, and cells for author, date and
  sheet. The plan area shrinks by the height of the block. The commands number the sheets
  over all pages of a document (`renumber_sheets`).
- **Commands.** `export_plan` and `export_document` take the new papers, any scale and
  `title_block` (`project`, `author`); a split plan adds a note to the result. `export_plan`
  without a path returns the PDF pages as SVG documents, which the dialog shows as preview
  (with catalog icons, so it is quick).
- **DXF** (`msh-export::dxf`). AutoCAD R12 (AC1009) text: header with `$INSUNITS`, tables
  with a continuous line type and twelve layers with colors, entities as LINE, POLYLINE
  (VERTEX, SEQEND), CIRCLE and centered TEXT; the y axis is turned up and the unit is mm, cm
  or m. Walls are their outlines, rooms their polygons with name and area, furniture, doors
  and windows their rectangles, stairs, roofs and openings the lines the plan shows of them,
  dimensions the extension lines, the line with ticks and the length, texts line by line,
  lines as polylines, the compass a circle with an arrow. Text outside ASCII is written as
  `\U+XXXX`. `export_plan` writes it for `format: "dxf"` or a path ending in .dxf, one file
  per level for "all".
- **glTF and OBJ units.** The 3D export event carries a format and a unit: a path ending in
  .glb makes `view3d/gltfExport.ts` copy the exported groups (sharing geometry and materials)
  under a root scaled to meters and write them with three.js's `GLTFExporter` as one binary
  file (`write_binary_file`); textures go along with `KHR_texture_transform`. OBJ vertices are
  scaled to cm, mm, m or inches (`buildObj(…, unit)`). `msh export-obj` takes a .glb path and
  `--unit`.
- Left open: DXF with blocks for furniture and door swings, DWG and IFC, reading DXF, a title
  block layout of one's own, crop marks and overlap for split pages.

### 4.60 Dimensions (2026-11-23)

Package 8d of the UX review (H3). Sweet Home 3D has single dimension lines only; chains, the
style and elevation marks are kept as properties and shown there as ordinary elements.

- **Chain geometry** (`msh-geometry::chain`). `wall_chain` takes a straight wall and a side. The
  walls of its level that are parallel, lie with the same face on one line (up to 1 cm) and touch
  belong to the chain. Where it ends: in the miter of a joined wall (exact also at slanted
  corners); else at the near face of a wall that goes on beyond the face, at the far face of one
  that ends there (a corner without a joint), or at the end of the wall. Rows: the edges of the
  cuts of doors and windows (`wallLeft`, `wallWidth`, mirroring), both faces of adjoining walls
  measured 1 cm beside the face (outside of any miter; slanted joined walls are left out), and the
  whole. Rows that measure nothing but the whole are dropped. The direction is the one whose texts
  read from the bottom or the right. `outer_side` is the side that looks into no room and no area
  closed by walls.
- **Commands** (`commands/dimension.rs`). `dimension_chain_add` (wall, side, rows, distance,
  spacing; or points), `dimension_chain_calc` (both sides without adding, for the preview) and
  `dimension_chain_update`, which measures a chain again and replaces its lines (new IDs; color
  and text style stay). Each line keeps the chain in `mySweetHome.dimensionChain` (ID, wall, side,
  rows, distance, spacing); a copy leaves the chain (`leave_chain` in the clipboard, which
  duplicating a level uses too). A chain does not follow its wall by itself.
- **Style** (`msh-export::dimension`, `plan2d/dimensionStyle.ts`). `mySweetHome.dimensionStyle` of
  the home: mark, unit (auto, mm, cm, m, din), decimals, showUnit, comma, fontSize. Both
  implementations format alike and share their test cases. "auto" is what was before: the unit of
  the preferences in the app, m and cm in files. Plan, 3D view, SVG, PDF and DXF use the style.
  The first change in the app takes the decimal sign of its language.
- **Elevation marks** are labels with `mySweetHome.elevationMark` (height above the floor, kind,
  comma). Their text is the elevation of the level plus the height; `refresh_elevation_marks` runs
  after every modifying command in the registry (same undo step), so a moved level, a paste onto
  another level or a new style cannot leave a stale text. `label_update` with a text makes the
  mark an ordinary label.
- **App.** Tools `dimchain` and `elevmark`; the chain is placed like a guide line at a distance
  (`chainFrom`), also from the context menu of a wall.
- Left open: angle dimensions, a style for a single dimension, chains between points in the app,
  chains along round walls, texts that make room for each other in short dimensions, chains that
  follow their wall.

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
| **P7 Plan essentials** | Rulers, background image per level (wizard for images and PDF pages), furniture top view in the plan, grid and magnetism switches (first version of the preferences dialog), measuring tool, lock base plan | A scanned or PDF floor plan can be traced at the right scale; furniture looks like in Sweet Home 3D's top view |
| **P8 Editing** | Context menu, clear handles and cursors, align/distribute, paste style, room points, reverse wall direction, door/window snapping and depth, dimension improvements, text styles, curved polylines, draggable compass | Editing matches or beats Sweet Home 3D's plan editor |
| **P9 3D and environment** | Virtual visit with WASD + mouse and collisions, points of view, all levels switch, 3D view settings, sun from location / date / time with address search, lights and light power, tilting furniture, photo date / time / lens | The 3D view is fully editable and walkable |
| **P10 Building** | Staircase cut-outs, walls across levels, shelves | Multi-storey homes with stairs look right |
| **P11 Files** | One window per home, autosave and recovery | Several homes open; no work lost after a crash |
| **P12 Polish** | Preferences (incl. units, defaults for new elements, colors of the wall side markings, angle snap steps), i18n (German), open import (more formats, library editor, online sources), installer (MSI via Tauri), plugins, accessibility, performance benchmarks, optional auto-update | Release candidate 1.0 |

Realistic assessment: P0–P3 quickly produce an AI-controllable foundation. Full parity (P4–P7) is a project of **several months**. The phases are cut so that each one delivers something usable.

### 6.1 Feature decisions (2026-11-08)

Result of the feature comparison with Sweet Home 3D 7.x (73 features, decided by the user in
the feature matrix). Features marked "no" stay as they are. Agreed details:

**P7 Plan essentials**
- Rulers along the top and left edge of the plan (cm scale, cursor position), as in Sweet Home 3D.
- Background image per level (and for the home): import wizard for PNG / JPEG / BMP and a chosen
  page of a PDF. In the wizard the image can be zoomed; the length marker is placed, moved and
  aligned precisely, its real length typed in, then the origin (0 point) is set. The image is
  placed in the plan under walls and rooms, which are drawn on top of it; it can be hidden per
  level, modified and deleted. Stored like Sweet Home 3D's `backgroundImage`.
- Furniture in the plan as a colored top view rendered from the 3D model by default; the catalog
  icon stays available as a preference (Sweet Home 3D's "furniture icons in plan").
- Grid and magnetism can be switched off permanently; measuring tool (distance between two
  points without creating a dimension line); lock base plan.

**P8 Editing**
- Context menu on right click, only in the select mode; in drawing tools the right click keeps
  finishing the drawing.
- Handles and mouse cursors that make each action clear (move, rotate, resize, elevation and
  height of furniture).
- Align and distribute furniture, paste style, add / delete room points, reverse wall direction.
- Doors and windows: depth follows the wall thickness when placed and when the wall thickness
  changes later. Snapping while placing: distances to the wall corners or the next opening are
  shown and can be typed; the opening snaps to the middle of the wall section; it aligns with
  openings in other walls and on other levels (same axis or edge).
- Dimension lines: elevation dimensions and automatic dimensions of the selected wall or piece;
  while placing a dimension, guide lines to nearby walls and objects are shown.
- Text styles (font family, bold, italic, size) for labels, room texts, dimensions and furniture
  names; curved polylines; compass draggable and rotatable in the plan.

**P9 3D and environment**
- Virtual visit: WASD to walk, mouse to look around, Q / E up and down, Shift faster; collision
  with walls, open doors can be walked through; field of view / zoom with the mouse wheel.
  Visitor shown in the plan.
- Store, go to and delete points of view; switch "display all levels".
- 3D view settings: ground and sky color or texture, light brightness, wall transparency.
- Sun: the location is found by address search (online geocoding, e.g. OpenStreetMap Nominatim)
  or typed as latitude / longitude; it sets the compass. The sun position is computed offline
  from location, date and time (default: summer, noon). Date and time can follow the current
  time automatically or be set to fixed values.
- Lights: more lamps, spot cones, glowing light sources; light power editable.
- Tilting furniture (pitch / roll) editable; photo with date / time, lens (normal, fisheye,
  spherical) and ceiling lights option.

**P10 Building**: staircase cut-outs in the floor above, walls spanning levels, shelves.

**P11 Files**: one window per home (as in Sweet Home 3D), autosave and recovery.

**P12 Polish** (scope extended 2026-11-08), in steps:
- P12a User interface design, shown as a clickable mock-up before it is built: menu bar with
  categories whose entries open as menus (like Sweet Home 3D, but grouped for overview and
  quick access), a reworked tool bar (most used functions one click away, related ones in
  drop-down menus), consistent icons throughout (own icons where no common symbol exists),
  light and dark mode (default: the system setting), all dialogs movable.
- P12b Implementing that design in the app (done, see 4.30).
- P12c (done, see 4.31) Preferences: units (cm, mm, m, inch/foot; internally cm), defaults for new elements
  (wall thickness / height / pattern, floor thickness, text sizes, room and wall colors),
  magnetism steps, wall side marking colors, plan room rendering, 3D quality and walking
  speed, autosave interval, language, theme. Window size and position remembered.
- P12d (done, see 4.32) German user interface through translation files (English stays in the code); number
  and date formats.
- P12e Open import of furniture, textures and libraries (added 2026-11-08). Everything
  imported is stored in Sweet Home 3D compatible form (OBJ + MTL + textures inside .sh3f /
  .sh3t) in the Sweet Home 3D library folders, so both applications use it. In sub-steps:
  - P12e-a (done, see 4.33) More formats. Furniture: OBJ, DAE, 3DS, glTF / GLB (as before), plus FBX, ZIP
    archives with models and textures, KMZ, STL, 3MF, PLY and VRML (WRL); converted to OBJ
    through the three.js loaders. Textures: JPG, PNG, BMP, GIF (as before), plus WebP, TIFF,
    SVG and PBR material packages (ZIP; the color map becomes the texture). Drag and drop of files onto the catalog. Not possible: SketchUp
    .skp and Blender .blend (no free reader; export to DAE, FBX or glTF instead).
  - P12e-b (done, see 4.41) Library editor in the app, brought forward on 2026-11-09 after a
    second draft ("one way per result").
  - P12e-c (done, see 4.34) Online sources: search and import the free libraries of sweethome3d.com (whole
    .sh3f / .sh3t files), CC0 textures and models of ambientCG and Poly Haven (their public
    APIs, no account). License and source are kept with each item; network access can be
    turned off in the preferences.
- P12f (done, see 4.36) Stand-alone installer without dependencies on other programs: MSI via Tauri with the
  WebView2 runtime, `.sh3d` file association and the CLI `msh`. The Sweet Home 3D default
  catalog was bundled at first and removed again for the public release (2026-11-11, see
  D3). Installed Sweet Home 3D libraries are still found. Release builds run on GitHub
  Actions (`.github/workflows/release.yml`). Auto-update prepared (Tauri updater, signing keys), the update
  source is decided later.
- P12g Plugins: TypeScript plugins inside the app (folder with manifest and permissions; use
  the command registry like CLI / MCP, add menu entries, tools and panels, run isolated) and
  external programs that control the app through CLI / MCP and appear as menu entries.
- P12h Performance benchmarks with large homes and accessibility (keyboard, screen readers,
  contrast). Small open points of P7–P11 (time zone suggestion from the address search,
  automatic dimensions while the context menu is open, brighter spots in draft photos).

**Later** (after P12): Library editor in the app with the scope of Sweet Home 3D's Furniture Library Editor and Textures Library Editor: create and open .sh3f / .sh3t libraries, add pieces or textures one by one or in batches (folder or ZIP), edit every property (name, category, tags, description, information, creator, license, price and VAT, size, elevation, door or window, staircase cut-out, light sources, shelves, movable / deformable / resizable / texturable, model rotation, back faces, ...), save and export. Pieces of the open home can be exported as a library. Commands in msh-core (`library_create`, `library_add_items`, `library_update_item`, `library_remove_item`, `library_save`), so CLI and MCP can build libraries too. Checked with the original Sweet Home 3D reader. matt / glossy wall sides, rest of the furniture modify dialog (texture of
the whole piece, matt / glossy, description, price), prices and VAT in the list, print header and
footer, recent homes, help, poses of human figures.

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
│  └─ src/                     # React/TS frontend (ui/, plan2d/, view3d/, catalog/, panels/)
├─ tools/compat/               # Java test program using the original SH3D reader
├─ tests/corpus/               # test files (only own/free files in the repository)
├─ docs/
└─ libraries/                  # local, in .gitignore – imported libraries
```

## 8. Open points (not blocking)

- Name of the app (working title "My Sweet Home", binary `msh`)
- Distribution / license model (D3), at the latest before the first distribution
- Whether a converter for very old `.sh3d` files (< 5.3) is needed
