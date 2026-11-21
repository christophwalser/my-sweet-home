//! Roof commands: roof_add, roof_update and what furniture_update does with a roof.

mod common;

use common::{check_undo_redo, close, new_doc, run, run_err, save_and_reopen, snapshot};
use msh_core::{Document, Registry};
use msh_model::Piece;
use serde_json::{Value, json};

const ROOF_PROPERTY: &str = "mySweetHome.roof";

fn piece(doc: &Document, id: &str) -> Piece {
    let mut found = None;
    doc.home().for_each_piece(|p| {
        if p.attrs.id.as_deref() == Some(id) {
            found = Some(p.clone());
        }
    });
    found.unwrap_or_else(|| panic!("no piece {id}"))
}

/// What the roof was made from, as stored in its property.
fn data(doc: &Document, id: &str) -> Value {
    let p = piece(doc, id);
    let value = &p
        .properties
        .iter()
        .find(|pr| pr.name == ROOF_PROPERTY)
        .expect("the piece has no roof property")
        .value;
    serde_json::from_str(value).unwrap()
}

/// Text of the model file of a piece.
fn model_text(doc: &Document, id: &str) -> String {
    let model = piece(doc, id).attrs.model.expect("the piece has no model");
    let entry = doc
        .file
        .contents
        .iter()
        .find(|c| c.name == model)
        .unwrap_or_else(|| panic!("the home has no resource {model}"));
    String::from_utf8(entry.data.clone()).unwrap()
}

fn lines_of(doc: &Document, id: &str, kind: &str) -> Vec<[f64; 4]> {
    data(doc, id)["lines"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|l| l[4] == kind)
        .map(|l| [0, 1, 2, 3].map(|i| l[i].as_f64().unwrap()))
        .collect()
}

/// A gable roof over 1000 × 800 cm with its corner at (100, 100).
fn add_gable(r: &Registry, doc: &mut Document) -> String {
    let added = run(
        r,
        doc,
        "roof_add",
        json!({
            "points": [[100, 100], [1100, 100], [1100, 900], [100, 900]],
            "pitch": 45, "overhang": 50, "thickness": 20,
        }),
    );
    added["id"].as_str().unwrap().to_owned()
}

/// Thickness of a 20 cm roof at 45°, measured straight down.
const DROP_45: f32 = 28.28;

#[test]
fn roof_add_makes_a_gable_roof_over_the_given_corners() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let id = add_gable(&r, &mut doc);
    let after = snapshot(&doc);

    let p = piece(&doc, &id);
    let a = &p.attrs;
    assert_eq!(a.name, "Roof");
    assert!(close(a.x, 600.0) && close(a.y, 500.0));
    assert!(a.angle.is_none());
    // The covered area and 50 cm overhang on every side
    assert!(close(a.width, 1100.0) && close(a.depth, 900.0));
    // 400 cm up to the ridge, 50 cm down to the eave, and the thickness
    assert!(close(a.height, 450.0 + DROP_45), "height {}", a.height);
    // The top of the walls of a new home is at 250 cm
    assert!(close(a.elevation.unwrap(), 250.0 - 50.0 - DROP_45));

    let made = data(&doc, &id);
    assert_eq!(made["shape"], "gable");
    assert_eq!(made["edges"], json!(["eave", "gable", "eave", "gable"]));
    assert_eq!(made["outline"][0], json!([-500.0, -400.0]));
    // The ridge runs along the width, in the middle
    assert_eq!(lines_of(&doc, &id, "ridge"), [[550.0, 0.0, -550.0, 0.0]]);
    assert_eq!(lines_of(&doc, &id, "eave").len(), 2);

    let model = model_text(&doc, &id);
    for part in [
        "usemtl roof_cover",
        "usemtl roof_soffit",
        "usemtl roof_gable",
        "vn ",
    ] {
        assert!(model.contains(part), "the model has no '{part}'");
    }
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn roof_add_covers_the_walls_of_the_level() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "wall_add_path",
        json!({
            "points": [[0, 0], [1000, 0], [1000, 600], [0, 600]],
            "closed": true, "thickness": 30, "height": 270,
        }),
    );
    let added = run(
        &r,
        &mut doc,
        "roof_add",
        json!({ "shape": "hip", "pitch": 30 }),
    );
    let id = added["id"].as_str().unwrap();
    let a = piece(&doc, id).attrs;
    // The outer face of the walls (15 cm beyond their axis) and 40 cm overhang
    assert!(close(a.x, 500.0) && close(a.y, 300.0));
    assert!(
        close(a.width, 1110.0) && close(a.depth, 710.0),
        "{} x {}",
        a.width,
        a.depth
    );
    // The roof starts at the top of the walls
    let ridge = added["ridge_height"].as_f64().unwrap();
    assert!(
        (ridge - (270.0 + 315.0 * 30f64.to_radians().tan())).abs() < 0.02,
        "ridge {ridge}"
    );
    assert_eq!(lines_of(&doc, id, "hip").len(), 4);
    assert!(!model_text(&doc, id).contains("roof_gable"));

    // Without walls the corners must be given
    let mut empty = new_doc(&r);
    let err = run_err(&r, &mut empty, "roof_add", json!({}));
    assert!(err.contains("no walls"), "{err}");
}

