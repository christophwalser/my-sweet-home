//! Library editing commands and their own undo history (the basic workflow is in
//! `library_edit.rs`). Every test runs in a child process with its own temporary user
//! library folder (`common::isolated_catalog`).

mod common;

use base64::Engine;
use common::{
    isolated_catalog, new_doc, out_dir, png_bytes, run, run_err, snapshot, write_box_obj,
};
use msh_core::{Document, Registry};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// Runs a library command; library edits have their own history, so the home and its undo
/// stack stay untouched.
fn edit(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    let before = snapshot(doc);
    let could_undo = doc.can_undo();
    let result = run(r, doc, name, params);
    assert_eq!(snapshot(doc), before, "{name} changed the home");
    assert_eq!(doc.can_undo(), could_undo, "{name} created an undo step");
    result
}

/// A furniture library "Shop" with the pieces `names` (category "Boxes"). Returns its path
/// and the item indexes.
fn shop(r: &Registry, doc: &mut Document, root: &Path, names: &[&str]) -> (String, Vec<u64>) {
    let path = run(
        r,
        doc,
        "library_create",
        json!({ "kind": "furniture", "name": "Shop" }),
    )["path"]
        .as_str()
        .unwrap()
        .to_owned();
    let obj = write_box_obj(root, "box.obj", [50.0, 40.0, 30.0]);
    for name in names {
        run(
            r,
            doc,
            "furniture_import",
            json!({ "model_path": obj, "name": name, "category": "Boxes", "library": path }),
        );
    }
    let items = run(r, doc, "library_items", json!({ "path": path }));
    let indexes = items["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["index"].as_u64().unwrap())
        .collect();
    (path, indexes)
}

fn item(r: &Registry, doc: &mut Document, path: &str, index: u64) -> Value {
    edit(
        r,
        doc,
        "library_item",
        json!({ "path": path, "index": index }),
    )
}

fn names(r: &Registry, doc: &mut Document, path: &str) -> Vec<String> {
    edit(r, doc, "library_items", json!({ "path": path }))["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["name"].as_str().unwrap().to_owned())
        .collect()
}

fn history(r: &Registry, doc: &mut Document) -> Value {
    edit(r, doc, "library_history", json!({}))
}

#[test]
fn library_create_is_undone_in_the_library_history() {
    let Some(_root) = isolated_catalog("library_create_is_undone_in_the_library_history") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    assert_eq!(history(&r, &mut doc), json!({ "undo": null, "redo": null }));
    // Nothing to undo yet
    assert_eq!(
        edit(&r, &mut doc, "library_undo", json!({}))["undone"],
        Value::Null
    );
    let created = edit(
        &r,
        &mut doc,
        "library_create",
        json!({ "kind": "textures", "name": "  Walls  " }),
    );
    assert_eq!(created["name"], "Walls");
    assert_eq!(created["kind"], "textures");
    assert_eq!(created["history"]["undo"], "create library");
    let path = PathBuf::from(created["path"].as_str().unwrap());
    assert!(path.is_file());
    assert_eq!(path.extension().unwrap(), "sh3t");
    let undone = edit(&r, &mut doc, "library_undo", json!({}));
    assert_eq!(undone["undone"], "create library");
    assert!(!path.exists());
    assert_eq!(undone["history"]["redo"], "create library");
    edit(&r, &mut doc, "library_redo", json!({}));
    assert!(path.is_file());
    let err = run_err(
        &r,
        &mut doc,
        "library_create",
        json!({ "kind": "furniture", "name": " " }),
    );
    assert!(err.contains("empty"), "{err}");
    run_err(
        &r,
        &mut doc,
        "library_create",
        json!({ "kind": "lights", "name": "X" }),
    );
}

#[test]
fn library_rename_changes_the_shown_name_only() {
    let Some(root) = isolated_catalog("library_rename_changes_the_shown_name_only") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, indexes) = shop(&r, &mut doc, &root, &["Crate"]);
    let renamed = edit(
        &r,
        &mut doc,
        "library_rename",
        json!({ "path": path, "name": "Corner shop" }),
    );
    assert_eq!(renamed["history"]["undo"], "rename library");
    assert!(Path::new(&path).is_file(), "the file keeps its name");
    assert_eq!(
        item(&r, &mut doc, &path, indexes[0])["library"],
        "Corner shop"
    );
    edit(&r, &mut doc, "library_undo", json!({}));
    assert_eq!(item(&r, &mut doc, &path, indexes[0])["library"], "Shop");
    run_err(
        &r,
        &mut doc,
        "library_rename",
        json!({ "path": path, "name": "" }),
    );
    let elsewhere = out_dir("libedit-rename").join("x.sh3f");
    let err = run_err(
        &r,
        &mut doc,
        "library_rename",
        json!({ "path": elsewhere, "name": "X" }),
    );
    assert!(err.contains("unknown library"), "{err}");
}

#[test]
fn library_items_filter_by_kind_query_and_limit() {
    let Some(root) = isolated_catalog("library_items_filter_by_kind_query_and_limit") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, _) = shop(
        &r,
        &mut doc,
        &root,
        &["Crate Wq3", "Chest Wq3", "Barrel Wq3"],
    );
    let png = root.join("Linen Wq3.png");
    std::fs::write(&png, png_bytes(2, 2)).unwrap();
    run(&r, &mut doc, "texture_import", json!({ "path": png }));

    assert_eq!(names(&r, &mut doc, &path).len(), 3);
    let limited = edit(
        &r,
        &mut doc,
        "library_items",
        json!({ "path": path, "limit": 2 }),
    );
    assert_eq!(limited["items"].as_array().unwrap().len(), 2);
    // Search over all furniture libraries: all words must match
    let found = edit(
        &r,
        &mut doc,
        "library_items",
        json!({ "query": "wq3 boxes chest" }),
    );
    let found = found["items"].as_array().unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0]["name"], "Chest Wq3");
    assert_eq!(found[0]["library"], "Shop");
    // Textures only with kind
    let tex = edit(
        &r,
        &mut doc,
        "library_items",
        json!({ "query": "wq3", "kind": "textures" }),
    );
    let tex = tex["items"].as_array().unwrap();
    assert_eq!(tex.len(), 1);
    assert_eq!(tex[0]["name"], "Linen Wq3");
    run_err(
        &r,
        &mut doc,
        "library_items",
        json!({ "path": root.join("nope.sh3f") }),
    );
}

