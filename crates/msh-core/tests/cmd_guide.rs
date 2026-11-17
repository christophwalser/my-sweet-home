//! Tests of the ruler guides: guide_add, guide_list, guide_clear, and moving and deleting
//! them with edit_move / edit_delete.

mod common;

use common::*;
use msh_core::Registry;
use serde_json::json;

fn add(r: &Registry, doc: &mut msh_core::Document, params: serde_json::Value) -> String {
    run(r, doc, "guide_add", params)["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn guides_are_added_listed_moved_deleted_and_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let id = add(
        &r,
        &mut doc,
        json!({ "x_start": 0, "y_start": 100, "x_end": 500, "y_end": 100 }),
    );
    let after = snapshot(&doc);
    assert!(id.starts_with("guide"));
    check_undo_redo(&r, &mut doc, &before, &after);

    let list = run(&r, &mut doc, "guide_list", json!({}));
    assert_eq!(list["guides"][0]["id"], json!(id));
    assert_eq!(list["guides"][0]["y_end"], json!(100.0));
    // Listing is no change
    assert_eq!(snapshot(&doc), after);

    run(
        &r,
        &mut doc,
        "edit_move",
        json!({ "ids": [id], "dx": 10, "dy": -5 }),
    );
    let g = &run(&r, &mut doc, "guide_list", json!({}))["guides"][0];
    assert_eq!(
        (g["x_start"].as_f64(), g["y_start"].as_f64()),
        (Some(10.0), Some(95.0))
    );

    // Saved in the home and read again
    let reopened = save_and_reopen(&r, &mut doc, "guides_are_saved");
    let mut reopened = reopened;
    let saved = run(&r, &mut reopened, "guide_list", json!({}));
    assert_eq!(saved["guides"].as_array().unwrap().len(), 1);

    let deleted = run(&r, &mut doc, "edit_delete", json!({ "ids": [id] }));
    assert_eq!(deleted["deleted"], json!([id]));
    assert!(
        run(&r, &mut doc, "guide_list", json!({}))["guides"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    // No guides: no property left in the home
    assert!(
        doc.home()
            .properties
            .iter()
            .all(|p| p.name != "mySweetHome.guides")
    );
}

#[test]
fn guides_belong_to_levels_and_are_cleared_per_level() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let first = run(&r, &mut doc, "level_add", json!({ "name": "L" }))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let second = run(&r, &mut doc, "level_add", json!({ "name": "L" }))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    add(
        &r,
        &mut doc,
        json!({ "x_start": 0, "y_start": 0, "x_end": 100, "y_end": 0, "level": first }),
    );
    add(
        &r,
        &mut doc,
        json!({ "x_start": 0, "y_start": 0, "x_end": 0, "y_end": 100, "level": second }),
    );
    add(
        &r,
        &mut doc,
        json!({ "x_start": 0, "y_start": 0, "x_end": 50, "y_end": 50, "level": second }),
    );
    let cleared = run(&r, &mut doc, "guide_clear", json!({ "level": second }));
    assert_eq!(cleared["deleted"], json!(2));
    let list = run(&r, &mut doc, "guide_list", json!({}));
    assert_eq!(list["guides"].as_array().unwrap().len(), 1);
    assert_eq!(list["guides"][0]["level"], json!(first));
    run(&r, &mut doc, "guide_clear", json!({ "level": "all" }));
    run_err(&r, &mut doc, "guide_clear", json!({ "level": "all" }));
}

#[test]
fn guide_add_refuses_bad_input() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run_err(
        &r,
        &mut doc,
        "guide_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 0, "y_end": 0 }),
    );
    run_err(
        &r,
        &mut doc,
        "guide_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 10, "y_end": 0, "level": "nope" }),
    );
}