#[test]
fn an_l_shaped_house_gets_a_roof_for_each_of_its_rectangles() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let added = run(
        &r,
        &mut doc,
        "roof_add",
        json!({
            "points": [[0, 0], [1000, 0], [1000, 400], [400, 400], [400, 900], [0, 900]],
            "shape": "hip", "overhang": 0,
        }),
    );
    let ids: Vec<String> = serde_json::from_value(added["ids"].clone()).unwrap();
    assert_eq!(ids.len(), 2);
    let mut sizes: Vec<(f32, f32)> = ids
        .iter()
        .map(|id| {
            let a = piece(&doc, id).attrs;
            (a.width.round(), a.depth.round())
        })
        .collect();
    sizes.sort_by(|a, b| a.partial_cmp(b).unwrap());
    assert_eq!(sizes, [(400.0, 900.0), (1000.0, 400.0)]);

    // Corners that point inwards between slanted edges cannot be split
    let err = run_err(
        &r,
        &mut doc,
        "roof_add",
        json!({ "points": [[0, 0], [1000, 0], [500, 300], [800, 900]] }),
    );
    assert!(err.contains("point inwards"), "{err}");
}

#[test]
fn a_roof_over_a_turned_rectangle_is_a_turned_piece() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    // 1000 × 600 cm, turned by 30° around (0, 0)
    let (sin, cos) = 30f64.to_radians().sin_cos();
    let corner = |x: f64, y: f64| json!([x * cos - y * sin, x * sin + y * cos]);
    let added = run(
        &r,
        &mut doc,
        "roof_add",
        json!({
            "points": [corner(0., 0.), corner(1000., 0.), corner(1000., 600.), corner(0., 600.)],
            "overhang": 0,
        }),
    );
    let a = piece(&doc, added["id"].as_str().unwrap()).attrs;
    assert!(close(a.angle.unwrap().to_degrees(), 30.0));
    assert!(close(a.width, 1000.0) && close(a.depth, 600.0));
    assert!(close(a.x, (500.0 * cos - 300.0 * sin) as f32));
    assert!(close(a.y, (500.0 * sin + 300.0 * cos) as f32));
}

