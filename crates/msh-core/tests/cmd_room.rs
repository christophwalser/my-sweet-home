//! Tests of the room commands: room_add and room_update.

mod common;

use common::*;
use msh_core::{Document, Registry};
use msh_model::{Color, Room};
use serde_json::json;

fn room(doc: &Document, id: &str) -> Room {
    doc.home()
        .rooms
        .iter()
        .find(|r| r.attrs.id.as_deref() == Some(id))
        .unwrap_or_else(|| panic!("no room {id}"))
        .clone()
}

fn add_room(r: &Registry, doc: &mut Document) -> String {
    run(
        r,
        doc,
        "room_add",
        json!({ "points": [[0, 0], [400, 0], [400, 300], [0, 300]], "name": "Kitchen" }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn points(room: &Room) -> Vec<[f32; 2]> {
    room.points.iter().map(|p| [p.x, p.y]).collect()
}

/// Catalog ID of any installed texture, or None if Sweet Home 3D is not installed.
fn any_texture() -> Option<String> {
    msh_core::catalog::CatalogIndex::get()
        .textures
        .iter()
        .find_map(|t| t.item.id.clone())
}

// ---------------------------------------------------------------- room_add

#[test]
fn room_add_with_points_is_undoable_and_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "room_add",
        json!({
            "points": [[0, 0], [400, 0], [400, 300]], "name": "Hall",
            "floor_color": "#A0B0C0", "ceiling_color": "#FFFFFF"
        }),
    );
    let id = res["id"].as_str().unwrap().to_owned();
    assert!(id.starts_with("room-"), "{id}");
    assert_eq!(
        res["points"],
        json!([[0.0, 0.0], [400.0, 0.0], [400.0, 300.0]])
    );
    let rm = room(&doc, &id);
    assert_eq!(rm.attrs.name.as_deref(), Some("Hall"));
    assert_eq!(rm.attrs.area_visible, Some(true), "area shown by default");
    assert_eq!(rm.attrs.floor_color, Some(Color(0xFFA0_B0C0)));
    assert_eq!(rm.attrs.ceiling_color, Some(Color(0xFFFF_FFFF)));
    assert!(rm.textures.is_empty());
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "room_add");
    let rm = room(&reopened, &id);
    assert_eq!(points(&rm), [[0.0, 0.0], [400.0, 0.0], [400.0, 300.0]]);
    assert_eq!(rm.attrs.name.as_deref(), Some("Hall"));
    assert_eq!(rm.attrs.floor_color, Some(Color(0xFFA0_B0C0)));
    assert_eq!(rm.attrs.area_visible, Some(true));
}

#[test]
fn room_add_hides_the_area_on_request() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = run(
        &r,
        &mut doc,
        "room_add",
        json!({ "points": [[0, 0], [100, 0], [100, 100]], "area_visible": false }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(room(&doc, &id).attrs.area_visible, Some(false));
    assert_eq!(room(&doc, &id).attrs.name, None);
}

#[test]
fn room_add_inside_point_takes_the_inner_outline_of_the_walls() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0], [400, 0], [400, 300], [0, 300]], "closed": true }),
    );
    let res = run(
        &r,
        &mut doc,
        "room_add",
        json!({ "inside_point": [200, 150], "name": "Living" }),
    );
    let id = res["id"].as_str().unwrap();
    let rm = room(&doc, id);
    assert_eq!(rm.points.len(), 4);
    for p in &rm.points {
        assert!(close(p.x, 5.0) || close(p.x, 395.0), "{p:?}");
        assert!(close(p.y, 5.0) || close(p.y, 295.0), "{p:?}");
    }
    assert!((rm.area() - 390.0 * 290.0).abs() < 1.0);
    assert_eq!(res["points"].as_array().unwrap().len(), 4);

    let err = run_err(
        &r,
        &mut doc,
        "room_add",
        json!({ "inside_point": [1000, 1000] }),
    );
    assert!(err.contains("not enclosed"), "{err}");
}

