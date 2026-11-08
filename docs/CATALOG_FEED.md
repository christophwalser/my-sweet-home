# Catalog feed format (msh-catalog, version 1)

My Sweet Home can search and import furniture models, textures and whole libraries from
catalog servers of its own users, for example the catalog server of a company. A catalog
server only has to publish **one JSON file**, the *feed*, plus the files it lists. There is no
special server software: a static web server, a file share or a cloud storage bucket is
enough.

In the app a catalog is added under *Preferences › Catalogs* with a name, the address of the
feed and, if the server needs it, an access token. The catalog then appears as a source in
*Furniture › Online catalogs…*; the CLI and the MCP server reach it with
`online_search` / `online_download` and `source: "feed"`, `url: "<feed address>"`.

## Where the feed can live

- **HTTPS** (or HTTP): `https://catalog.example.com/msh/catalog.json`
- **A file or file share**: `\\fileserver\catalog\catalog.json`, `C:\Catalog\catalog.json`
  or `file:///C:/Catalog/catalog.json`

Addresses inside the feed may be absolute or **relative to the feed** (`models/chair.zip`
next to `catalog.json`).

## Access tokens

When a token is set for a catalog, every request to the feed's own host (and only to that
host) carries the header

```
Authorization: Bearer <token>
```

Files on other hosts are fetched without it, so the token never leaves the catalog server.
File shares use the Windows sign-in of the user instead.

## The feed

```json
{
  "format": "msh-catalog",
  "version": 1,
  "name": "ACME furniture",
  "description": "Office furniture of ACME, with prices",
  "items": [
    {
      "id": "acme-chair-oslo",
      "type": "model",
      "name": "Chair Oslo",
      "url": "models/chair-oslo.zip",
      "thumbnail": "thumbs/chair-oslo.png",
      "category": "Chairs",
      "tags": ["chair", "oak", "office"],
      "author": "ACME",
      "license": "ACME internal use",
      "size": 284311,
      "width": 52,
      "depth": 55,
      "height": 82
    },
    {
      "id": "acme-oak-floor",
      "type": "texture",
      "name": "Oak floor, natural",
      "url": "textures/oak-floor.jpg",
      "thumbnail": "thumbs/oak-floor.jpg",
      "category": "Floors",
      "tile_width": 120,
      "tile_height": 20
    },
    {
      "id": "acme-kitchen-2026",
      "type": "library",
      "name": "ACME kitchens 2026",
      "url": "libraries/acme-kitchens-2026.sh3f",
      "size": 48211993
    }
  ]
}
```

### Feed fields

| Field | Required | Meaning |
|-------|----------|---------|
| `format` | yes | Always `"msh-catalog"` |
| `version` | yes | `1`. Readers accept higher versions as long as they keep the fields of version 1. |
| `name` | no | Name of the catalog (the app shows the name the user gave it) |
| `description` | no | One line about the catalog |
| `items` | yes | The items, see below |

### Item fields

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Unique within the feed, stable over time |
| `type` | yes | `"model"` (one piece of furniture), `"texture"` or `"library"` (a Sweet Home 3D `.sh3f` furniture or `.sh3t` texture library) |
| `name` | yes | Name shown and used in the catalog |
| `url` | yes | The file to download, absolute or relative to the feed |
| `files` | no | Models only: further files the model needs, `[{"path": "textures/oak.jpg", "url": "…"}]`, stored next to the model under `path` (for an OBJ with its MTL and textures). Simpler: put everything in one ZIP. |
| `thumbnail` | no | Preview image (PNG, JPEG, GIF or WebP, ideally 256 × 256 px, at most 1 MB) |
| `category` | no | Category in the catalog |
| `tags` | no | Search words |
| `author` | no | Creator, shown and stored with the item |
| `license` | no | License text or name |
| `size` | no | Download size in bytes (shown before the download) |
| `width`, `depth`, `height` | no | Models: size in cm |
| `door_or_window` | no | Models: `true` for doors and windows (they cut openings into walls) |
| `tile_width`, `tile_height` | no | Textures: real size of one tile of the image in cm (default 100 × 100) |

### File formats

- **Models**: everything the furniture import reads: OBJ (with `files` or in a ZIP), DAE,
  3DS, glTF / GLB, 3MF, STL, PLY, or a ZIP / KMZ archive with one of them. FBX and VRML
  are converted in the app only, not by the CLI or the MCP server.
- **Textures**: JPEG, PNG, BMP, GIF, WebP, TIFF, SVG, or a PBR material package (ZIP; its
  color map is used).
- **Libraries**: `.sh3f` and `.sh3t` files of Sweet Home 3D, or a ZIP containing one.

## How the app uses the feed

The app reads the whole feed when the catalog is opened and searches its items itself (in
name, category and tags), so a static file is all a server needs. Thumbnails are fetched
for the items shown. An item is downloaded only when the user imports it; it then goes
through the same import as a local file and ends up in the user's libraries ("My
furniture", "My textures" or the library folder), which Sweet Home 3D shares.

Large catalogs work best split into several feeds (for example one per product line).