#[test]
fn library_item_refuses_unknown_items() {
    let Some(root) = isolated_catalog("library_item_refuses_unknown_items") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, indexes) = shop(&r, &mut doc, &root, &["Crate"]);
    let it = item(&r, &mut doc, &path, indexes[0]);
    assert_eq!(it["kind"], "furniture");
    assert_eq!(it["editable"], json!(true));
    assert_eq!(it["category"], "Boxes");
    assert_eq!(it["values"]["width"], "50");
    let err = run_err(
        &r,
        &mut doc,
        "library_item",
        json!({ "path": path, "index": 999 }),
    );
    assert!(err.contains("no item 999"), "{err}");
    run_err(
        &r,
        &mut doc,
        "library_item",
        json!({ "path": root.join("other.sh3f"), "index": 0 }),
    );
}

#[test]
fn update_item_sets_and_removes_keys() {
    let Some(root) = isolated_catalog("update_item_sets_and_removes_keys") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, indexes) = shop(&r, &mut doc, &root, &["Crate"]);
    let i = indexes[0];
    edit(
        &r,
        &mut doc,
        "library_update_item",
        json!({ "path": path, "index": i, "set": { "price": "9.90", "tags": "wood box" } }),
    );
    let changed = edit(
        &r,
        &mut doc,
        "library_update_item",
        json!({ "path": path, "index": i, "set": { "price": null, "category": "Storage" } }),
    );
    assert_eq!(changed["history"]["undo"], "change item");
    assert_eq!(changed["category"], "Storage");
    assert_eq!(changed["values"]["tags"], "wood box");
    assert!(changed["values"].get("price").is_none(), "removed");
    // The library file has the change
    assert_eq!(
        item(&r, &mut doc, &path, i)["values"]["category"],
        "Storage"
    );
    edit(&r, &mut doc, "library_undo", json!({}));
    let back = item(&r, &mut doc, &path, i);
    assert_eq!(back["values"]["price"], "9.90");
    assert_eq!(back["category"], "Boxes");
}