#[test]
fn roof_update_makes_the_roof_again() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_gable(&r, &mut doc);
    let before = snapshot(&doc);

    // A lower pitch: the ridge comes down, the roof still starts at the top of the walls
    let updated = run(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": id, "pitch": 30 }),
    );
    let after = snapshot(&doc);
    let tan = 30f32.to_radians().tan();
    let drop = 20.0 / 30f32.to_radians().cos();
    let a = piece(&doc, &id).attrs;
    assert!(close(a.height, 450.0 * tan + drop), "height {}", a.height);
    assert!(close(a.elevation.unwrap(), 250.0 - 50.0 * tan - drop));
    assert!(close(
        updated["ridge_height"].as_f64().unwrap() as f32,
        250.0 + 400.0 * tan
    ));
    assert!(close(a.x, 600.0) && close(a.y, 500.0));
    check_undo_redo(&r, &mut doc, &before, &after);

    // Turned: the ridge runs along the depth
    run(&r, &mut doc, "roof_update", json!({ "id": id, "turn": 1 }));
    assert_eq!(
        data(&doc, &id)["edges"],
        json!(["gable", "eave", "gable", "eave"])
    );
    assert_eq!(lines_of(&doc, &id, "ridge"), [[0.0, 450.0, 0.0, -450.0]]);

    // A hip roof has no gables, a flat roof lies on the walls
    run(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": id, "shape": "hip" }),
    );
    assert!(!model_text(&doc, &id).contains("roof_gable"));
    run(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": id, "shape": "flat" }),
    );
    let a = piece(&doc, &id).attrs;
    assert!(close(a.height, 20.0) && close(a.elevation.unwrap(), 250.0));
    // The pitch comes back with a sloped shape
    run(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": id, "shape": "shed" }),
    );
    assert_eq!(data(&doc, &id)["pitch"], 30.0);
    assert_eq!(lines_of(&doc, &id, "eave").len(), 1);

    // The edges one by one: three eaves and one gable
    run(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": id, "edges": ["eave", "eave", "eave", "gable"] }),
    );
    assert_eq!(data(&doc, &id)["shape"], "custom");
    assert_eq!(lines_of(&doc, &id, "verge").len(), 2);

    // The area, the height it starts at and the colors
    run(
        &r,
        &mut doc,
        "roof_update",
        json!({
            "id": id, "shape": "gable", "turn": 0, "width": 600, "depth": 500, "base": 300,
            "overhang": 0, "color": "#336699", "gable_color": "#FFFFFF",
        }),
    );
    let a = piece(&doc, &id).attrs;
    assert!(close(a.width, 600.0) && close(a.depth, 500.0));
    assert!(close(a.elevation.unwrap(), 300.0 - drop));
    assert!(close(a.x, 600.0) && close(a.y, 500.0));
    let mtl_name = a.model.unwrap().replace("roof.obj", "roof.mtl");
    let mtl = doc
        .file
        .contents
        .iter()
        .find(|c| c.name == mtl_name)
        .unwrap();
    let mtl = String::from_utf8(mtl.data.clone()).unwrap();
    assert!(mtl.contains("Kd 0.2 0.4 0.6"), "{mtl}");

    // New corners move the roof
    run(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": id, "points": [[0, 0], [400, 0], [400, 300], [0, 300]] }),
    );
    let a = piece(&doc, &id).attrs;
    assert!(close(a.x, 200.0) && close(a.y, 150.0));
    assert!(close(a.width, 400.0) && close(a.depth, 300.0));
}

#[test]
fn resizing_the_piece_keeps_the_pitch() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_gable(&r, &mut doc);
    let elevation = piece(&doc, &id).attrs.elevation.unwrap();

    // 200 cm deeper: the ridge rises by 100 cm at 45°; a given height is not kept
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": id, "depth": 1100, "height": 50 }),
    );
    let a = piece(&doc, &id).attrs;
    assert!(close(a.width, 1100.0) && close(a.depth, 1100.0));
    assert!(close(a.height, 550.0 + DROP_45), "height {}", a.height);
    assert!(close(a.elevation.unwrap(), elevation));
    assert_eq!(data(&doc, &id)["outline"][2], json!([500.0, 500.0]));

    // Moving, turning and lifting leave the model alone
    let model = piece(&doc, &id).attrs.model;
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": id, "x": 0, "y": 0, "angle_deg": 90, "elevation": 300 }),
    );
    let a = piece(&doc, &id).attrs;
    assert_eq!(a.model, model);
    assert!(close(a.elevation.unwrap(), 300.0));
    // The lifted roof keeps its height when it is made again
    run(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": id, "thickness": 20 }),
    );
    let a = piece(&doc, &id).attrs;
    assert!(close(a.elevation.unwrap(), 300.0));
    assert!(close(a.angle.unwrap().to_degrees(), 90.0));
}

