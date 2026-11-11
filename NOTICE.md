# Notices

## My Sweet Home

Copyright (C) 2026 Christoph Walser and the My Sweet Home contributors.

My Sweet Home is free software: you can redistribute it and/or modify it under the terms of
the GNU General Public License as published by the Free Software Foundation, either version 3
of the License, or (at your option) any later version. See [LICENSE](LICENSE).

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

## Derived from Sweet Home 3D

My Sweet Home is an independent rewrite of [Sweet Home 3D](https://www.sweethome3d.com).
Its file formats are compatible, and algorithms (wall geometry, details of the file formats)
were ported from the Java source code of Sweet Home 3D:

> Sweet Home 3D, Copyright (c) 2005-2026 Space Mushrooms / eTeks
> \<info@sweethome3d.com\>, licensed under the GNU General Public License version 2 or
> (at your option) any later version.

The "or any later version" option of Sweet Home 3D's license allows this derived work to be
distributed under the GNU General Public License version 3 or later.

## Trademarks and affiliation

"Sweet Home 3D" is a name of eTeks / Space Mushrooms. My Sweet Home is **not affiliated with,
endorsed by or sponsored by** eTeks, Space Mushrooms or the Sweet Home 3D project. The name
Sweet Home 3D is used only to describe file compatibility.

## Test data in this repository

`tests/corpus/examples/*.xml` are the example homes of Sweet Home 3D 7.6.1 (`Examples.jar`),
authors Véronique and Emmanuel Puybaret, licensed under CC-BY 3.0
(<https://creativecommons.org/licenses/by/3.0/>) or the GNU GPL. They are used unchanged as
test input.

## Furniture and texture libraries

No furniture or texture libraries are included in this repository or in the release
artifacts. My Sweet Home uses the libraries of an installed Sweet Home 3D and those the user
imports or downloads (e.g. from sweethome3d.com, ambientCG or Poly Haven through the online
catalog); each keeps its own license, which the app shows with the item.

## Third-party software

The release artifacts contain open source components (Rust crates and npm packages) under
permissive licenses (mostly MIT and Apache-2.0, also BSD, ISC, Zlib, Unicode-3.0 and
MPL-2.0). Their license texts are collected at build time by
[`scripts/third-party-notices.mjs`](scripts/third-party-notices.mjs) into
`THIRD-PARTY-NOTICES.txt`, which is installed with the application and attached to every
release. Components licensed only under Apache-2.0 (e.g. `tao`, `ring`, `pdfjs-dist`) are
compatible with GPL-3.0 but not with GPL-2.0; this is one reason why My Sweet Home uses
GPL-3.0-or-later.
