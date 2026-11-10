//! Tests of the home commands: home_new, home_open, home_save, home_describe, home_set and
//! compass_update.

mod common;

use common::*;
use msh_core::{Document, Registry};
use serde_json::json;

fn add_wall(r: &Registry, doc: &mut Document) -> String {
    run(
        r,
        doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 300, "y_end": 0 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

// ---------------------------------------------------------------- home_new

#[test]
fn home_new_replaces_home_and_history_but_keeps_the_clipboard() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let wall = add_wall(&r, &mut doc);
    run(&r, &mut doc, "edit_copy", json!({ "ids": [wall] }));
    assert!(doc.can_undo());

    let res = run(
        &r,
        &mut doc,
        "home_new",
        json!({ "name": "Other", "wall_height": 280 }),
    );
    assert_eq!(res, json!({ "created": true }));
    let home = doc.home();
    assert!(home.walls.is_empty());
    assert_eq!(home.attrs.name.as_deref(), Some("Other"));
    assert_eq!(home.attrs.wall_height, Some(280.0));
    assert!(!doc.can_undo() && !doc.can_redo(), "history is discarded");
    assert!(doc.path.is_none() && !doc.modified);
    assert!(doc.clipboard.is_some(), "clipboard survives");
    let pasted = run(&r, &mut doc, "edit_paste", json!({}));
    assert_eq!(ids(&pasted, "ids").len(), 1);
}

#[test]
fn home_new_uses_defaults() {
    let r = Registry::standard();
    let mut doc = Document::default();
    run(&r, &mut doc, "home_new", json!({}));
    assert_eq!(doc.home().attrs.name, None);
    assert_eq!(doc.home().attrs.wall_height, Some(250.0));
    assert!(!doc.can_undo());
}

// ---------------------------------------------------------------- home_save / home_open

#[test]
fn home_save_and_open_round_trip() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let wall = add_wall(&r, &mut doc);
    assert!(doc.modified);
    let path = out_dir("home_save_open").join("house.sh3d");
    let res = run(&r, &mut doc, "home_save", json!({ "path": path }));
    assert_eq!(res["saved"], json!(path));
    assert_eq!(doc.path.as_deref(), Some(path.as_path()));
    assert!(!doc.modified);
    assert_eq!(
        doc.home().attrs.name.as_deref(),
        Some("house.sh3d"),
        "named after the file"
    );
    assert!(doc.can_undo(), "saving keeps the history");

    // Saving again without a path uses the current one
    run(&r, &mut doc, "edit_delete", json!({ "ids": [wall] }));
    run(&r, &mut doc, "home_save", json!({}));

    let mut other = new_doc(&r);
    add_wall(&r, &mut other);
    let res = run(&r, &mut other, "home_open", json!({ "path": path }));
    assert_eq!(res["walls"], json!([]), "the saved state without the wall");
    assert_eq!(res["name"], "house.sh3d");
    assert_eq!(res["can_undo"], false);
    assert!(other.home().walls.is_empty());
    assert_eq!(other.path.as_deref(), Some(path.as_path()));
    assert!(!other.can_undo() && !other.modified);
}

#[test]
fn home_open_keeps_the_clipboard() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let path = out_dir("home_open_clipboard").join("empty.sh3d");
    run(&r, &mut doc, "home_save", json!({ "path": path }));
    let wall = add_wall(&r, &mut doc);
    run(&r, &mut doc, "edit_copy", json!({ "ids": [wall] }));
    run(&r, &mut doc, "home_open", json!({ "path": path }));
    assert!(doc.home().walls.is_empty());
    assert!(doc.clipboard.is_some());
}

#[test]
fn home_save_and_open_fail_without_a_valid_path() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    add_wall(&r, &mut doc);
    let err = run_err(&r, &mut doc, "home_save", json!({}));
    assert!(err.contains("no file path"), "{err}");
    assert!(doc.path.is_none());

    let missing = out_dir("home_open_missing").join("missing.sh3d");
    run_err(&r, &mut doc, "home_open", json!({ "path": missing }));
    // A file that is not a home
    let junk = out_dir("home_open_junk").join("junk.sh3d");
    std::fs::write(&junk, b"not a zip file").unwrap();
    run_err(&r, &mut doc, "home_open", json!({ "path": junk }));
    assert_eq!(doc.home().walls.len(), 1, "the current home stays");
    run_err(&r, &mut doc, "home_open", json!({}));
}

