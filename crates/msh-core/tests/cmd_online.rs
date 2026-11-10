//! Online sources without network access: parameter checks that fail before any request,
//! and catalog feeds (`source: "feed"`) read from local files.

mod common;

use common::{isolated_catalog, new_doc, out_dir, png_bytes, run, run_err, snapshot};
use msh_core::{Document, Registry};
use serde_json::{Value, json};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Runs an online command and checks that the home and its undo stack stay untouched.
fn online(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    let before = snapshot(doc);
    let could_undo = doc.can_undo();
    let result = run(r, doc, name, params);
    assert_eq!(snapshot(doc), before, "{name} changed the home");
    assert_eq!(doc.can_undo(), could_undo, "{name} created an undo step");
    result
}

/// A unique item ID (downloads go to a shared temporary folder named after the ID).
fn uid(name: &str) -> String {
    format!("{name}-{}", std::process::id())
}

/// Writes `catalog.json` with `items` into `dir` and returns its path.
fn write_feed(dir: &Path, items: Value) -> PathBuf {
    let feed = json!({ "format": "msh-catalog", "version": 1, "name": "ACME", "items": items });
    let path = dir.join("catalog.json");
    std::fs::write(&path, feed.to_string()).unwrap();
    path
}

/// A ZIP with the given entries.
fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, data) in entries {
        zip.start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(data).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

/// A feed with a model, two textures and a furniture library.
fn sample_feed(dir: &Path) -> PathBuf {
    std::fs::create_dir_all(dir.join("thumbs")).unwrap();
    std::fs::write(dir.join("thumbs").join("chair.png"), png_bytes(2, 2)).unwrap();
    write_feed(
        dir,
        json!([
            { "id": uid("chair"), "type": "model", "name": "Chair Oslo", "url": "models/chair.obj",
              "thumbnail": "thumbs/chair.png", "category": "Chairs", "tags": ["oak"],
              "author": "ACME", "license": "internal", "size": 1234 },
            { "id": uid("oak"), "type": "texture", "name": "Oak floor", "url": "textures/oak.jpg",
              "tile_width": 120, "tile_height": 20 },
            { "id": uid("slate"), "type": "texture", "name": "Slate", "url": "textures/slate.jpg",
              "tile_width": 50 },
            { "id": uid("kitchens"), "type": "library", "name": "Kitchens",
              "url": "libraries/kitchens.sh3f" }
        ]),
    )
}

#[test]
fn checks_that_fail_before_any_request() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let err = run_err(
        &r,
        &mut doc,
        "online_search",
        json!({ "source": "ambientcg", "kind": "furniture" }),
    );
    assert!(err.contains("textures only"), "{err}");
    for cmd in ["online_search", "online_download"] {
        let err = run_err(
            &r,
            &mut doc,
            cmd,
            json!({ "source": "feed", "kind": "furniture", "id": "x" }),
        );
        assert!(err.contains("url of the feed"), "{err}");
    }
    let err = run_err(
        &r,
        &mut doc,
        "online_download",
        json!({ "source": "polyhaven", "kind": "textures", "id": "wood", "resolution": "8k" }),
    );
    assert!(err.contains("resolution"), "{err}");
    for id in [
        "/other/lib.zip",
        "/SweetHome3D-models/../x.zip",
        "/SweetHome3D-models/lib.exe",
    ] {
        let err = run_err(
            &r,
            &mut doc,
            "online_download",
            json!({ "source": "sh3d", "kind": "furniture", "id": id }),
        );
        assert!(err.contains("unknown Sweet Home 3D library"), "{err}");
    }
    for id in ["../etc", "a/b", "wood floor"] {
        let err = run_err(
            &r,
            &mut doc,
            "online_download",
            json!({ "source": "polyhaven", "kind": "furniture", "id": id }),
        );
        assert!(err.contains("unknown Poly Haven asset"), "{err}");
    }
    run_err(
        &r,
        &mut doc,
        "online_search",
        json!({ "source": "thingiverse", "kind": "furniture" }),
    );
}

#[test]
fn feed_search_filters_by_kind_and_words() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let dir = out_dir("online-feed-search");
    let feed = sample_feed(&dir);
    let all = online(
        &r,
        &mut doc,
        "online_search",
        json!({ "source": "feed", "kind": "furniture", "url": feed }),
    );
    assert_eq!(all["catalog"], "ACME");
    assert_eq!(
        all["total"],
        json!(2),
        "the model and the furniture library"
    );
    let chair = &all["items"][0];
    assert_eq!(chair["name"], "Chair Oslo");
    assert_eq!(chair["author"], "ACME");
    assert_eq!(chair["license"], "internal");
    assert_eq!(chair["size"], json!(1234));
    // The preview image is sent as data URL
    assert!(
        chair["thumbnail"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,")
    );
    // Words match name, category, tags and author
    let oak = online(
        &r,
        &mut doc,
        "online_search",
        json!({ "source": "feed", "kind": "furniture", "url": feed, "query": "CHAIRS oak" }),
    );
    assert_eq!(oak["total"], json!(1));
    let textures = online(
        &r,
        &mut doc,
        "online_search",
        json!({ "source": "feed", "kind": "textures", "url": feed }),
    );
    let items = textures["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(
        (
            items[0]["width_cm"].as_f64(),
            items[0]["height_cm"].as_f64()
        ),
        (Some(120.0), Some(20.0))
    );
    // A missing tile height is the width
    assert_eq!(items[1]["height_cm"].as_f64(), Some(50.0));
    assert_eq!(items[1]["license"], "");
}

