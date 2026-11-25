//! Library commands: list, import, show / hide, item categories, remove. Every test runs in
//! a child process with its own temporary user library folder (`common::isolated_catalog`).

mod common;

use common::{
    isolated_catalog, new_doc, out_dir, png_bytes, run, run_err, snapshot, write_box_obj,
};
use msh_core::{Document, Registry};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// Runs a library command and checks that it leaves the home and its undo stack alone.
fn lib_cmd(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    let before = snapshot(doc);
    let could_undo = doc.can_undo();
    let result = run(r, doc, name, params);
    assert_eq!(snapshot(doc), before, "{name} changed the home");
    assert_eq!(doc.can_undo(), could_undo, "{name} created an undo step");
    result
}

/// A furniture library outside the user folders with one piece named `piece`, made in the
/// user folder and moved out. Returns its path.
fn external_library(
    r: &Registry,
    doc: &mut Document,
    root: &Path,
    file: &str,
    piece: &str,
) -> PathBuf {
    let created = run(
        r,
        doc,
        "library_create",
        json!({ "kind": "furniture", "name": format!("{file} source") }),
    );
    let source = PathBuf::from(created["path"].as_str().unwrap());
    let obj = write_box_obj(root, "box.obj", [40.0, 40.0, 40.0]);
    run(
        r,
        doc,
        "furniture_import",
        json!({ "model_path": obj, "name": piece, "library": source }),
    );
    let target = out_dir(&format!("library-src-{file}")).join(file);
    std::fs::rename(&source, &target).unwrap();
    target
}

fn search(r: &Registry, doc: &mut Document, query: &str, kind: &str) -> Vec<Value> {
    run(
        r,
        doc,
        "catalog_search",
        json!({ "query": query, "kind": kind }),
    )["results"]
        .as_array()
        .unwrap()
        .clone()
}

fn listed(r: &Registry, doc: &mut Document, path: &str) -> Option<Value> {
    let list = lib_cmd(r, doc, "library_list", json!({}));
    list["libraries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["path"].as_str() == Some(path))
        .cloned()
}

#[test]
fn library_list_describes_user_libraries() {
    let Some(root) = isolated_catalog("library_list_describes_user_libraries") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let created = run(
        &r,
        &mut doc,
        "library_create",
        json!({ "kind": "furniture", "name": "Listed" }),
    );
    let path = created["path"].as_str().unwrap().to_owned();
    let obj = write_box_obj(&root, "box.obj", [20.0, 20.0, 20.0]);
    run(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "library": path }),
    );
    let entry = listed(&r, &mut doc, &path).expect("the new library is listed");
    assert_eq!(entry["name"], "Listed");
    assert_eq!(entry["kind"], "furniture");
    assert_eq!(entry["furniture"], json!(1));
    assert_eq!(entry["textures"], json!(0));
    assert_eq!(entry["user"], json!(true));
    assert_eq!(entry["editable"], json!(true));
    assert_eq!(entry["hidden"], json!(false));
}

#[test]
fn library_import_copies_into_the_user_folder() {
    let Some(root) = isolated_catalog("library_import_copies_into_the_user_folder") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let file = external_library(&r, &mut doc, &root, "Garden Zq7k.sh3f", "Bench Zq7k");
    assert!(search(&r, &mut doc, "bench zq7k", "furniture").is_empty());
    let result = lib_cmd(&r, &mut doc, "library_import", json!({ "path": file }));
    let target = root
        .join("eTeks")
        .join("Sweet Home 3D")
        .join("furniture")
        .join("Garden Zq7k.sh3f");
    assert_eq!(result["path"], json!(target));
    assert_eq!(result["user"], json!(true));
    assert_eq!(result["furniture"], json!(1));
    assert!(target.is_file());
    assert!(file.is_file(), "the original stays");
    assert_eq!(search(&r, &mut doc, "bench zq7k", "furniture").len(), 1);

    // A second import needs replace
    let err = run_err(&r, &mut doc, "library_import", json!({ "path": file }));
    assert!(err.contains("replace=true"), "{err}");
    lib_cmd(
        &r,
        &mut doc,
        "library_import",
        json!({ "path": file, "replace": true }),
    );
    // Undo takes back the replacing first, then the import
    let history = lib_cmd(&r, &mut doc, "library_history", json!({}));
    assert_eq!(history["undo"], "import");
    lib_cmd(&r, &mut doc, "library_undo", json!({}));
    assert!(target.is_file());
    lib_cmd(&r, &mut doc, "library_undo", json!({}));
    assert!(!target.exists());
    assert!(search(&r, &mut doc, "bench zq7k", "furniture").is_empty());
    lib_cmd(&r, &mut doc, "library_redo", json!({}));
    assert!(target.is_file());
    // The copy in the user folder cannot be imported onto itself
    let err = run_err(&r, &mut doc, "library_import", json!({ "path": target }));
    assert!(err.contains("already in the user folder"), "{err}");
}