// ---------------------------------------------------------------- home_describe

#[test]
fn home_describe_reports_elements_without_an_undo_step() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 300, "y_end": 400, "thickness": 12,
                "arc_extent_deg": 30 }),
    );
    let wall = doc.home().walls[0].attrs.id.clone();
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": wall, "left_side_color": "#ABCDEF" }),
    );
    run(
        &r,
        &mut doc,
        "room_add",
        json!({ "points": [[0, 0], [200, 0], [200, 100], [0, 100]], "name": "Bath",
                "floor_color": "#010203" }),
    );
    run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "Hi", "x": 1.234, "y": 2 }),
    );
    run(
        &r,
        &mut doc,
        "dimension_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 30, "y_end": 40 }),
    );
    run(&r, &mut doc, "edit_undo", json!({}));
    run(&r, &mut doc, "edit_redo", json!({}));

    let before = snapshot(&doc);
    let d = run(&r, &mut doc, "home_describe", json!({}));
    assert_eq!(snapshot(&doc), before);
    assert!(doc.can_undo() && !doc.can_redo(), "no undo step added");

    assert_eq!(d["name"], "Test");
    assert_eq!(d["wall_height"], 250.0);
    assert_eq!(d["modified"], true);
    assert_eq!(
        (d["can_undo"].clone(), d["can_redo"].clone()),
        (json!(true), json!(false))
    );
    let w = &d["walls"][0];
    assert_eq!(w["start"], json!([0.0, 0.0]));
    assert_eq!(w["end"], json!([300.0, 400.0]));
    assert_eq!(w["length"], 500.0);
    assert_eq!(w["thickness"], 12.0);
    assert_eq!(w["height"], 250.0, "default wall height");
    assert_eq!(w["arc_extent_deg"], 30.0);
    assert_eq!(w["left_side_color"], "#ABCDEF");
    assert_eq!(w["right_side_color"], json!(null));
    let room = &d["rooms"][0];
    assert_eq!(room["name"], "Bath");
    assert_eq!(room["area_m2"], 2.0);
    assert_eq!(room["floor_color"], "#010203");
    assert_eq!(d["labels"][0]["text"], "Hi");
    assert!(close(d["labels"][0]["x"].as_f64().unwrap() as f32, 1.23));
    assert_eq!(d["dimension_lines"][0]["length"], 50.0);
    assert_eq!(d["levels"], json!([]));
    assert_eq!(d["furniture"], json!([]));
}

#[test]
fn home_describe_filters_by_level() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    add_wall(&r, &mut doc);
    let upper = run(&r, &mut doc, "level_add", json!({ "name": "Upper" }))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "Up", "x": 0, "y": 0 }),
    );
    let d = run(&r, &mut doc, "home_describe", json!({ "level": upper }));
    assert_eq!(d["walls"], json!([]), "the wall is on level 0");
    assert_eq!(d["labels"].as_array().unwrap().len(), 1);
    assert_eq!(
        d["levels"].as_array().unwrap().len(),
        2,
        "all levels are listed"
    );
    assert_eq!(d["selected_level"], json!(upper));
    let all = run(&r, &mut doc, "home_describe", json!({}));
    assert_eq!(all["walls"].as_array().unwrap().len(), 1);
    // An unknown level simply matches nothing
    let none = run(
        &r,
        &mut doc,
        "home_describe",
        json!({ "level": "level-nope" }),
    );
    assert_eq!(
        (none["walls"].clone(), none["labels"].clone()),
        (json!([]), json!([]))
    );
}

// ---------------------------------------------------------------- home_set

#[test]
fn home_set_changes_name_and_wall_height() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "home_set",
        json!({ "name": "Villa", "wall_height": 275 }),
    );
    assert_eq!(res, json!({ "updated": true }));
    assert_eq!(doc.home().attrs.name.as_deref(), Some("Villa"));
    assert_eq!(doc.home().attrs.wall_height, Some(275.0));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    // New walls without height use it in describe, and it is saved
    add_wall(&r, &mut doc);
    let d = run(&r, &mut doc, "home_describe", json!({}));
    assert_eq!(d["walls"][0]["height"], 275.0);
    let reopened = save_and_reopen(&r, &mut doc, "home_set");
    assert_eq!(reopened.home().attrs.wall_height, Some(275.0));
}

