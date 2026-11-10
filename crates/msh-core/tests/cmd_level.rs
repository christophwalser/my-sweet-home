//! Tests of the level commands: level_add, level_update and level_select.

mod common;

use common::*;
use msh_core::{Document, Registry};
use msh_model::{
    BackgroundImage, Furniture, FurnitureGroup, GroupAttrs, LevelAttrs, Piece, PieceAttrs,
};
use serde_json::json;

fn level(doc: &Document, id: &str) -> LevelAttrs {
    doc.home()
        .levels
        .iter()
        .find(|l| l.attrs.id == id)
        .unwrap_or_else(|| panic!("no level {id}"))
        .attrs
        .clone()
}

fn add_level(r: &Registry, doc: &mut Document, params: serde_json::Value) -> String {
    run(r, doc, "level_add", params)["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn piece(id: &str) -> Furniture {
    Furniture::Piece(Box::new(Piece {
        attrs: PieceAttrs {
            id: Some(id.into()),
            name: id.into(),
            width: 50.0,
            depth: 50.0,
            height: 50.0,
            ..Default::default()
        },
        ..Default::default()
    }))
}

// ---------------------------------------------------------------- level_add

#[test]
fn first_level_add_creates_level_0_for_existing_elements() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 300, "y_end": 0 }),
    );
    run(
        &r,
        &mut doc,
        "room_add",
        json!({ "points": [[0, 0], [100, 0], [100, 100]] }),
    );
    run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "A", "x": 0, "y": 0 }),
    );
    run(
        &r,
        &mut doc,
        "dimension_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 100, "y_end": 0 }),
    );
    run(
        &r,
        &mut doc,
        "polyline_add",
        json!({ "points": [[0, 0], [100, 100]] }),
    );
    doc.home_mut().furniture.push(piece("chair"));
    doc.home_mut()
        .furniture
        .push(Furniture::Group(Box::new(FurnitureGroup {
            attrs: GroupAttrs {
                id: Some("group".into()),
                name: "Group".into(),
                ..Default::default()
            },
            items: vec![piece("inner")],
            properties: Vec::new(),
            text_style: None,
            extra_children: Vec::new(),
        })));

    let before = snapshot(&doc);
    let upper = add_level(&r, &mut doc, json!({ "name": "Upper" }));
    let home = doc.home();
    assert_eq!(home.levels.len(), 2);
    let l0 = home.levels[0].attrs.clone();
    assert_eq!(l0.name, "Level 0");
    assert_eq!(
        (
            l0.elevation,
            l0.height,
            l0.floor_thickness,
            l0.elevation_index
        ),
        (0.0, 250.0, 12.0, Some(0))
    );
    let up = level(&doc, &upper);
    assert_eq!(up.name, "Upper");
    assert_eq!(
        (up.elevation, up.height, up.floor_thickness),
        (262.0, 250.0, 12.0),
        "on top of level 0 plus the floor thickness"
    );
    assert_eq!(home.attrs.selected_level.as_deref(), Some(upper.as_str()));
    let l0 = Some(l0.id);
    assert_eq!(home.walls[0].attrs.level, l0);
    assert_eq!(home.rooms[0].attrs.level, l0);
    assert_eq!(home.labels[0].attrs.level, l0);
    assert_eq!(home.dimension_lines[0].attrs.level, l0);
    assert_eq!(home.polylines[0].attrs.level, l0);
    let mut levels = Vec::new();
    home.for_each_piece(|p| levels.push(p.attrs.level.clone()));
    assert_eq!(
        levels,
        [l0.clone(), l0.clone()],
        "also pieces inside groups"
    );
    match &home.furniture[1] {
        Furniture::Group(g) => assert_eq!(g.attrs.level, l0),
        Furniture::Piece(_) => panic!("group expected"),
    }
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn first_level_add_moves_the_background_image_to_level_0() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    doc.home_mut().background_image = Some(BackgroundImage {
        image: "plan.png".into(),
        scale_distance: 100.0,
        ..Default::default()
    });
    add_level(&r, &mut doc, json!({ "name": "Upper" }));
    let home = doc.home();
    assert!(home.background_image.is_none());
    let bg = home.levels[0].background_image.as_ref().unwrap();
    assert_eq!(bg.image, "plan.png");
    assert!(home.levels[1].background_image.is_none());
}

#[test]
fn level_add_stacks_levels_and_uses_the_home_wall_height() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(&r, &mut doc, "home_set", json!({ "wall_height": 300 }));
    let first = add_level(&r, &mut doc, json!({ "name": "First" }));
    assert_eq!(level(&doc, &first).height, 300.0);
    assert_eq!(level(&doc, &first).elevation, 312.0);
    let second = add_level(
        &r,
        &mut doc,
        json!({ "name": "Second", "floor_thickness": 20 }),
    );
    let s = level(&doc, &second);
    assert_eq!((s.elevation, s.floor_thickness), (632.0, 20.0));
    assert_eq!(doc.home().levels.len(), 3, "level 0 is created only once");
}

