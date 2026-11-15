# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-15

First public release.

### Added

- 2D plan editor: walls (also round and sloping), rooms, dimensions, labels, polylines, levels,
  furniture with docking to walls, doors and windows, background images, rulers.
- Precise drawing: typed lengths and angles while drawing, measuring or drawing a ruler (Tab
  switches to the angle; `@dx,dy` relative, `#x,y` absolute, `300<45` both), number fields that
  calculate (`240+11.5`, `3m - 12cm`) and change values relatively (`+5`, `*2`).
- Magnetism: snapping to the ends, middles, faces and crossings of walls and rulers and to the
  foot of the perpendicular, with markers for the kind of point; smart guides that line up moved
  elements with nearby furniture and wall faces and snap to equal gaps; editable distances of
  the selected piece to its neighbors.
- Status bar under the plan with switches for the magnetism (F9), angles, objects (F3) and
  rulers, the snap radius and angle step, and the mouse position.
- Editing: room edge handles to add corners or move an edge, joining three or more walls and
  merging collinear walls, "Ruler at a distance…", "Keep proportions" for furniture, texts typed
  directly in the plan, Tab to select the next element under the mouse, crossing selection with
  a rubber band dragged to the left, filtering the selection by kind.
- 3D view with aerial view and virtual visit, photos (draft and GPU path tracing) and videos
  along a camera path; lamps light the 3D view, also with light from their model's materials.
- Location of the home with address search, and "Align north with the map" over an
  OpenStreetMap map.
- Reading and writing Sweet Home 3D files (`.sh3d`, `.sh3f`, `.sh3t`), verified against the
  original Sweet Home 3D reader.
- Catalog of installed Sweet Home 3D libraries, import of libraries, models (OBJ, DAE, 3DS,
  glTF/GLB and more) and textures, online catalog (sweethome3d.com, ambientCG, Poly Haven).
- Printing and export: PDF, SVG, PNG, CSV and OBJ.
- CLI `msh`, MCP server and live control of the running app.
- User interface in English, German, French and Italian, with error messages explained in the
  chosen language; user guide in English and German.
- MSI installer without bundled libraries; license and third-party notices installed with
  the app.

### Security

- Size limits for reading ZIP entries of untrusted files (ZIP bombs, crafted headers).
- Saving flushes the file to disk before it replaces the previous version.
- Updated `quick-xml` (0.42) and `zip` (9) for RUSTSEC-2026-0194, -0195, -0367, -0368,
  -0369 and -0429.

[Unreleased]: https://github.com/christophwalser/my-sweet-home/compare/0.1.0...HEAD
[0.1.0]: https://github.com/christophwalser/my-sweet-home/releases/tag/0.1.0
