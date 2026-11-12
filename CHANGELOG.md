# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The location of the home can also be set in the home properties.
- "Align north with the map": turn the walls over an OpenStreetMap map of the location to set
  the north direction of the compass; the map can be zoomed and moved.
- Rulers always show their length and angle in the plan, and both can be changed in the properties.
- A second digit chooses the variants of a plan tool, e.g. 2 then 1 for "Room from walls".
- Texts are typed directly in the plan; a double-click on a text changes it there.
- A piece dragged from the catalog shows at its size in the plan before it is dropped.
- "Keep proportions" for furniture, in the properties and with the plan handles.
- The texture chooser offers the five textures used last and keeps its search text.
- The context menu offers to remove the added dimensions of a wall or piece.
- Three or more walls can be joined, e.g. a third wall to two joined walls.
- Joining two collinear walls whose ends meet, e.g. the parts of a split wall, makes one wall.
- The list of selected elements can be filtered by kind, and a kind removed from the selection.
- Polylines can be shown in the 3D view ("Visible in 3D").

### Changed

- Error messages are shown in the chosen language with a clearer explanation.
- The furniture properties are ordered: name, description, size, elevation, position, angle,
  then color, texture, surface and materials.

### Fixed

- Lamps whose light comes from a material of their model (e.g. the contributed "Mini spot")
  are placed as lights and light the 3D view.
- Walls stop the light of the lamps nearest to the visitor in the virtual visit.
- Latitude and longitude are shown with four decimals instead of one.

## [0.1.0] - 2026-11-11

First public release.

### Added

- 2D plan editor: walls (also round), rooms, dimensions, labels, polylines, levels,
  furniture with docking to walls, doors and windows, background images, rulers.
- 3D view with aerial view and virtual visit, photos (draft and GPU path tracing) and videos
  along a camera path.
- Reading and writing Sweet Home 3D files (`.sh3d`, `.sh3f`, `.sh3t`), verified against the
  original Sweet Home 3D reader.
- Catalog of installed Sweet Home 3D libraries, import of libraries, models (OBJ, DAE, 3DS,
  glTF/GLB and more) and textures, online catalog (sweethome3d.com, ambientCG, Poly Haven).
- Printing and export: PDF, SVG, PNG, CSV and OBJ.
- CLI `msh`, MCP server and live control of the running app.
- User interface in English, German, French and Italian; user guide in English and German.
- MSI installer without bundled libraries; license and third-party notices installed with
  the app.

### Security

- Size limits for reading ZIP entries of untrusted files (ZIP bombs, crafted headers).
- Saving flushes the file to disk before it replaces the previous version.
- Updated `quick-xml` (0.42) and `zip` (9) for RUSTSEC-2026-0194, -0195, -0367, -0368,
  -0369 and -0429.

[Unreleased]: https://github.com/christophwalser/my-sweet-home/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/christophwalser/my-sweet-home/releases/tag/v0.1.0
