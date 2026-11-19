//! `furniture_import` and `texture_import` into user libraries. Every test runs in a child
//! process with its own temporary user library folder (`common::isolated_catalog`).

mod common;

use base64::Engine;
use common::{
    isolated_catalog, new_doc, out_dir, png_bytes, run, run_err, snapshot, write_box_obj,
};
use msh_core::{Document, Registry};
use serde_json::{Value, json};
use std::path::Path;

/// Runs an import and checks that the home and its undo stack stay untouched.
fn import(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    let before = snapshot(doc);
    let could_undo = doc.can_undo();
    let result = run(r, doc, name, params);
    assert_eq!(snapshot(doc), before, "{name} changed the home");
    assert_eq!(doc.can_undo(), could_undo, "{name} created an undo step");
    result
}

/// The catalog search result of an imported item.
fn search_one(r: &Registry, doc: &mut Document, query: &str, kind: &str) -> Value {
    let found = run(
        r,
        doc,
        "catalog_search",
        json!({ "query": query, "kind": kind }),
    );
    let results = found["results"].as_array().unwrap();
    assert_eq!(results.len(), 1, "{found}");
    results[0].clone()
}

/// Keys of the first item of a library.
fn first_item(r: &Registry, doc: &mut Document, library: &str) -> Value {
    let items = run(r, doc, "library_items", json!({ "path": library }));
    let index = items["items"][0]["index"].clone();
    run(
        r,
        doc,
        "library_item",
        json!({ "path": library, "index": index }),
    )["values"]
        .clone()
}

fn assert_size(v: &Value, w: f64, d: f64, h: f64) {
    let get = |k: &str| v[k].as_f64().unwrap_or_else(|| panic!("no {k} in {v}"));
    assert_eq!(
        (get("width"), get("depth"), get("height")),
        (w, d, h),
        "{v}"
    );
}

#[test]
fn furniture_import_takes_the_size_from_the_model() {
    let Some(root) = isolated_catalog("furniture_import_takes_the_size_from_the_model") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    // OBJ: x = width, y = height, z = depth
    let obj = write_box_obj(&root, "Crate Kiel.obj", [80.0, 50.0, 40.0]);
    let added = import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj }),
    );
    assert_size(&added, 80.0, 40.0, 50.0);
    assert!(
        added["library"]
            .as_str()
            .unwrap()
            .ends_with("My furniture.sh3f")
    );
    assert!(Path::new(added["library"].as_str().unwrap()).starts_with(&root));
    // The name comes from the file, the category is the default one
    let found = search_one(&r, &mut doc, "crate kiel", "furniture");
    assert_eq!(found["catalog_id"], added["catalog_id"]);
    assert_eq!(found["name"], "Crate Kiel");
    assert_eq!(found["category"], "My furniture");
    assert_size(&found, 80.0, 40.0, 50.0);
}

#[test]
fn given_sizes_scale_or_replace_the_model_size() {
    let Some(root) = isolated_catalog("given_sizes_scale_or_replace_the_model_size") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let obj = write_box_obj(&root, "box.obj", [80.0, 50.0, 40.0]);
    // One value scales the others proportionally
    let scaled = import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "height": 100 }),
    );
    assert_size(&scaled, 160.0, 80.0, 100.0);
    // All three are taken as they are
    let exact = import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "width": 10, "depth": 20, "height": 30 }),
    );
    assert_size(&exact, 10.0, 20.0, 30.0);
    // Small models are taken as meters
    let meters = write_box_obj(&root, "small.obj", [1.2, 0.75, 0.6]);
    let added = import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": meters }),
    );
    assert_size(&added, 120.0, 60.0, 75.0);
}

#[test]
fn model_rotation_turns_the_size_and_is_stored() {
    let Some(root) = isolated_catalog("model_rotation_turns_the_size_and_is_stored") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    // A model with z up: 80 wide, 40 deep (y), 50 high (z)
    let obj = write_box_obj(&root, "zup.obj", [80.0, 40.0, 50.0]);
    let added = import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "model_rotation": [1, 0, 0, 0, 0, 1, 0, -1, 0] }),
    );
    assert_size(&added, 80.0, 40.0, 50.0);
    let values = first_item(&r, &mut doc, added["library"].as_str().unwrap());
    assert_eq!(values["modelRotation"], "1 0 0 0 0 1 0 -1 0");
}

