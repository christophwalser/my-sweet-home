//! Library editing commands in a temporary user library folder.

use msh_core::{Document, Registry};
use serde_json::{Value, json};

fn run(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    r.execute(doc, name, params)
        .unwrap_or_else(|e| panic!("{name} failed: {e}"))
}

/// The commands work on the user's library folder (from APPDATA): the test runs itself again
/// as a child process with APPDATA pointing at a temporary folder.
#[test]
fn libraries_are_created_edited_and_undone() {
    if std::env::var_os("MSH_LIBTEST_CHILD").is_none() {
        let root = std::env::temp_dir().join(format!("msh-libcmd-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "libraries_are_created_edited_and_undone",
                "--nocapture",
            ])
            .env("MSH_LIBTEST_CHILD", "1")
            .env("APPDATA", &root)
            .env("MSH_CATALOG_SETTINGS", root.join("catalog.json"))
            .status()
            .unwrap();
        std::fs::remove_dir_all(&root).ok();
        assert!(
            status.success(),
            "the library test failed (see its output above)"
        );
        return;
    }
    let root = std::path::PathBuf::from(std::env::var_os("APPDATA").unwrap());
    let r = Registry::standard();
    let mut doc = Document::default();

    // A model to import
    let obj = root.join("box.obj");
    std::fs::write(
        &obj,
        "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv 0 0 1\nv 1 0 1\nv 1 1 1\nv 0 1 1\n\
         f 1 2 3 4\nf 5 6 7 8\nf 1 2 6 5\nf 4 3 7 8\n",
    )
    .unwrap();

    let lib = run(
        &r,
        &mut doc,
        "library_create",
        json!({ "kind": "furniture", "name": "Shop" }),
    );
    let path = lib["path"].as_str().unwrap().to_owned();
    assert!(path.ends_with("Shop.sh3f"));

    let added = run(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "name": "Box", "category": "Boxes", "width": 50, "library": path }),
    );
    assert_eq!(added["library"].as_str(), Some(path.as_str()));
    let items = run(&r, &mut doc, "library_items", json!({ "path": path }));
    let index = items["items"][0]["index"].as_u64().unwrap();
    assert_eq!(items["items"][0]["name"], "Box");

    // Change, move, duplicate
    let changed = run(
        &r,
        &mut doc,
        "library_update_item",
        json!({ "path": path, "index": index, "set": { "name": "Crate", "price": "12.5", "doorOrWindow": "true" } }),
    );
    assert_eq!(changed["name"], "Crate");
    assert_eq!(changed["values"]["price"], "12.5");
    run(
        &r,
        &mut doc,
        "library_add_category",
        json!({ "path": path, "name": "Storage" }),
    );
    let cats = run(&r, &mut doc, "library_categories", json!({ "path": path }));
    assert_eq!(cats["categories"], json!(["Boxes", "Storage"]));
    run(
        &r,
        &mut doc,
        "library_move_items",
        json!({ "path": path, "indexes": [index], "category": "Storage" }),
    );
    let copy = run(
        &r,
        &mut doc,
        "library_copy_items",
        json!({ "from": path, "indexes": [index], "to": path, "name": "Crate (copy)" }),
    );
    let copy_index = copy["indexes"][0].as_u64().unwrap();
    let item = run(
        &r,
        &mut doc,
        "library_item",
        json!({ "path": path, "index": copy_index }),
    );
    assert_eq!(item["name"], "Crate (copy)");
    assert_eq!(item["category"], "Storage");
    assert_ne!(item["id"], changed["id"]);

    // Search over all libraries, rename the library
    let found = run(&r, &mut doc, "library_items", json!({ "query": "crate" }));
    assert_eq!(found["items"].as_array().unwrap().len(), 2);
    run(
        &r,
        &mut doc,
        "library_rename",
        json!({ "path": path, "name": "My shop" }),
    );
    let list = run(&r, &mut doc, "library_list", json!({}));
    let entry = list["libraries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["path"].as_str() == Some(path.as_str()))
        .unwrap();
    assert_eq!(entry["name"], "My shop");
    assert_eq!(entry["editable"], true);

    // Remove and undo it
    run(
        &r,
        &mut doc,
        "library_remove_items",
        json!({ "path": path, "indexes": [copy_index] }),
    );
    let after = run(&r, &mut doc, "library_items", json!({ "path": path }));
    assert_eq!(after["items"].as_array().unwrap().len(), 1);
    let undone = run(&r, &mut doc, "library_undo", json!({}));
    assert_eq!(undone["undone"], "remove items");
    let back = run(&r, &mut doc, "library_items", json!({ "path": path }));
    assert_eq!(back["items"].as_array().unwrap().len(), 2);

    // Invalid changes are refused
    assert!(
        r.execute(
            &mut doc,
            "library_update_item",
            json!({ "path": path, "index": index, "set": { "model": "/x.obj" } })
        )
        .is_err()
    );
    assert!(
        r.execute(
            &mut doc,
            "library_update_item",
            json!({ "path": path, "index": index, "set": { "name": "" } })
        )
        .is_err()
    );
}