#[test]
fn a_roof_survives_saving_and_undo_after_saving() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_gable(&r, &mut doc);
    let first_model = model_text(&doc, &id);
    run(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": id, "pitch": 20 }),
    );

    let mut reopened = save_and_reopen(&r, &mut doc, "roof_saved");
    assert_eq!(data(&reopened, &id)["pitch"], 20.0);
    assert!(model_text(&reopened, &id).contains("usemtl roof_cover"));
    // The file holds the model of the roof once: the first one is gone
    let models = reopened
        .file
        .contents
        .iter()
        .filter(|c| c.name.ends_with("roof.obj"))
        .count();
    assert_eq!(models, 1);
    run(
        &r,
        &mut reopened,
        "roof_update",
        json!({ "id": id, "shape": "hip" }),
    );
    assert_eq!(lines_of(&reopened, &id, "hip").len(), 4);

    // Undo after saving finds the model of the step before again
    run(&r, &mut doc, "edit_undo", json!({}));
    assert_eq!(model_text(&doc, &id), first_model);
}

#[test]
fn roof_commands_refuse_what_they_cannot_do() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_gable(&r, &mut doc);

    let err = run_err(&r, &mut doc, "roof_update", json!({ "id": "nothing" }));
    assert!(err.contains("unknown piece"), "{err}");
    let err = run_err(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": id, "edges": ["eave", "gable"] }),
    );
    assert!(err.contains("one entry for each corner"), "{err}");
    let err = run_err(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": id, "color": "red" }),
    );
    assert!(err.contains("invalid color"), "{err}");
    let err = run_err(
        &r,
        &mut doc,
        "roof_add",
        json!({ "points": [[0, 0], [100, 0]] }),
    );
    assert!(err.contains("three corners"), "{err}");
    let err = run_err(
        &r,
        &mut doc,
        "roof_add",
        json!({
            "points": [[0, 0], [1000, 0], [1000, 400], [400, 400], [400, 900], [0, 900]],
            "edges": ["eave", "eave", "eave", "eave", "eave", "eave"],
        }),
    );
    assert!(err.contains("edges can only be given"), "{err}");

    // A piece that is not a roof
    let other = msh_model::Piece {
        attrs: msh_model::PieceAttrs {
            id: Some("table".into()),
            name: "Table".into(),
            width: 100.0,
            depth: 60.0,
            height: 75.0,
            ..Default::default()
        },
        ..Default::default()
    };
    doc.home_mut()
        .furniture
        .push(msh_model::Furniture::Piece(Box::new(other)));
    let err = run_err(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": "table", "pitch": 10 }),
    );
    assert!(err.contains("not a roof"), "{err}");
}

