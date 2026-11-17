# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- "Reference object" for furniture such as terrain, laser scans and neighbor houses: the plan
  shows it faint under the background image and clicks, the rubber band and the magnetism ignore it; the 3D
  view is unchanged.
- Walls get a color and a texture for their top ("Top" in their properties), seen in 3D on walls
  lower than the ceiling; Sweet Home 3D shows the top color and ignores the texture.
- Rulers can be shown on all levels (checkbox in their properties), e.g. to line up the floors.
- Rulers can be copied, cut, pasted and duplicated like other elements; color, dashes and "On all
  levels" can be changed for several selected rulers at once.
- Reference objects are their own kind of object, like the background image: they are listed in
  the home details (show or hide each one, change it in its own panel with name, position,
  elevation and angle) and no longer in the furniture list; the plan shows them faint under
  every level above theirs. They are still saved as furniture, so Sweet Home 3D opens the file.
- Magnetism: a wall can start on the face of another wall with one of its sides flush with that
  wall's corner (snap point "flush with wall corner", using the thickness of the new wall).

### Changed

- "Fit plan to window" fits to the walls of the level (the building); terrain, parcel lines and
  other things around the house no longer widen it. Levels without walls fit as before.

- Pieces of a lower level that reach up into the shown level (e.g. a tall terrain model) are
  shown faint in its plan and can no longer be picked or snapped to there; staircases still can.

### Fixed

- Elements moved with the mouse, or changed with a handle, no longer jump back to their old place
  for a moment when the mouse button is released.
- In the virtual visit the sky no longer shows through a slit in the ceiling above walls lower
  than the ceiling (e.g. half-height walls): the ceiling of the room next to them now covers them.
- The snap points on the faces of thick walls no longer disappear when the plan is zoomed in far.
- A hidden piece of furniture or reference object stays selected and keeps its properties, so it
  can be shown again there (before, it vanished from the panel and the home details).

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