#[test]
fn room_add_rejects_invalid_input() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let tri = json!([[0, 0], [100, 0], [100, 100]]);
    let cases = [
        (json!({}), "either points or inside_point"),
        (
            json!({ "points": tri, "inside_point": [10, 10] }),
            "either points or inside_point",
        ),
        (json!({ "points": [[0, 0], [100, 0]] }), "at least 3"),
        (
            json!({ "points": tri, "floor_color": "pink" }),
            "invalid color",
        ),
        (
            json!({ "points": tri, "ceiling_color": "#1234" }),
            "invalid color",
        ),
        (
            json!({ "points": tri, "level": "level-nope" }),
            "unknown level",
        ),
        (
            json!({ "points": tri, "floor_texture": "no#such-texture" }),
            "unknown texture",
        ),
    ];
    for (p, msg) in cases {
        let err = run_err(&r, &mut doc, "room_add", p.clone());
        assert!(err.contains(msg), "{p}: {err}");
    }
}

#[test]
fn room_add_with_floor_texture_is_saved() {
    let Some(tex) = any_texture() else {
        eprintln!("skipped: no Sweet Home 3D texture catalog installed");
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = run(
        &r,
        &mut doc,
        "room_add",
        json!({ "points": [[0, 0], [100, 0], [100, 100]], "floor_texture": tex }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let t = &room(&doc, &id).textures[0];
    assert_eq!(t.role.as_deref(), Some("floorTexture"));
    assert_eq!(t.catalog_id.as_deref(), Some(tex.as_str()));
    let reopened = save_and_reopen(&r, &mut doc, "room_add_texture");
    let t = &room(&reopened, &id).textures[0];
    assert_eq!(t.catalog_id.as_deref(), Some(tex.as_str()));
    assert!(
        reopened.file.contents.iter().any(|c| c.name == t.image),
        "texture image is embedded"
    );
}

// ---------------------------------------------------------------- room_update

#[test]
fn room_update_changes_name_visibility_colors_and_outline() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_room(&r, &mut doc);
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "room_update",
        json!({
            "id": id, "name": "Dining", "area_visible": false, "floor_visible": false,
            "ceiling_visible": false, "floor_color": "#102030", "ceiling_color": "#405060",
            "points": [[0, 0], [500, 0], [500, 500], [0, 500]]
        }),
    );
    assert_eq!(res, json!({ "id": id }));
    let a = room(&doc, &id).attrs;
    assert_eq!(a.name.as_deref(), Some("Dining"));
    assert_eq!(
        (a.area_visible, a.floor_visible, a.ceiling_visible),
        (Some(false), Some(false), Some(false))
    );
    assert_eq!(a.floor_color, Some(Color(0xFF10_2030)));
    assert_eq!(a.ceiling_color, Some(Color(0xFF40_5060)));
    assert!(close(room(&doc, &id).area(), 250_000.0));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "room_update");
    let rm = room(&reopened, &id);
    assert_eq!(rm.attrs.name.as_deref(), Some("Dining"));
    assert_eq!(
        (rm.attrs.floor_visible, rm.attrs.ceiling_visible),
        (Some(false), Some(false))
    );
    assert_eq!(rm.attrs.ceiling_color, Some(Color(0xFF40_5060)));
    assert_eq!(points(&rm).len(), 4);
    assert!(close(rm.area(), 250_000.0));

    // "" restores the default colors
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": id, "floor_color": "", "ceiling_color": "" }),
    );
    let a = room(&doc, &id).attrs;
    assert_eq!((a.floor_color, a.ceiling_color), (None, None));
}

