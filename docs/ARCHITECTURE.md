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