#[test]
fn texture_libraries_go_to_the_texture_folder() {
    let Some(root) = isolated_catalog("texture_libraries_go_to_the_texture_folder") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let created = run(
        &r,
        &mut doc,
        "library_create",
        json!({ "kind": "textures", "name": "Stones" }),
    );
    let source = PathBuf::from(created["path"].as_str().unwrap());
    let png = root.join("Granite Zq7k.png");
    std::fs::write(&png, png_bytes(4, 4)).unwrap();
    run(
        &r,
        &mut doc,
        "texture_import",
        json!({ "path": png, "library": source }),
    );
    let file = out_dir("library-textures").join("Stones Zq7k.sh3t");
    std::fs::rename(&source, &file).unwrap();
    let result = lib_cmd(&r, &mut doc, "library_import", json!({ "path": file }));
    assert_eq!(result["kind"], "textures");
    assert!(
        Path::new(result["path"].as_str().unwrap())
            .parent()
            .unwrap()
            .ends_with("textures")
    );
    assert_eq!(search(&r, &mut doc, "granite zq7k", "textures").len(), 1);
}

#[test]
fn library_import_refuses_invalid_and_empty_libraries() {
    let Some(root) = isolated_catalog("library_import_refuses_invalid_and_empty_libraries") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let dir = out_dir("library-invalid");
    run_err(
        &r,
        &mut doc,
        "library_import",
        json!({ "path": dir.join("missing.sh3f") }),
    );
    let junk = dir.join("junk.sh3f");
    std::fs::write(&junk, "not a zip").unwrap();
    let err = run_err(&r, &mut doc, "library_import", json!({ "path": junk }));
    assert!(err.contains("not a valid library"), "{err}");
    // An empty library
    let created = run(
        &r,
        &mut doc,
        "library_create",
        json!({ "kind": "furniture", "name": "Empty" }),
    );
    let empty = dir.join("Empty.sh3f");
    std::fs::rename(created["path"].as_str().unwrap(), &empty).unwrap();
    let err = run_err(&r, &mut doc, "library_import", json!({ "path": empty }));
    assert!(err.contains("no items"), "{err}");
    let user = root.join("eTeks").join("Sweet Home 3D").join("furniture");
    assert!(!user.join("junk.sh3f").exists());
    assert!(!user.join("Empty.sh3f").exists());
}

#[test]
fn hidden_libraries_leave_the_catalog() {
    let Some(root) = isolated_catalog("hidden_libraries_leave_the_catalog") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let file = external_library(&r, &mut doc, &root, "Hidden Zq7k.sh3f", "Shelf Zq7k");
    let path = lib_cmd(&r, &mut doc, "library_import", json!({ "path": file }))["path"]
        .as_str()
        .unwrap()
        .to_owned();
    let hidden = lib_cmd(
        &r,
        &mut doc,
        "library_set_visible",
        json!({ "path": path, "visible": false }),
    );
    assert_eq!(hidden["hidden"], json!(true));
    assert!(search(&r, &mut doc, "shelf zq7k", "furniture").is_empty());
    assert_eq!(listed(&r, &mut doc, &path).unwrap()["hidden"], json!(true));
    // Stored in the catalog settings
    assert!(root.join("catalog.json").is_file());
    lib_cmd(
        &r,
        &mut doc,
        "library_set_visible",
        json!({ "path": path, "visible": true }),
    );
    assert_eq!(search(&r, &mut doc, "shelf zq7k", "furniture").len(), 1);
    let err = run_err(
        &r,
        &mut doc,
        "library_set_visible",
        json!({ "path": file, "visible": false }),
    );
    assert!(err.contains("unknown library"), "{err}");
}

