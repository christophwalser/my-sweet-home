# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