#[test]
fn import_options_are_stored_in_the_library() {
    let Some(root) = isolated_catalog("import_options_are_stored_in_the_library") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let obj = write_box_obj(&root, "stairs.obj", [100.0, 250.0, 300.0]);
    let icon = base64::engine::general_purpose::STANDARD.encode(png_bytes(16, 16));
    let added = import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "name": "Stairs Oslo", "category": "Stairs",
                "creator": "Test", "elevation": 5, "movable": false, "staircase": true,
                "icon_png_base64": format!("data:image/png;base64,{icon}") }),
    );
    let values = first_item(&r, &mut doc, added["library"].as_str().unwrap());
    assert_eq!(values["name"], "Stairs Oslo");
    assert_eq!(values["category"], "Stairs");
    assert_eq!(values["creator"], "Test");
    assert_eq!(values["elevation"], "5");
    assert_eq!(values["movable"], "false");
    assert_eq!(values["doorOrWindow"], "false");
    assert_eq!(values["staircaseCutOutShape"], "M0,0 v1 h1 v-1 z");
    // A door with an own cut-out shape for a staircase is kept as given
    let door = import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "name": "Gate Zx9", "door_or_window": true,
                "staircase_cut_out_shape": "M0,0 L1,0 L1,1 Z" }),
    );
    let found = search_one(&r, &mut doc, "gate zx9", "furniture");
    assert_eq!(found["catalog_id"], door["catalog_id"]);
    assert_eq!(found["door_or_window"], json!(true));
}

#[test]
fn obj_materials_and_textures_are_imported_with_the_model() {
    let Some(root) = isolated_catalog("obj_materials_and_textures_are_imported_with_the_model")
    else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let obj = write_box_obj(&root, "chair.obj", [50.0, 90.0, 50.0]);
    let text = std::fs::read_to_string(&obj).unwrap();
    std::fs::write(&obj, format!("mtllib chair.mtl\nusemtl wood\n{text}")).unwrap();
    std::fs::write(
        root.join("chair.mtl"),
        "newmtl wood\nKd 0.8 0.6 0.4\nmap_Kd wood.png\n",
    )
    .unwrap();
    std::fs::write(root.join("wood.png"), png_bytes(4, 4)).unwrap();
    let added = import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj }),
    );
    let values = first_item(&r, &mut doc, added["library"].as_str().unwrap());
    assert_eq!(values["multiPartModel"], "true");
    // Placing it embeds all three files in the home
    run(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": added["catalog_id"], "x": 0, "y": 0 }),
    );
    for name in ["chair.obj", "chair.mtl", "wood.png"] {
        assert!(
            doc.file.contents.iter().any(|c| c.name.ends_with(name)),
            "{name} is embedded"
        );
    }
}

#[test]
fn furniture_import_refuses_unusable_models() {
    let Some(root) = isolated_catalog("furniture_import_refuses_unusable_models") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let missing = root.join("missing.obj");
    run_err(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": missing }),
    );
    let txt = root.join("model.txt");
    std::fs::write(&txt, "v 0 0 0").unwrap();
    run_err(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": txt }),
    );
    // A DAE model has no size of its own
    let dae = root.join("model.dae");
    std::fs::write(&dae, "<COLLADA></COLLADA>").unwrap();
    let err = run_err(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": dae }),
    );
    assert!(err.contains("give width, depth and height"), "{err}");
    // Flat and empty models
    let flat = write_box_obj(&root, "flat.obj", [100.0, 0.0, 50.0]);
    let err = run_err(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": flat }),
    );
    assert!(err.contains("no extent"), "{err}");
    let empty = root.join("empty.obj");
    std::fs::write(&empty, "# nothing\n").unwrap();
    run_err(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": empty }),
    );
    // A broken icon
    let obj = write_box_obj(&root, "box.obj", [10.0, 10.0, 10.0]);
    let err = run_err(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "icon_png_base64": "***" }),
    );
    assert!(err.contains("invalid icon"), "{err}");
    // Nothing was written to the user's library
    let default = root
        .join("eTeks")
        .join("Sweet Home 3D")
        .join("furniture")
        .join("My furniture.sh3f");
    assert!(!default.exists());
}