#[test]
fn update_item_refuses_protected_and_invalid_keys() {
    let Some(root) = isolated_catalog("update_item_refuses_protected_and_invalid_keys") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, indexes) = shop(&r, &mut doc, &root, &["Crate"]);
    let i = indexes[0];
    let before = std::fs::read(&path).unwrap();
    for (set, msg) in [
        (json!({ "id": "x#1" }), "cannot be set"),
        (json!({ "icon": "/1/icon.png" }), "cannot be set"),
        (json!({ "image": "/x.png" }), "cannot be set"),
        (json!({ "bad key": "1" }), "invalid key"),
        (json!({ "": "1" }), "invalid key"),
        (json!({ "name": null }), "cannot be removed"),
        (json!({ "category": "  " }), "cannot be empty"),
    ] {
        let err = run_err(
            &r,
            &mut doc,
            "library_update_item",
            json!({ "path": path, "index": i, "set": set }),
        );
        assert!(err.contains(msg), "{set}: {err}");
    }
    run_err(
        &r,
        &mut doc,
        "library_update_item",
        json!({ "path": path, "index": 77, "set": { "price": "1" } }),
    );
    assert_eq!(
        std::fs::read(&path).unwrap(),
        before,
        "the file is unchanged"
    );
    assert_eq!(history(&r, &mut doc)["undo"], "import");
}

#[test]
fn write_protected_libraries_are_read_only() {
    let Some(root) = isolated_catalog("write_protected_libraries_are_read_only") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, indexes) = shop(&r, &mut doc, &root, &["Crate"]);
    let set_readonly = |on: bool| {
        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_readonly(on);
        std::fs::set_permissions(&path, perms).unwrap();
    };
    set_readonly(true);
    assert_eq!(
        item(&r, &mut doc, &path, indexes[0])["editable"],
        json!(false)
    );
    let err = run_err(
        &r,
        &mut doc,
        "library_update_item",
        json!({ "path": path, "index": indexes[0], "set": { "price": "1" } }),
    );
    assert!(err.contains("read-only"), "{err}");
    run_err(
        &r,
        &mut doc,
        "library_remove_items",
        json!({ "path": path, "indexes": indexes }),
    );
    // Its items can still be copied into an own library
    let copy = edit(
        &r,
        &mut doc,
        "library_copy_items",
        json!({ "from": path, "indexes": indexes }),
    );
    assert!(copy["to"].as_str().unwrap().ends_with("My furniture.sh3f"));
    set_readonly(false);
}

#[test]
fn move_items_needs_items_and_a_category() {
    let Some(root) = isolated_catalog("move_items_needs_items_and_a_category") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, indexes) = shop(&r, &mut doc, &root, &["Crate", "Chest"]);
    let err = run_err(
        &r,
        &mut doc,
        "library_move_items",
        json!({ "path": path, "indexes": [], "category": "X" }),
    );
    assert!(err.contains("no items"), "{err}");
    run_err(
        &r,
        &mut doc,
        "library_move_items",
        json!({ "path": path, "indexes": [indexes[0], 99], "category": "X" }),
    );
    run_err(
        &r,
        &mut doc,
        "library_move_items",
        json!({ "path": path, "indexes": indexes, "category": " " }),
    );
    let moved = edit(
        &r,
        &mut doc,
        "library_move_items",
        json!({ "path": path, "indexes": indexes, "category": " Chests " }),
    );
    assert_eq!(moved["category"], "Chests");
    assert_eq!(moved["history"]["undo"], "move items");
    let cats = edit(&r, &mut doc, "library_categories", json!({ "path": path }));
    assert_eq!(cats["categories"], json!(["Chests"]));
}

#[test]
fn library_category_replaces_a_catalog_override() {
    let Some(root) = isolated_catalog("library_category_replaces_a_catalog_override") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, indexes) = shop(&r, &mut doc, &root, &["Crate Wq3"]);
    let id = item(&r, &mut doc, &path, indexes[0])["id"].clone();
    run(
        &r,
        &mut doc,
        "catalog_set_category",
        json!({ "catalog_id": id, "category": "Favourites" }),
    );
    edit(
        &r,
        &mut doc,
        "library_move_items",
        json!({ "path": path, "indexes": indexes, "category": "Storage" }),
    );
    // The library's own category is shown again, not the override
    let found = run(
        &r,
        &mut doc,
        "catalog_search",
        json!({ "query": "crate wq3" }),
    );
    assert_eq!(found["results"][0]["category"], "Storage");
}