#[test]
fn feed_search_pages_with_offset_and_limit() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let dir = out_dir("online-feed-paging");
    let items: Vec<Value> = (0..5)
        .map(|i| json!({ "id": uid(&format!("m{i}")), "type": "model", "name": format!("Model {i}"), "url": "m.obj" }))
        .collect();
    let feed = write_feed(&dir, Value::Array(items));
    // A file:// address works as well as a path
    let url = format!("file:///{}", feed.display().to_string().replace('\\', "/"));
    let page = online(
        &r,
        &mut doc,
        "online_search",
        json!({ "source": "feed", "kind": "furniture", "url": url, "offset": 3, "limit": 10 }),
    );
    assert_eq!(page["total"], json!(5));
    assert_eq!(page["offset"], json!(3));
    let names: Vec<&str> = page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Model 3", "Model 4"]);
    let one = online(
        &r,
        &mut doc,
        "online_search",
        json!({ "source": "feed", "kind": "furniture", "url": feed, "limit": 0 }),
    );
    assert_eq!(one["items"].as_array().unwrap().len(), 1, "at least one");
}

#[test]
fn invalid_feeds_are_refused() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let dir = out_dir("online-feed-invalid");
    let search = |doc: &mut Document, url: &Value| {
        run_err(
            &r,
            doc,
            "online_search",
            json!({ "source": "feed", "kind": "textures", "url": url }),
        )
    };
    let err = search(&mut doc, &json!(""));
    assert!(err.contains("no address"), "{err}");
    let err = search(&mut doc, &json!(dir.join("missing.json")));
    assert!(err.contains("cannot read"), "{err}");
    let other = dir.join("other.json");
    std::fs::write(&other, r#"{"format":"other","version":1,"items":[]}"#).unwrap();
    let err = search(&mut doc, &json!(other));
    assert!(err.contains("no msh-catalog feed"), "{err}");
    let broken = dir.join("broken.json");
    std::fs::write(&broken, "{ not json").unwrap();
    let err = search(&mut doc, &json!(broken));
    assert!(err.contains("no valid msh-catalog feed"), "{err}");
    let old = dir.join("old.json");
    std::fs::write(&old, r#"{"format":"msh-catalog","version":0,"items":[]}"#).unwrap();
    search(&mut doc, &json!(old));
}

#[test]
fn feed_downloads_models_with_their_files() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let dir = out_dir("online-feed-model");
    std::fs::create_dir_all(dir.join("models")).unwrap();
    std::fs::write(dir.join("models").join("chair.obj"), "v 0 0 0\n").unwrap();
    std::fs::write(dir.join("models").join("chair.mtl"), "newmtl a\n").unwrap();
    std::fs::write(dir.join("secret.txt"), "secret").unwrap();
    let id = uid("feed-chair");
    let feed = write_feed(
        &dir,
        json!([{ "id": id, "type": "model", "name": "Chair Oslo", "url": "models/chair.obj",
                 "category": "Chairs", "author": "ACME", "license": "internal",
                 "width": 52, "depth": 50, "height": 90, "door_or_window": false,
                 "files": [
                     { "path": "chair.mtl", "url": "models/chair.mtl" },
                     { "path": "../escape.txt", "url": "secret.txt" }
                 ] }]),
    );
    let d = online(
        &r,
        &mut doc,
        "online_download",
        json!({ "source": "feed", "kind": "furniture", "url": feed, "id": id }),
    );
    assert_eq!(d["type"], "model");
    assert_eq!(d["name"], "Chair Oslo");
    assert_eq!(d["creator"], "ACME");
    assert_eq!(d["category"], "Chairs");
    assert_eq!(
        (&d["width"], &d["depth"], &d["height"]),
        (&json!(52.0), &json!(50.0), &json!(90.0))
    );
    // Named after the item, with the extension of its file; extra files next to it
    let main = PathBuf::from(d["path"].as_str().unwrap());
    assert_eq!(main.file_name().unwrap(), "Chair Oslo.obj");
    assert_eq!(std::fs::read_to_string(&main).unwrap(), "v 0 0 0\n");
    let folder = main.parent().unwrap();
    assert!(folder.join("chair.mtl").is_file());
    // Paths leaving the download folder are skipped
    assert!(!folder.parent().unwrap().join("escape.txt").exists());
    let _ = std::fs::remove_dir_all(folder);
    let err = run_err(
        &r,
        &mut doc,
        "online_download",
        json!({ "source": "feed", "kind": "furniture", "url": feed, "id": "no-such-item" }),
    );
    assert!(err.contains("no item"), "{err}");
}