#[test]
fn level_add_with_explicit_values_is_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let a = add_level(
        &r,
        &mut doc,
        json!({ "name": "Mezzanine", "elevation": 0, "height": 180, "floor_thickness": 8 }),
    );
    let l = level(&doc, &a);
    assert_eq!(
        (l.elevation, l.height, l.floor_thickness),
        (0.0, 180.0, 8.0)
    );
    // Level 0 is at the same elevation, so the new level comes after it
    assert_eq!(l.elevation_index, Some(1));

    let reopened = save_and_reopen(&r, &mut doc, "level_add");
    let l = level(&reopened, &a);
    assert_eq!(l.name, "Mezzanine");
    assert_eq!(
        (l.elevation, l.height, l.floor_thickness),
        (0.0, 180.0, 8.0)
    );
    assert_eq!(l.elevation_index, Some(1));
    assert_eq!(
        reopened.home().attrs.selected_level.as_deref(),
        Some(a.as_str())
    );
}

#[test]
fn level_add_needs_a_name() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run_err(&r, &mut doc, "level_add", json!({}));
    run_err(
        &r,
        &mut doc,
        "level_add",
        json!({ "name": "X", "height": "high" }),
    );
}

// ---------------------------------------------------------------- level_update

#[test]
fn level_update_changes_and_saves_all_fields() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_level(&r, &mut doc, json!({ "name": "Upper" }));
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "level_update",
        json!({
            "id": id, "name": "Attic", "elevation": 500, "height": 200,
            "floor_thickness": 15, "viewable": false
        }),
    );
    assert_eq!(res, json!({ "id": id }));
    let l = level(&doc, &id);
    assert_eq!(l.name, "Attic");
    assert_eq!(
        (l.elevation, l.height, l.floor_thickness),
        (500.0, 200.0, 15.0)
    );
    assert_eq!(l.viewable, Some(false));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "level_update");
    let l = level(&reopened, &id);
    assert_eq!(l.name, "Attic");
    assert_eq!(
        (l.elevation, l.height, l.floor_thickness),
        (500.0, 200.0, 15.0)
    );
    assert_eq!(l.viewable, Some(false));
}

#[test]
fn level_update_keeps_fields_that_are_not_given() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_level(&r, &mut doc, json!({ "name": "Upper", "height": 222 }));
    run(
        &r,
        &mut doc,
        "level_update",
        json!({ "id": id, "name": "Renamed" }),
    );
    let l = level(&doc, &id);
    assert_eq!(
        (l.name.as_str(), l.height, l.viewable),
        ("Renamed", 222.0, None)
    );
}

#[test]
fn level_update_unknown_level_fails() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    add_level(&r, &mut doc, json!({ "name": "Upper" }));
    let err = run_err(
        &r,
        &mut doc,
        "level_update",
        json!({ "id": "level-nope", "name": "X" }),
    );
    assert!(err.contains("unknown level"), "{err}");
    run_err(&r, &mut doc, "level_update", json!({ "name": "X" }));
}

// ---------------------------------------------------------------- level_select

#[test]
fn level_select_sets_the_level_of_new_elements() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    add_level(&r, &mut doc, json!({ "name": "Upper" }));
    let l0 = doc.home().levels[0].attrs.id.clone();
    let before = snapshot(&doc);
    let res = run(&r, &mut doc, "level_select", json!({ "id": l0 }));
    assert_eq!(res, json!({ "selected_level": l0 }));
    assert_eq!(
        doc.home().attrs.selected_level.as_deref(),
        Some(l0.as_str())
    );
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "B", "x": 0, "y": 0 }),
    );
    assert_eq!(
        doc.home().labels[0].attrs.level.as_deref(),
        Some(l0.as_str())
    );

    let reopened = save_and_reopen(&r, &mut doc, "level_select");
    assert_eq!(
        reopened.home().attrs.selected_level.as_deref(),
        Some(l0.as_str())
    );
}

#[test]
fn level_select_unknown_level_fails() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    // Without levels every ID is unknown
    run_err(&r, &mut doc, "level_select", json!({ "id": "level-nope" }));
    add_level(&r, &mut doc, json!({ "name": "Upper" }));
    let err = run_err(&r, &mut doc, "level_select", json!({ "id": "level-nope" }));
    assert!(err.contains("unknown level"), "{err}");
}