#[test]
fn copy_items_goes_to_my_furniture_by_default() {
    let Some(root) = isolated_catalog("copy_items_goes_to_my_furniture_by_default") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, indexes) = shop(&r, &mut doc, &root, &["Crate", "Chest"]);
    let copy = edit(
        &r,
        &mut doc,
        "library_copy_items",
        // With several items the name is not used
        json!({ "from": path, "indexes": indexes, "name": "Ignored" }),
    );
    let to = copy["to"].as_str().unwrap().to_owned();
    assert!(to.ends_with("My furniture.sh3f"));
    assert_eq!(copy["history"]["undo"], "copy items");
    let mut copied = names(&r, &mut doc, &to);
    copied.sort();
    assert_eq!(copied, ["Chest", "Crate"]);
    // New catalog IDs, same values
    let first = item(&r, &mut doc, &to, copy["indexes"][0].as_u64().unwrap());
    let original = item(&r, &mut doc, &path, indexes[0]);
    assert_ne!(first["id"], original["id"]);
    assert_eq!(first["values"]["width"], original["values"]["width"]);
    // Undo removes the newly created library again
    edit(&r, &mut doc, "library_undo", json!({}));
    assert!(!Path::new(&to).exists());
}

#[test]
fn copy_items_refuses_unknown_targets_and_mixed_kinds() {
    let Some(root) = isolated_catalog("copy_items_refuses_unknown_targets_and_mixed_kinds") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, indexes) = shop(&r, &mut doc, &root, &["Crate"]);
    let textures = run(
        &r,
        &mut doc,
        "library_create",
        json!({ "kind": "textures", "name": "Tex" }),
    )["path"]
        .clone();
    let err = run_err(
        &r,
        &mut doc,
        "library_copy_items",
        json!({ "from": path, "indexes": indexes, "to": textures }),
    );
    assert!(err.contains("cannot be mixed"), "{err}");
    let err = run_err(
        &r,
        &mut doc,
        "library_copy_items",
        json!({ "from": path, "indexes": indexes, "to": root.join("new.sh3f") }),
    );
    assert!(err.contains("unknown target library"), "{err}");
    run_err(
        &r,
        &mut doc,
        "library_copy_items",
        json!({ "from": path, "indexes": [42] }),
    );
    run_err(
        &r,
        &mut doc,
        "library_copy_items",
        json!({ "from": root.join("nope.sh3f"), "indexes": [1] }),
    );
}

#[test]
fn remove_items_is_undone_and_redone() {
    let Some(root) = isolated_catalog("remove_items_is_undone_and_redone") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, indexes) = shop(&r, &mut doc, &root, &["Crate", "Chest", "Barrel"]);
    let removed = edit(
        &r,
        &mut doc,
        "library_remove_items",
        json!({ "path": path, "indexes": [indexes[0], indexes[2]] }),
    );
    assert_eq!(removed["removed"], json!([indexes[0], indexes[2]]));
    assert_eq!(names(&r, &mut doc, &path), ["Chest"]);
    edit(&r, &mut doc, "library_undo", json!({}));
    assert_eq!(names(&r, &mut doc, &path).len(), 3);
    let redone = edit(&r, &mut doc, "library_redo", json!({}));
    assert_eq!(redone["redone"], "remove items");
    assert_eq!(names(&r, &mut doc, &path), ["Chest"]);
    run_err(
        &r,
        &mut doc,
        "library_remove_items",
        json!({ "path": path, "indexes": [indexes[0]] }),
    );
}

#[test]
fn add_category_refuses_duplicates() {
    let Some(root) = isolated_catalog("add_category_refuses_duplicates") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, _) = shop(&r, &mut doc, &root, &["Crate"]);
    let added = edit(
        &r,
        &mut doc,
        "library_add_category",
        json!({ "path": path, "name": " Shelves " }),
    );
    assert_eq!(added["category"], "Shelves");
    for name in ["boxes", "SHELVES", "  "] {
        run_err(
            &r,
            &mut doc,
            "library_add_category",
            json!({ "path": path, "name": name }),
        );
    }
    let cats = edit(&r, &mut doc, "library_categories", json!({ "path": path }));
    assert_eq!(cats["categories"], json!(["Boxes", "Shelves"]));
    run_err(
        &r,
        &mut doc,
        "library_categories",
        json!({ "path": root.join("nope.sh3f") }),
    );
}