#[test]
fn home_set_rejects_a_non_positive_wall_height() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    for h in [0.0, -10.0] {
        let err = run_err(
            &r,
            &mut doc,
            "home_set",
            json!({ "name": "Changed", "wall_height": h }),
        );
        assert!(err.contains("wall_height"), "{err}");
    }
    assert_eq!(doc.home().attrs.name.as_deref(), Some("Test"));
}

// ---------------------------------------------------------------- compass_update

#[test]
fn compass_update_creates_the_compass_with_defaults() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    doc.home_mut().compass = None;
    let before = snapshot(&doc);
    let res = run(&r, &mut doc, "compass_update", json!({ "diameter": 150 }));
    assert_eq!(res, json!({ "updated": true }));
    let c = doc.home().compass.clone().unwrap().attrs;
    assert_eq!((c.x, c.y, c.diameter), (-100.0, 50.0, 150.0));
    assert_eq!((c.north_direction, c.visible), (Some(0.0), Some(true)));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn compass_update_normalizes_angles_clamps_positions_and_is_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "compass_update",
        json!({
            "x": 10, "y": -20, "north_direction_deg": 450, "latitude_deg": 100,
            "longitude_deg": -200, "visible": false
        }),
    );
    let c = doc.home().compass.clone().unwrap().attrs;
    assert_eq!((c.x, c.y), (10.0, -20.0));
    assert!(close(c.north_direction.unwrap(), 90f32.to_radians()));
    assert!(close(c.latitude.unwrap(), 90f32.to_radians()));
    assert!(close(c.longitude.unwrap(), (-180f32).to_radians()));
    assert_eq!(c.visible, Some(false));

    run(
        &r,
        &mut doc,
        "compass_update",
        json!({ "north_direction_deg": -90, "latitude_deg": 47.5, "longitude_deg": 8.5 }),
    );
    let reopened = save_and_reopen(&r, &mut doc, "compass_update");
    let c = reopened.home().compass.clone().unwrap().attrs;
    assert_eq!((c.x, c.y, c.visible), (10.0, -20.0, Some(false)));
    assert!(close(c.north_direction.unwrap(), 270f32.to_radians()));
    assert!(close(c.latitude.unwrap(), 47.5f32.to_radians()));
    assert!(close(c.longitude.unwrap(), 8.5f32.to_radians()));
}

#[test]
fn compass_update_rejects_a_non_positive_diameter() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    // Without a compass: the compass created for the update is removed again
    doc.home_mut().compass = None;
    run_err(&r, &mut doc, "compass_update", json!({ "diameter": 0 }));
    assert!(doc.home().compass.is_none());
    run(&r, &mut doc, "compass_update", json!({ "diameter": 80 }));
    let err = run_err(
        &r,
        &mut doc,
        "compass_update",
        json!({ "x": 500, "diameter": -1 }),
    );
    assert!(err.contains("diameter"), "{err}");
}

#[test]
fn home_set_chooses_the_columns_of_the_furniture_list() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "home_set",
        json!({ "furniture_columns": ["name", "PRICE", "NAME", "VALUE_ADDED_TAX"] }),
    );
    let after = snapshot(&doc);
    assert_eq!(
        doc.home().furniture_visible_properties,
        vec!["NAME", "PRICE", "VALUE_ADDED_TAX"]
    );
    check_undo_redo(&r, &mut doc, &before, &after);
    let reopened = save_and_reopen(&r, &mut doc, "home_set_chooses_the_columns");
    assert_eq!(
        reopened.home().furniture_visible_properties,
        vec!["NAME", "PRICE", "VALUE_ADDED_TAX"]
    );
    run_err(
        &r,
        &mut doc,
        "home_set",
        json!({ "furniture_columns": ["NAME", "COLOUR"] }),
    );
    run(&r, &mut doc, "home_set", json!({ "furniture_columns": [] }));
    assert!(doc.home().furniture_visible_properties.is_empty());
}