#[test]
fn feed_downloads_textures_and_libraries() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let dir = out_dir("online-feed-library");
    std::fs::create_dir_all(dir.join("libraries")).unwrap();
    std::fs::write(dir.join("oak.jpg"), b"jpeg data").unwrap();
    std::fs::write(dir.join("libraries").join("tiles.sh3t"), b"library").unwrap();
    std::fs::write(
        dir.join("libraries").join("bundle.zip"),
        zip_with(&[
            ("readme.txt", b"hi"),
            ("folder/Kitchens.sh3f", b"furniture"),
        ]),
    )
    .unwrap();
    std::fs::write(
        dir.join("libraries").join("empty.zip"),
        zip_with(&[("readme.txt", b"hi")]),
    )
    .unwrap();
    let (oak, tiles, bundle, empty, outside) = (
        uid("feed-oak"),
        uid("feed-tiles"),
        uid("feed-bundle"),
        uid("feed-empty"),
        uid("feed-outside"),
    );
    let feed = write_feed(
        &dir,
        json!([
            { "id": oak, "type": "texture", "name": "Oak floor", "url": "oak.jpg", "tile_width": 80 },
            { "id": tiles, "type": "library", "name": "Tiles", "url": "libraries/tiles.sh3t" },
            { "id": bundle, "type": "library", "name": "Bundle", "url": "libraries/bundle.zip" },
            { "id": empty, "type": "library", "name": "Empty", "url": "libraries/empty.zip" },
            { "id": outside, "type": "texture", "name": "Outside", "url": "../outside.jpg" }
        ]),
    );
    let download = |doc: &mut Document, id: &str| {
        online(
            &r,
            doc,
            "online_download",
            json!({ "source": "feed", "kind": "textures", "url": feed, "id": id }),
        )
    };
    let d = download(&mut doc, &oak);
    assert_eq!(d["type"], "texture");
    assert_eq!(
        (d["width_cm"].as_f64(), d["height_cm"].as_f64()),
        (Some(80.0), Some(80.0))
    );
    // Without a category the feed's name is used
    assert_eq!(d["category"], "ACME");
    assert!(d["path"].as_str().unwrap().ends_with("Oak floor.jpg"));
    // Libraries keep their file name
    let d = download(&mut doc, &tiles);
    assert_eq!(d["type"], "library");
    assert_eq!(d["name"], "tiles.sh3t");
    assert_eq!(
        std::fs::read(d["path"].as_str().unwrap()).unwrap(),
        b"library"
    );
    // A library in a ZIP is unpacked
    let d = download(&mut doc, &bundle);
    assert_eq!(
        d,
        json!({ "path": d["path"], "type": "library", "name": "Kitchens.sh3f" })
    );
    assert_eq!(
        std::fs::read(d["path"].as_str().unwrap()).unwrap(),
        b"furniture"
    );
    let err = run_err(
        &r,
        &mut doc,
        "online_download",
        json!({ "source": "feed", "kind": "textures", "url": feed, "id": empty }),
    );
    assert!(err.contains("contains no library"), "{err}");
    let err = run_err(
        &r,
        &mut doc,
        "online_download",
        json!({ "source": "feed", "kind": "textures", "url": feed, "id": outside }),
    );
    assert!(err.contains("invalid path"), "{err}");
}

#[test]
fn downloaded_feed_items_can_be_imported() {
    let Some(root) = isolated_catalog("downloaded_feed_items_can_be_imported") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let dir = root.join("feed");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("tile.png"), png_bytes(4, 4)).unwrap();
    let id = uid("feed-import");
    let feed = write_feed(
        &dir,
        json!([{ "id": id, "type": "texture", "name": "Terracotta Pw4", "url": "tile.png",
                 "author": "ACME", "tile_width": 25 }]),
    );
    let d = online(
        &r,
        &mut doc,
        "online_download",
        json!({ "source": "feed", "kind": "textures", "url": feed, "id": id }),
    );
    let added = run(
        &r,
        &mut doc,
        "texture_import",
        json!({ "path": d["path"], "name": d["name"], "creator": d["creator"],
                "width": d["width_cm"], "height": d["height_cm"] }),
    );
    let found = run(
        &r,
        &mut doc,
        "catalog_search",
        json!({ "query": "terracotta pw4", "kind": "textures" }),
    );
    assert_eq!(found["results"][0]["catalog_id"], added["catalog_id"]);
    assert_eq!(found["results"][0]["width"].as_f64(), Some(25.0));
}