#[test]
fn set_icon_replaces_the_icon_with_a_png() {
    let Some(root) = isolated_catalog("set_icon_replaces_the_icon_with_a_png") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, indexes) = shop(&r, &mut doc, &root, &["Crate"]);
    let png = png_bytes(32, 32);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    let result = edit(
        &r,
        &mut doc,
        "library_set_icon",
        json!({ "path": path, "index": indexes[0], "png_base64": format!("data:image/png;base64,{b64}") }),
    );
    assert_eq!(result["history"]["undo"], "change icon");
    // The new icon is in the library file
    let icon = item(&r, &mut doc, &path, indexes[0])["values"]["icon"]
        .as_str()
        .unwrap()
        .trim_start_matches('/')
        .to_owned();
    let mut zip = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
    let mut data = Vec::new();
    std::io::Read::read_to_end(&mut zip.by_name(&icon).unwrap(), &mut data).unwrap();
    assert_eq!(data, png);

    let jpeg = base64::engine::general_purpose::STANDARD.encode([0xFF, 0xD8, 0xFF, 0xE0]);
    let err = run_err(
        &r,
        &mut doc,
        "library_set_icon",
        json!({ "path": path, "index": indexes[0], "png_base64": jpeg }),
    );
    assert!(err.contains("not a PNG"), "{err}");
    let err = run_err(
        &r,
        &mut doc,
        "library_set_icon",
        json!({ "path": path, "index": indexes[0], "png_base64": "!!" }),
    );
    assert!(err.contains("invalid icon"), "{err}");
    run_err(
        &r,
        &mut doc,
        "library_set_icon",
        json!({ "path": path, "index": 50, "png_base64": b64 }),
    );
}

#[test]
fn pieces_of_the_home_are_added_with_their_size() {
    let Some(root) = isolated_catalog("pieces_of_the_home_are_added_with_their_size") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, indexes) = shop(&r, &mut doc, &root, &["Crate Wq3"]);
    let id = item(&r, &mut doc, &path, indexes[0])["id"].clone();
    let piece = run(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": id, "x": 0, "y": 0, "width": 120, "name": "Big crate" }),
    )["id"]
        .clone();
    let added = edit(
        &r,
        &mut doc,
        "library_add_from_home",
        json!({ "ids": [piece, "no-such-piece"] }),
    );
    let to = added["path"].as_str().unwrap().to_owned();
    assert!(to.ends_with("My furniture.sh3f"));
    assert_eq!(added["history"]["undo"], "add from home");
    let new = item(&r, &mut doc, &to, added["indexes"][0].as_u64().unwrap());
    assert_eq!(new["name"], "Big crate");
    assert_eq!(new["category"], "From the home");
    assert_eq!(new["values"]["width"], "120");
    assert_eq!(new["values"]["depth"], "30");
    // It can be placed from the catalog like any other item
    run(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": new["id"], "x": 200, "y": 0 }),
    );

    // Into a given library with a category
    let again = edit(
        &r,
        &mut doc,
        "library_add_from_home",
        json!({ "ids": [piece], "path": path, "category": "Reused" }),
    );
    let reused = item(&r, &mut doc, &path, again["indexes"][0].as_u64().unwrap());
    assert_eq!(reused["category"], "Reused");
}

#[test]
fn add_from_home_refuses_unknown_pieces_and_wrong_targets() {
    let Some(root) = isolated_catalog("add_from_home_refuses_unknown_pieces_and_wrong_targets")
    else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (path, indexes) = shop(&r, &mut doc, &root, &["Crate"]);
    let err = run_err(
        &r,
        &mut doc,
        "library_add_from_home",
        json!({ "ids": ["nope"], "path": path }),
    );
    assert!(err.contains("none of the IDs"), "{err}");
    let id = item(&r, &mut doc, &path, indexes[0])["id"].clone();
    let piece = run(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": id, "x": 0, "y": 0 }),
    )["id"]
        .clone();
    let textures = run(
        &r,
        &mut doc,
        "library_create",
        json!({ "kind": "textures", "name": "Tex" }),
    )["path"]
        .clone();
    let err = run_err(
        &r,
        &mut doc,
        "library_add_from_home",
        json!({ "ids": [piece], "path": textures }),
    );
    assert!(err.contains("texture library"), "{err}");
    let err = run_err(
        &r,
        &mut doc,
        "library_add_from_home",
        json!({ "ids": [piece], "path": root.join("elsewhere.sh3f") }),
    );
    assert!(err.contains("unknown target library"), "{err}");
}