#[test]
fn room_update_label_offsets_are_saved_and_reset() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_room(&r, &mut doc);
    run(
        &r,
        &mut doc,
        "room_update",
        json!({
            "id": id, "name_x_offset": 10, "name_y_offset": -20,
            "area_x_offset": 30, "area_y_offset": 40
        }),
    );
    let reopened = save_and_reopen(&r, &mut doc, "room_offsets");
    let a = room(&reopened, &id).attrs;
    assert_eq!(
        (a.name_x_offset, a.name_y_offset),
        (Some(10.0), Some(-20.0))
    );
    assert_eq!((a.area_x_offset, a.area_y_offset), (Some(30.0), Some(40.0)));

    // Only the name
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": id, "reset_name_position": true }),
    );
    let a = room(&doc, &id).attrs;
    assert_eq!((a.name_x_offset, a.name_y_offset), (None, None));
    assert_eq!(a.area_x_offset, Some(30.0));
    // Only the area
    run(&r, &mut doc, "edit_undo", json!({}));
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": id, "reset_area_position": true }),
    );
    let a = room(&doc, &id).attrs;
    assert_eq!(a.name_x_offset, Some(10.0));
    assert_eq!((a.area_x_offset, a.area_y_offset), (None, None));
    // All; a new offset in the same call wins over the reset
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": id, "reset_label_positions": true, "area_y_offset": 5 }),
    );
    let a = room(&doc, &id).attrs;
    assert_eq!(
        (a.name_x_offset, a.name_y_offset, a.area_x_offset),
        (None, None, None)
    );
    assert_eq!(a.area_y_offset, Some(5.0));
}

#[test]
fn room_update_several_rooms_in_one_step() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let a = add_room(&r, &mut doc);
    let b = add_room(&r, &mut doc);
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "room_update",
        json!({ "ids": [a, b], "floor_color": "#00FF00", "name": "Same" }),
    );
    assert_eq!(res, json!({ "ids": [a, b] }));
    for id in [&a, &b] {
        let attrs = room(&doc, id).attrs;
        assert_eq!(attrs.floor_color, Some(Color(0xFF00_FF00)));
        assert_eq!(attrs.name.as_deref(), Some("Same"));
    }
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn room_update_rejects_invalid_input() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let a = add_room(&r, &mut doc);
    let b = add_room(&r, &mut doc);
    let square = json!([[0, 0], [10, 0], [10, 10], [0, 10]]);
    let cases = [
        (json!({ "id": "room-nope", "name": "x" }), "unknown room"),
        (json!({ "name": "x" }), "give id or ids"),
        (
            json!({ "ids": [a, b], "points": square }),
            "one room at a time",
        ),
        (json!({ "id": a, "points": [[0, 0], [1, 1]] }), "at least 3"),
        (
            json!({ "id": a, "floor_color": "#XYZXYZ" }),
            "invalid color",
        ),
        (json!({ "id": a, "ceiling_color": "nope" }), "invalid color"),
        (json!({ "id": a, "name_font_size": 0 }), "font size"),
        (json!({ "id": a, "area_font_size": -3 }), "font size"),
        (
            json!({ "id": a, "floor_texture": "no#such-texture" }),
            "unknown texture",
        ),
        (
            json!({ "id": a, "ceiling_texture": "no#such-texture" }),
            "unknown texture",
        ),
        // The first room would change before the unknown one is found: rolled back
        (
            json!({ "ids": [a, "room-nope"], "name": "x" }),
            "unknown room",
        ),
    ];
    for (p, msg) in cases {
        let err = run_err(&r, &mut doc, "room_update", p.clone());
        assert!(err.contains(msg), "{p}: {err}");
    }
}

#[test]
fn room_update_floor_and_ceiling_textures_are_set_and_removed() {
    let Some(tex) = any_texture() else {
        eprintln!("skipped: no Sweet Home 3D texture catalog installed");
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_room(&r, &mut doc);
    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": id, "floor_texture": tex, "ceiling_texture": tex }),
    );
    let mut roles: Vec<_> = room(&doc, &id)
        .textures
        .iter()
        .filter_map(|t| t.role.clone())
        .collect();
    roles.sort();
    assert_eq!(roles, ["ceilingTexture", "floorTexture"]);
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "room_textures");
    assert_eq!(room(&reopened, &id).textures.len(), 2);

    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": id, "floor_texture": "" }),
    );
    let textures = room(&doc, &id).textures;
    assert_eq!(textures.len(), 1);
    assert_eq!(textures[0].role.as_deref(), Some("ceilingTexture"));
}