#[test]
fn catalog_set_category_moves_and_restores_items() {
    let Some(root) = isolated_catalog("catalog_set_category_moves_and_restores_items") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let obj = write_box_obj(&root, "Stool Zq7k.obj", [30.0, 45.0, 30.0]);
    let id = run(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj }),
    )["catalog_id"]
        .clone();
    let moved = lib_cmd(
        &r,
        &mut doc,
        "catalog_set_category",
        json!({ "catalog_id": id, "category": "Seating" }),
    );
    assert_eq!(moved, json!({ "catalog_id": id, "category": "Seating" }));
    assert_eq!(
        search(&r, &mut doc, "stool zq7k", "furniture")[0]["category"],
        "Seating"
    );
    // An empty category restores the library's own
    let restored = lib_cmd(
        &r,
        &mut doc,
        "catalog_set_category",
        json!({ "catalog_id": id, "category": "" }),
    );
    assert_eq!(restored["category"], "My furniture");

    // Textures by kind
    let png = root.join("Felt Zq7k.png");
    std::fs::write(&png, png_bytes(2, 2)).unwrap();
    let tex = run(&r, &mut doc, "texture_import", json!({ "path": png }))["catalog_id"].clone();
    run_err(
        &r,
        &mut doc,
        "catalog_set_category",
        json!({ "catalog_id": tex, "category": "Fabrics" }),
    );
    let moved = lib_cmd(
        &r,
        &mut doc,
        "catalog_set_category",
        json!({ "catalog_id": tex, "kind": "textures", "category": "Fabrics" }),
    );
    assert_eq!(moved["category"], "Fabrics");
    let err = run_err(
        &r,
        &mut doc,
        "catalog_set_category",
        json!({ "catalog_id": "no#such", "category": "X" }),
    );
    assert!(err.contains("no catalog item"), "{err}");
}

#[test]
fn library_remove_moves_the_file_aside() {
    let Some(root) = isolated_catalog("library_remove_moves_the_file_aside") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let file = external_library(&r, &mut doc, &root, "Old Zq7k.sh3f", "Lamp Zq7k");
    let path = lib_cmd(&r, &mut doc, "library_import", json!({ "path": file }))["path"]
        .as_str()
        .unwrap()
        .to_owned();
    let removed = lib_cmd(&r, &mut doc, "library_remove", json!({ "path": path }));
    let moved_to = PathBuf::from(removed["moved_to"].as_str().unwrap());
    let removed_dir = root.join("eTeks").join("Sweet Home 3D").join("removed");
    assert_eq!(moved_to, removed_dir.join("Old Zq7k.sh3f"));
    assert!(moved_to.is_file());
    assert!(!Path::new(&path).exists());
    let left = search(&r, &mut doc, "lamp zq7k", "furniture");
    assert!(left.is_empty(), "{left:?}");
    // A second removal of the same name gets a numbered file
    lib_cmd(&r, &mut doc, "library_import", json!({ "path": file }));
    let again = lib_cmd(&r, &mut doc, "library_remove", json!({ "path": path }));
    assert_eq!(
        again["moved_to"],
        json!(removed_dir.join("Old Zq7k.sh3f.1"))
    );
    // Undo brings the library back (the file moved aside stays), redo removes it again
    assert_eq!(again["history"]["undo"], "remove library");
    lib_cmd(&r, &mut doc, "library_undo", json!({}));
    assert!(Path::new(&path).is_file());
    assert_eq!(search(&r, &mut doc, "lamp zq7k", "furniture").len(), 1);
    lib_cmd(&r, &mut doc, "library_redo", json!({}));
    assert!(!Path::new(&path).exists());
    assert!(removed_dir.join("Old Zq7k.sh3f.1").is_file());
    // Only libraries of the user folder can be removed
    let err = run_err(&r, &mut doc, "library_remove", json!({ "path": file }));
    assert!(err.contains("only libraries"), "{err}");
    assert!(file.is_file());
}