#[test]
fn imports_go_only_to_editable_libraries_of_their_kind() {
    let Some(root) = isolated_catalog("imports_go_only_to_editable_libraries_of_their_kind") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let obj = write_box_obj(&root, "box.obj", [10.0, 10.0, 10.0]);
    let png = root.join("tile.png");
    std::fs::write(&png, png_bytes(4, 4)).unwrap();
    // Outside the user's library folders
    let elsewhere = out_dir("import-elsewhere").join("Shop.sh3f");
    let err = run_err(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "library": elsewhere }),
    );
    assert!(err.contains("cannot be changed"), "{err}");
    assert!(!elsewhere.exists());
    // An own library of the other kind
    let textures = run(
        &r,
        &mut doc,
        "library_create",
        json!({ "kind": "textures", "name": "Tiles" }),
    )["path"]
        .clone();
    run_err(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "library": textures }),
    );
    let furniture = run(
        &r,
        &mut doc,
        "library_create",
        json!({ "kind": "furniture", "name": "Boxes" }),
    )["path"]
        .clone();
    run_err(
        &r,
        &mut doc,
        "texture_import",
        json!({ "path": png, "library": furniture }),
    );
    // The right kind works
    let added = import(
        &r,
        &mut doc,
        "texture_import",
        json!({ "path": png, "library": textures }),
    );
    assert_eq!(added["library"], textures);
}

#[test]
fn texture_import_adds_a_tile_to_my_textures() {
    let Some(root) = isolated_catalog("texture_import_adds_a_tile_to_my_textures") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let png = root.join("Oak planks.png");
    std::fs::write(&png, png_bytes(8, 8)).unwrap();
    let added = import(
        &r,
        &mut doc,
        "texture_import",
        json!({ "path": png, "width": 60 }),
    );
    assert!(
        added["library"]
            .as_str()
            .unwrap()
            .ends_with("My textures.sh3t")
    );
    let found = search_one(&r, &mut doc, "oak planks", "textures");
    assert_eq!(found["catalog_id"], added["catalog_id"]);
    assert_eq!(found["category"], "My textures");
    // The height follows the width
    assert_eq!(
        (found["width"].as_f64(), found["height"].as_f64()),
        (Some(60.0), Some(60.0))
    );

    let named = import(
        &r,
        &mut doc,
        "texture_import",
        json!({ "path": png, "name": "Tiles", "category": "Floors", "creator": "Me",
                "width": 30, "height": 15 }),
    );
    let found = search_one(&r, &mut doc, "tiles floors", "textures");
    assert_eq!(found["catalog_id"], named["catalog_id"]);
    assert_eq!(
        (found["width"].as_f64(), found["height"].as_f64()),
        (Some(30.0), Some(15.0))
    );
}

#[test]
fn texture_import_refuses_bad_files_and_sizes() {
    let Some(root) = isolated_catalog("texture_import_refuses_bad_files_and_sizes") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run_err(
        &r,
        &mut doc,
        "texture_import",
        json!({ "path": root.join("missing.png") }),
    );
    let txt = root.join("notes.txt");
    std::fs::write(&txt, "hello").unwrap();
    run_err(&r, &mut doc, "texture_import", json!({ "path": txt }));
    let png = root.join("tile.png");
    std::fs::write(&png, png_bytes(2, 2)).unwrap();
    for size in [json!({ "width": 0 }), json!({ "width": 50, "height": -1 })] {
        let mut params = json!({ "path": png });
        params
            .as_object_mut()
            .unwrap()
            .extend(size.as_object().unwrap().clone());
        let err = run_err(&r, &mut doc, "texture_import", params);
        assert!(err.contains("positive"), "{err}");
    }
    let default = root
        .join("eTeks")
        .join("Sweet Home 3D")
        .join("textures")
        .join("My textures.sh3t");
    assert!(!default.exists());
}

