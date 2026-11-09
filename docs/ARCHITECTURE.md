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
  by name, or position with yaw / pitch or a point to look at), `camera_path_remove`,
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
  of the same kind: wall colors, textures, baseboards, pattern, thickness and heights; room
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
- Points of view: `viewpoint_store` / `viewpoint_go` / `viewpoint_delete` / `viewpoint_list`
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

- Where catalog content lives: the default catalog comes with the installation (Sweet Home
  3D's default catalog `Furniture.jar` / `Textures.jar`, bundled by the installer since P12f).
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

- `scripts/build-installer.ps1` builds the MSI: it copies Sweet Home 3D's `Furniture.jar` /
  `Textures.jar` from a Sweet Home 3D installation (Program Files, Store version or
  `-Sh3dDir`) into `app/src-tauri/resources/catalog/` (git-ignored, next to the committed
  `NOTICE.txt` with source and licenses), builds the CLI as Tauri external binary
  (`app/src-tauri/binaries/msh-<target triple>.exe`, git-ignored) and runs
  `pnpm tauri build` with `tauri.installer.conf.json` merged in. Normal builds
  (`cargo build`, `pnpm tauri dev`) do not need these inputs.
- The installer (per machine, `C:\Program Files\My Sweet Home`) contains the app, `msh.exe`,
  the default catalog in `catalog\` and its notice; it adds the folder to the system `PATH`
  (WiX fragment `wix/cli-path.wxs`, removed on uninstall), registers `.sh3d` files and embeds
  the WebView2 bootstrapper (WebView2 is part of Windows 11; on systems without it the
  bootstrapper downloads it).
- Library discovery (`msh_catalog::find_libraries`): the bundled catalog
  (`MSH_CATALOG_DIR`, otherwise `catalog` next to the executable, so app and CLI find it)
  comes first; an installed Sweet Home 3D only adds default catalog files the bundle lacks,
  so no item appears twice. User libraries and the Store version's libraries are found as
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
  - P12e-b Library editor: moved after version 1.0 (decided 2026-11-08); a UI draft is on
    the design canvas.
  - P12e-c (done, see 4.34) Online sources: search and import the free libraries of sweethome3d.com (whole
    .sh3f / .sh3t files), CC0 textures and models of ambientCG and Poly Haven (their public
    APIs, no account). License and source are kept with each item; network access can be
    turned off in the preferences.
- P12f (done, see 4.36) Stand-alone installer without dependencies on other programs: MSI via Tauri with the
  WebView2 runtime, `.sh3d` file association, the CLI `msh`, and the freely licensed Sweet
  Home 3D default catalog (furniture GPL / CC-BY, textures CC-BY, with attribution; taken
  from a Sweet Home 3D installation at build time, never committed). Installed Sweet Home 3D
  libraries are still found. Auto-update prepared (Tauri updater, signing keys), the update
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