#[test]
fn guide_color_and_dash_style_are_set_and_changed() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let a = add(
        &r,
        &mut doc,
        json!({ "x_start": 0, "y_start": 0, "x_end": 100, "y_end": 0,
                "color": "#ff8800", "dash_style": "DOT" }),
    );
    let b = add(
        &r,
        &mut doc,
        json!({ "x_start": 0, "y_start": 50, "x_end": 100, "y_end": 50 }),
    );
    let list = run(&r, &mut doc, "guide_list", json!({}));
    assert_eq!(list["guides"][0]["color"], json!("#FF8800"));
    assert_eq!(list["guides"][0]["dash_style"], json!("DOT"));
    // Without values the preferences decide when drawing
    assert!(list["guides"][1].get("color").is_none());

    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "guide_update",
        json!({ "ids": [a, b], "color": "#112233", "dash_style": "DASH_DOT" }),
    );
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    let list = run(&r, &mut doc, "guide_list", json!({}));
    for g in list["guides"].as_array().unwrap() {
        assert_eq!(g["color"], json!("#112233"));
        assert_eq!(g["dash_style"], json!("DASH_DOT"));
    }
    // Only the given value changes
    run(
        &r,
        &mut doc,
        "guide_update",
        json!({ "id": b, "dash_style": "SOLID" }),
    );
    let g = &run(&r, &mut doc, "guide_list", json!({}))["guides"][1];
    assert_eq!(
        (g["color"].clone(), g["dash_style"].clone()),
        (json!("#112233"), json!("SOLID"))
    );

    assert!(
        run_err(
            &r,
            &mut doc,
            "guide_update",
            json!({ "id": "nope", "color": "#000000" })
        )
        .contains("unknown guide")
    );
    assert!(
        run_err(
            &r,
            &mut doc,
            "guide_update",
            json!({ "id": a, "color": "red" })
        )
        .contains("invalid color")
    );

    // Moving one end keeps the other and the style
    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "guide_update",
        json!({ "id": b, "x_end": 250, "y_end": 80 }),
    );
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    let g = &run(&r, &mut doc, "guide_list", json!({}))["guides"][1];
    assert_eq!(
        (g["x_start"].as_f64(), g["y_start"].as_f64()),
        (Some(0.0), Some(50.0))
    );
    assert_eq!(
        (g["x_end"].as_f64(), g["y_end"].as_f64()),
        (Some(250.0), Some(80.0))
    );
    assert_eq!(g["dash_style"], json!("SOLID"));
    assert!(
        run_err(
            &r,
            &mut doc,
            "guide_update",
            json!({ "id": b, "x_start": 250, "y_start": 80 })
        )
        .contains("two different points")
    );
}

#[test]
fn guides_can_show_on_all_levels() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let level = run(&r, &mut doc, "level_add", json!({ "name": "L" }))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let id = add(
        &r,
        &mut doc,
        json!({ "x_start": 0, "y_start": 0, "x_end": 100, "y_end": 0, "level": level, "all_levels": true }),
    );
    let list = run(&r, &mut doc, "guide_list", json!({}));
    assert_eq!(list["guides"][0]["all_levels"], json!(true));

    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "guide_update",
        json!({ "id": id, "all_levels": false }),
    );
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    // Off is the default and not written
    let list = run(&r, &mut doc, "guide_list", json!({}));
    assert!(list["guides"][0].get("all_levels").is_none());

    run(
        &r,
        &mut doc,
        "guide_update",
        json!({ "id": id, "all_levels": true }),
    );
    let mut reopened = save_and_reopen(&r, &mut doc, "guides_can_show_on_all_levels");
    let list = run(&r, &mut reopened, "guide_list", json!({}));
    assert_eq!(list["guides"][0]["all_levels"], json!(true));
}

#[test]
fn guides_are_copied_pasted_and_duplicated() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let first = run(&r, &mut doc, "level_add", json!({ "name": "A" }))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let second = run(&r, &mut doc, "level_add", json!({ "name": "B" }))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let id = add(
        &r,
        &mut doc,
        json!({ "x_start": 0, "y_start": 0, "x_end": 100, "y_end": 0, "level": first, "color": "#FF0000", "all_levels": true }),
    );
    let copied = run(&r, &mut doc, "edit_copy", json!({ "ids": [id] }));
    assert_eq!(copied["copied"], json!(1));

    let before = snapshot(&doc);
    let pasted = run(&r, &mut doc, "edit_paste", json!({ "level": second }));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    let new = ids(&pasted, "ids");
    assert_eq!(new.len(), 1);
    assert_ne!(new[0], id);
    let list = run(&r, &mut doc, "guide_list", json!({}));
    let g = &list["guides"][1];
    assert_eq!(g["id"], json!(new[0]));
    assert_eq!(g["level"], json!(second));
    // Moved by 20 cm, as the original is still there; its own values are kept
    assert_eq!(g["x_start"], json!(20.0));
    assert_eq!(g["y_end"], json!(20.0));
    assert_eq!(g["color"], json!("#FF0000"));
    assert_eq!(g["all_levels"], json!(true));

    // Duplicated on its own level
    let dup = run(&r, &mut doc, "edit_duplicate", json!({ "ids": [id] }));
    let dup = ids(&dup, "ids");
    let list = run(&r, &mut doc, "guide_list", json!({}));
    let g = list["guides"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["id"] == json!(dup[0]))
        .unwrap();
    assert_eq!(g["level"], json!(first));
}