#[test]
fn imports_can_be_undone_in_the_library_history() {
    let Some(root) = isolated_catalog("imports_can_be_undone_in_the_library_history") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let obj = write_box_obj(&root, "Lamp Bergen.obj", [30.0, 60.0, 30.0]);
    import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj }),
    );
    assert_eq!(
        run(&r, &mut doc, "library_history", json!({}))["undo"],
        "import"
    );
    run(&r, &mut doc, "library_undo", json!({}));
    let found = run(
        &r,
        &mut doc,
        "catalog_search",
        json!({ "query": "lamp bergen" }),
    );
    assert!(found["results"].as_array().unwrap().is_empty());
    run(&r, &mut doc, "library_redo", json!({}));
    search_one(&r, &mut doc, "lamp bergen", "furniture");
}

#[test]
fn furniture_import_takes_a_unit_and_tells_where_the_zero_point_lies() {
    let Some(root) =
        isolated_catalog("furniture_import_takes_a_unit_and_tells_where_the_zero_point_lies")
    else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    // A box from the zero point of its file: 80 wide (x), 50 high (y), 40 deep (z)
    let obj = write_box_obj(&root, "box.obj", [80.0, 50.0, 40.0]);
    let origin = |v: &Value| {
        let o = &v["origin"];
        (
            o["x"].as_f64().unwrap(),
            o["y"].as_f64().unwrap(),
            o["elevation"].as_f64().unwrap(),
        )
    };
    let plain = import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj }),
    );
    // The middle of the box: with it there, the corner of the box lies on the zero point
    assert_eq!(origin(&plain), (40.0, 20.0, 0.0));
    let meters = import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "unit": "m" }),
    );
    assert_size(&meters, 8000.0, 4000.0, 5000.0);
    assert_eq!(origin(&meters), (4000.0, 2000.0, 0.0));
    let millimeters = import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "unit": "mm" }),
    );
    assert_size(&millimeters, 8.0, 4.0, 5.0);
    // Twice as large: the zero point stays at the corner
    let doubled = import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "width": 160 }),
    );
    assert_eq!(origin(&doubled), (80.0, 40.0, 0.0));
    // A model with z up, turned upright: its depth axis points to the back of the plan
    let turned = import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "model_rotation": [1, 0, 0, 0, 0, 1, 0, -1, 0] }),
    );
    assert_size(&turned, 80.0, 50.0, 40.0);
    assert_eq!(origin(&turned), (40.0, -25.0, 0.0));
    let e = run_err(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": obj, "unit": "yard" }),
    );
    assert!(e.contains("unknown unit"), "{e}");
}

#[test]
fn terrain_heights_are_imported_as_a_mesh() {
    let Some(root) = isolated_catalog("terrain_heights_are_imported_as_a_mesh") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    // 5 x 4 nodes, 5 m apart, in national coordinates, rising to the north
    let mut asc =
        String::from("ncols 5\nnrows 4\nxllcenter 2600000\nyllcenter 1200000\ncellsize 5\n");
    for row in 0..4 {
        asc.push_str(&format!("{0} {0} {0} {0} {0}\n", 450 - row));
    }
    let path = root.join("Slope Zermatt.asc");
    std::fs::write(&path, asc).unwrap();
    let added = import(
        &r,
        &mut doc,
        "furniture_import",
        json!({ "model_path": path }),
    );
    // 20 m wide, 15 m deep, 3 m high
    assert_size(&added, 2000.0, 1500.0, 300.0);
    // The middle of the grid in cm: east, −north (the plan's y points south), lowest height
    assert_eq!(added["origin"]["x"], json!(260_001_000.0));
    assert_eq!(added["origin"]["y"], json!(-120_000_750.0));
    assert_eq!(added["origin"]["elevation"], json!(44_700.0));
    let found = search_one(&r, &mut doc, "slope zermatt", "furniture");
    assert_eq!(found["name"], "Slope Zermatt");
}
