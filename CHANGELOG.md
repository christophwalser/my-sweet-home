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
- 3D view: a click selects an element, selected furniture can be dragged, and Escape and Delete
  work there as in the plan.
- 3D view: standard views (top, front, back, left, right, isometric), parallel projection, "Fit"
  and "Zoom to selection" in the new "Views" menu and the "3D view" menu; the wheel zooms to the
  pointer, the arrow keys and +/- move the view, and an arrow shows north.
- 3D view: a horizontal or vertical section through the home (3D settings).
- Sun study in the 3D settings: sliders for the time of day and the day of the year with a live
  preview, "Play the day" and a switch for shadows.
- Points of view show a thumbnail and can be renamed (F2) and updated (`viewpoint_rename`;
  storing under an existing name keeps its place in the list).
- Photo: size presets, the file format (PNG or JPEG) is chosen in the panel, the remaining time
  is shown, and the view is shown at once while a higher quality prepares.
- Video: the key points show thumbnails, a click goes to one, they can be reordered
  (`camera_path_move`), and the plan shows the camera path while the panel is open.
- Grid snap ("View › Magnetism › Snap to the grid" or the switch in the status bar, off at
  first): drawn points and moved elements land on the grid that is drawn; points, faces and
  alignments of objects win over the grid.
- The menu bar works with the keyboard as in Windows: Alt or F10 goes to it and shows the access
  keys, Alt+letter opens a menu, and the arrow keys, Home, End and letters move in it.
- A "View" menu with zoom, grid, rulers, magnetism, the side panels, plan or 3D view alone, the
  theme and the size of the user interface.
- The side panels can be hidden with F6 and F4 or by dragging them shut; the splitters take the
  arrow keys.
- Properties are grouped in sections that can be closed (remembered), the actions of the
  selection stay in view above them, and furniture has a field for its level
  (`furniture_update` takes `level`).
- Undo and redo name the step they act on, and the tool bar lists the history.
- Messages are laid over the window: errors stay until they are closed, saving reports its
  success, and the status bar lists the messages.
- The grid has a fixed or an automatic distance; the status bar shows the scale and the grid.
- A free angle step for the angle magnetism, "Zoom to the selection" in the plan, and an opacity
  for the background image, which now uses the unit of the preferences.
- The command search matches loosely and lists the recent commands; the letter keys of the plan
  tools can be changed.
- `scripts/perf.ps1` starts the app, runs typical edits and prints the time of each stage.
- Terrain from height grids: XYZ and ASC files (in meters) are imported as a terrain mesh;
  marked as terrain, it replaces the flat ground under it in 3D.
- Furniture import: the unit of the model can be chosen (`furniture_import` takes `unit`), the
  model can be placed as reference object right away, and it can keep the zero point of its
  file (`origin` in the result of `furniture_import`).
- Reference objects can be aligned with two pairs of points clicked in the plan, optionally
  resized to fit (`furniture_align_points`).
- Reference objects can show a cut at a height above the floor instead of their view from
  above, e.g. the walls of a scanned house; the lines of the cut can attract the pointer.
- Reference objects are listed under the plan in the status bar and can be shown or hidden in
  the plan and in 3D separately, with an opacity in the plan.
- The map of "Align north with the map" can be used as background image of the plan, true to
  scale and turned like the plan.
- Roofs: "Roof over the walls" and "Roof over a rectangle…" add a gable, hip, shed or flat roof
  with a pitch, an overhang and a thickness (`roof_add`, `roof_update`); each edge can be an
  eave or a gable, and the roof covering and the gable walls take a color or a texture. The
  plan shows a roof as its lines, exports and prints too; "3D view ›
  Roofs" leaves the roofs out of the 3D view. A roof is saved as a piece of furniture with a
  generated model, so Sweet Home 3D shows it.

### Changed

- Edits are several times faster: after a command the windows get only the changes of the home
  instead of the whole home, unchanged parts of the plan and the 3D view are kept, and the plan
  is shown before the 3D view draws.
- Escape discards a drawing instead of keeping it, and a double-click on an empty place no longer
  fits the plan to the window.
- The Plan menu groups its tools; the empty Extensions menu and the second entry for the 3D
  settings are gone.
- Lengths are shown with one precision everywhere.
- "Add…" in the catalog opens the file dialog right away for furniture, as it did for textures.
- A PLY file that is a point cloud is refused with a reason instead of "no triangles".

- Doors and windows are easier to place in a wall with the mouse: the wall they are in holds
  them at corners, they align only with openings and walls nearby, they catch the middle of the
  free space, and across a thick wall they follow the pointer and catch its middle and its faces.
- The photo and video panels and the 3D settings no longer block the window, and the 3D
  settings no longer open under the tool bar.

- "Fit plan to window" fits to the walls of the level (the building); terrain, parcel lines and
  other things around the house no longer widen it. Levels without walls fit as before.

- Pieces of a lower level that reach up into the shown level (e.g. a tall terrain model) are
  shown faint in its plan and can no longer be picked or snapped to there; staircases still can.

### Fixed

- Undo after saving finds the model of a piece that was deleted or replaced before the save;
  the saved file still leaves out resources that nothing uses any more.
- Elements moved with the mouse, or changed with a handle, no longer jump back to their old place
  for a moment when the mouse button is released.
- In the virtual visit the sky no longer shows through a slit in the ceiling above walls lower
  than the ceiling (e.g. half-height walls): the ceiling of the room next to them now covers them.
- The snap points on the faces of thick walls no longer disappear when the plan is zoomed in far.
- A hidden piece of furniture or reference object stays selected and keeps its properties, so it
  can be shown again there (before, it vanished from the panel and the home details).
- Collapsing the plan no longer takes the whole window down when a wall is selected; the plan
  keeps its view while it is collapsed.
- The 3D view no longer jumps back to the stored camera after the first command that touches a
  camera (e.g. a new time of the sun or a stored point of view).
- "Room from walls" finds rooms enclosed by walls of different thickness that meet edge to edge.
- In the virtual visit the lamps of the level below no longer brighten the foot of the walls.
- The preview of a photo keeps its aspect ratio.
- A new grid distance is drawn at once, not only after the next change of the tool.
- Number fields of the tool options (e.g. the wall thickness) can be emptied while typing.
- The distances of an opening are labelled "Distance on the left / right / above / below".

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