#[test]
fn exported_plans_show_a_roof_as_its_lines() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    add_gable(&r, &mut doc);
    let path = common::out_dir("roof_export").join("plan.svg");
    run(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": path, "furniture_icons": "catalog" }),
    );
    let svg = std::fs::read_to_string(&path).unwrap();
    // Two eaves, four verges and the ridge, and no picture of the roof from above
    assert_eq!(svg.matches(r##"stroke="#b45309""##).count(), 7);
    assert_eq!(svg.matches("stroke-dasharray").count(), 6);
    assert!(!svg.contains("<image"), "the roof is drawn as a picture");
}

#[test]
fn a_roof_takes_textures_for_its_covering_and_its_gable_walls() {
    let Some(root) =
        common::isolated_catalog("a_roof_takes_textures_for_its_covering_and_its_gable_walls")
    else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let import = |doc: &mut Document, name: &str, width: f32, height: f32| {
        let png = root.join(format!("{name}.png"));
        std::fs::write(&png, common::png_bytes(8, 8)).unwrap();
        run(
            &r,
            doc,
            "texture_import",
            json!({ "path": png, "width": width, "height": height }),
        )["catalog_id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let tiles = import(&mut doc, "Roof tiles Zq9", 50.0, 25.0);
    let plaster = import(&mut doc, "Gable plaster Zq9", 200.0, 200.0);
    let id = add_gable(&r, &mut doc);
    /// Files of the model of the roof, by their name in its folder.
    fn files(doc: &Document, id: &str) -> std::collections::BTreeMap<String, Vec<u8>> {
        let model = piece(doc, id).attrs.model.unwrap();
        let folder = model.split_once('/').unwrap().0.to_owned();
        doc.file
            .contents
            .iter()
            .filter_map(|c| {
                let (top, rest) = c.name.split_once('/')?;
                (top == folder).then(|| (rest.to_owned(), c.data.clone()))
            })
            .collect()
    }
    let text = |files: &std::collections::BTreeMap<String, Vec<u8>>, name: &str| {
        String::from_utf8(files[name].clone()).unwrap()
    };

    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": id, "texture": tiles, "gable_texture": plaster }),
    );
    let after = snapshot(&doc);
    let made = data(&doc, &id);
    assert_eq!(made["texture"]["name"], "Roof tiles Zq9");
    assert_eq!(made["texture"]["file"], "cover.png");
    assert_eq!(made["texture"]["width"], 50.0);
    assert_eq!(made["gableTexture"]["file"], "gable.png");
    let model = files(&doc, &id);
    assert_eq!(model["cover.png"], common::png_bytes(8, 8));
    let mtl = text(&model, "roof.mtl");
    assert!(
        mtl.contains("newmtl roof_cover\nKd 1 1 1\nKa 0 0 0\nmap_Kd cover.png"),
        "{mtl}"
    );
    assert!(mtl.contains("map_Kd gable.png"), "{mtl}");
    // The ridge lies 400 cm from the eave, 565.69 cm up the slope: 22.63 tiles of 25 cm
    let obj = text(&model, "roof.obj");
    assert!(
        obj.lines()
            .any(|l| l.starts_with("vt ") && l.ends_with(" 22.6274")),
        "{obj}"
    );
    assert!(obj.contains("/1/1 "), "faces without texture coordinates");
    check_undo_redo(&r, &mut doc, &before, &after);

    // The textures stay when the roof is made again, also after saving
    run(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": id, "pitch": 30 }),
    );
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": id, "width": 900 }),
    );
    assert_eq!(files(&doc, &id)["cover.png"], common::png_bytes(8, 8));
    let mut reopened = save_and_reopen(&r, &mut doc, "roof_textures");
    run(
        &r,
        &mut reopened,
        "roof_update",
        json!({ "id": id, "overhang": 20 }),
    );
    assert_eq!(
        data(&reopened, &id)["gableTexture"]["name"],
        "Gable plaster Zq9"
    );
    assert!(text(&files(&reopened, &id), "roof.mtl").contains("map_Kd gable.png"));

    // "" takes a texture off again: the color is back
    run(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": id, "texture": "" }),
    );
    assert!(data(&doc, &id).get("texture").is_none());
    let model = files(&doc, &id);
    assert!(!model.contains_key("cover.png"));
    let mtl = text(&model, "roof.mtl");
    assert!(mtl.contains("newmtl roof_cover\nKd 0.54"), "{mtl}");
    assert!(mtl.contains("map_Kd gable.png"), "{mtl}");

    let err = run_err(
        &r,
        &mut doc,
        "roof_update",
        json!({ "id": id, "texture": "nothing" }),
    );
    assert!(err.contains("unknown texture"), "{err}");

    // A new roof with a texture
    let added = run(
        &r,
        &mut doc,
        "roof_add",
        json!({ "points": [[0, 0], [500, 0], [500, 400], [0, 400]], "shape": "flat", "texture": tiles }),
    );
    let flat = added["id"].as_str().unwrap();
    assert!(text(&files(&doc, flat), "roof.mtl").contains("map_Kd cover.png"));
}
