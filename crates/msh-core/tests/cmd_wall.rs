//! Tests of the wall commands: wall_add, wall_add_path and wall_update.

mod common;

use common::*;
use msh_core::{Document, Registry};
use msh_model::{Color, WallAttrs};
use serde_json::json;

fn wall(doc: &Document, id: &str) -> WallAttrs {
    doc.home()
        .walls
        .iter()
        .find(|w| w.attrs.id == id)
        .unwrap_or_else(|| panic!("no wall {id}"))
        .attrs
        .clone()
}

fn add_wall(r: &Registry, doc: &mut Document, from: [f32; 2], to: [f32; 2]) -> String {
    let v = run(
        r,
        doc,
        "wall_add",
        json!({ "x_start": from[0], "y_start": from[1], "x_end": to[0], "y_end": to[1] }),
    );
    v["id"].as_str().unwrap().to_owned()
}

/// Catalog ID of any installed texture, or None if Sweet Home 3D is not installed.
fn any_texture() -> Option<String> {
    msh_core::catalog::CatalogIndex::get()
        .textures
        .iter()
        .find_map(|t| t.item.id.clone())
}

// ---------------------------------------------------------------- wall_add

#[test]
fn wall_add_uses_defaults_and_is_undoable() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 300, "y_end": 0 }),
    );
    let id = res["id"].as_str().unwrap();
    assert!(id.starts_with("wall-"), "{id}");
    let a = wall(&doc, id);
    assert_eq!(
        (a.x_start, a.y_start, a.x_end, a.y_end),
        (0.0, 0.0, 300.0, 0.0)
    );
    assert_eq!(a.thickness, 10.0);
    assert_eq!(a.height, None, "uses the home wall height");
    assert_eq!(a.pattern.as_deref(), Some("hatchUp"));
    assert_eq!((a.wall_at_start, a.wall_at_end), (None, None));
    assert_eq!(a.level, None);
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn wall_add_options_are_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let res = run(
        &r,
        &mut doc,
        "wall_add",
        json!({
            "x_start": 10, "y_start": 20, "x_end": 410, "y_end": 20,
            "thickness": 25, "height": 280, "height_at_end": 200, "arc_extent_deg": 90
        }),
    );
    let id = res["id"].as_str().unwrap().to_owned();
    let a = wall(&doc, &id);
    assert_eq!(a.thickness, 25.0);
    assert_eq!((a.height, a.height_at_end), (Some(280.0), Some(200.0)));
    assert!(close(a.arc_extent.unwrap(), 90f32.to_radians()));

    let reopened = save_and_reopen(&r, &mut doc, "wall_add_options");
    let b = wall(&reopened, &id);
    assert_eq!(
        (b.x_start, b.y_start, b.x_end, b.y_end),
        (10.0, 20.0, 410.0, 20.0)
    );
    assert_eq!(b.thickness, 25.0);
    assert_eq!((b.height, b.height_at_end), (Some(280.0), Some(200.0)));
    assert!(close(b.arc_extent.unwrap(), 90f32.to_radians()));
    assert_eq!(b.pattern.as_deref(), Some("hatchUp"));
}

#[test]
fn wall_add_joins_the_given_walls_on_both_sides() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let a = add_wall(&r, &mut doc, [0.0, 0.0], [300.0, 0.0]);
    let c = add_wall(&r, &mut doc, [300.0, 300.0], [0.0, 300.0]);
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "wall_add",
        json!({
            "x_start": 300, "y_start": 0, "x_end": 300, "y_end": 300,
            "join_at_start": a, "join_at_end": c
        }),
    );
    let b = res["id"].as_str().unwrap();
    assert_eq!(wall(&doc, b).wall_at_start.as_deref(), Some(a.as_str()));
    assert_eq!(wall(&doc, b).wall_at_end.as_deref(), Some(c.as_str()));
    assert_eq!(wall(&doc, &a).wall_at_end.as_deref(), Some(b));
    assert_eq!(wall(&doc, &c).wall_at_start.as_deref(), Some(b));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "wall_add_joins");
    assert_eq!(wall(&reopened, &a).wall_at_end.as_deref(), Some(b));
    assert_eq!(wall(&reopened, b).wall_at_end.as_deref(), Some(c.as_str()));
}

#[test]
fn wall_add_rejects_unknown_join_wall_and_level() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    add_wall(&r, &mut doc, [0.0, 0.0], [100.0, 0.0]);
    let base = json!({ "x_start": 100, "y_start": 0, "x_end": 100, "y_end": 100 });
    for (key, value) in [
        ("join_at_start", "wall-nope"),
        ("join_at_end", "wall-nope"),
        ("level", "level-nope"),
    ] {
        let mut p = base.clone();
        p[key] = json!(value);
        let err = run_err(&r, &mut doc, "wall_add", p);
        assert!(err.contains("nope"), "{key}: {err}");
    }
    // Missing coordinates are invalid parameters
    run_err(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0 }),
    );
}

#[test]
fn wall_add_goes_to_the_selected_level() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let l0 = run(&r, &mut doc, "level_add", json!({ "name": "Ground" }))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let l1 = run(&r, &mut doc, "level_add", json!({ "name": "Upper" }))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let on_selected = add_wall(&r, &mut doc, [0.0, 0.0], [100.0, 0.0]);
    assert_eq!(wall(&doc, &on_selected).level.as_deref(), Some(l1.as_str()));
    let explicit = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 0, "y_end": 100, "level": l0 }),
    );
    assert_eq!(
        wall(&doc, explicit["id"].as_str().unwrap())
            .level
            .as_deref(),
        Some(l0.as_str())
    );
}

// ---------------------------------------------------------------- wall_add_path

#[test]
fn wall_add_path_open_joins_inner_corners_in_one_undo_step() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0], [400, 0], [400, 300]], "thickness": 20, "height": 270 }),
    );
    let w = ids(&res, "ids");
    assert_eq!(w.len(), 2);
    let (a, b) = (wall(&doc, &w[0]), wall(&doc, &w[1]));
    assert_eq!(a.wall_at_start, None);
    assert_eq!(a.wall_at_end.as_deref(), Some(w[1].as_str()));
    assert_eq!(b.wall_at_start.as_deref(), Some(w[0].as_str()));
    assert_eq!(b.wall_at_end, None);
    assert_eq!((a.thickness, a.height), (20.0, Some(270.0)));
    assert_eq!(
        (b.x_start, b.y_start, b.x_end, b.y_end),
        (400.0, 0.0, 400.0, 300.0)
    );
    let after = snapshot(&doc);
    // A single undo removes both walls
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn wall_add_path_closed_needs_three_points() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let res = run(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0], [400, 0]], "closed": true }),
    );
    let w = ids(&res, "ids");
    assert_eq!(w.len(), 1, "two points give one wall even if closed");
    let a = wall(&doc, &w[0]);
    assert_eq!((a.wall_at_start, a.wall_at_end), (None, None));

    let res = run(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 500], [300, 500], [150, 800]], "closed": true }),
    );
    let w = ids(&res, "ids");
    assert_eq!(w.len(), 3);
    let last = wall(&doc, &w[2]);
    assert_eq!(
        (last.x_end, last.y_end),
        (0.0, 500.0),
        "closes back to the start"
    );
    assert_eq!(last.wall_at_end.as_deref(), Some(w[0].as_str()));
    assert_eq!(
        wall(&doc, &w[0]).wall_at_start.as_deref(),
        Some(w[2].as_str())
    );
}

#[test]
fn wall_add_path_zero_arc_gives_straight_walls() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let res = run(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0], [100, 0]], "arc_extent_deg": 0 }),
    );
    assert_eq!(wall(&doc, &ids(&res, "ids")[0]).arc_extent, None);
}

#[test]
fn wall_add_path_joins_a_free_start_of_an_existing_wall_at_its_end() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let existing = add_wall(&r, &mut doc, [300.0, 0.0], [300.0, 200.0]);
    let res = run(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0], [300, 0]] }),
    );
    let new = ids(&res, "ids").remove(0);
    assert_eq!(
        wall(&doc, &new).wall_at_end.as_deref(),
        Some(existing.as_str())
    );
    assert_eq!(
        wall(&doc, &existing).wall_at_start.as_deref(),
        Some(new.as_str())
    );
}

#[test]
fn wall_add_path_does_not_join_walls_on_other_levels() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let l0 = run(&r, &mut doc, "level_add", json!({ "name": "Ground" }))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    run(&r, &mut doc, "level_add", json!({ "name": "Upper" }));
    let lower = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 300, "y_end": 0, "level": l0 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    // Drawn on the selected upper level, starting at the free end of the lower wall
    let res = run(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[300, 0], [300, 300]] }),
    );
    let upper = ids(&res, "ids").remove(0);
    assert_eq!(wall(&doc, &upper).wall_at_start, None);
    assert_eq!(wall(&doc, &lower).wall_at_end, None);
}

#[test]
fn wall_add_path_rejects_invalid_input() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let err = run_err(&r, &mut doc, "wall_add_path", json!({ "points": [[0, 0]] }));
    assert!(err.contains("at least 2"), "{err}");
    run_err(&r, &mut doc, "wall_add_path", json!({ "points": [] }));
    let err = run_err(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0], [100, 0]], "left_side_color": "red" }),
    );
    assert!(err.contains("invalid color"), "{err}");
    run_err(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0], [100, 0]], "right_side_color": "#12345" }),
    );
    run_err(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0], [100, 0]], "level": "level-nope" }),
    );
    // Points need two coordinates
    run_err(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0, 0], [100, 0, 0]] }),
    );
}

// ---------------------------------------------------------------- wall_update

#[test]
fn wall_update_moving_an_end_drags_the_joined_wall() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let w = ids(
        &run(
            &r,
            &mut doc,
            "wall_add_path",
            json!({ "points": [[0, 0], [400, 0], [400, 300]] }),
        ),
        "ids",
    );
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": w[0], "x_end": 500, "y_end": 50 }),
    );
    assert_eq!(res, json!({ "id": w[0] }));
    let b = wall(&doc, &w[1]);
    assert_eq!(
        (b.x_start, b.y_start),
        (500.0, 50.0),
        "joined start follows"
    );
    assert_eq!((b.x_end, b.y_end), (400.0, 300.0), "far end stays");
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn wall_update_free_end_moved_onto_a_free_end_gets_joined() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let a = add_wall(&r, &mut doc, [0.0, 0.0], [300.0, 0.0]);
    let b = add_wall(&r, &mut doc, [310.0, 10.0], [310.0, 300.0]);
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": b, "x_start": 300, "y_start": 0 }),
    );
    assert_eq!(wall(&doc, &b).wall_at_start.as_deref(), Some(a.as_str()));
    assert_eq!(wall(&doc, &a).wall_at_end.as_deref(), Some(b.as_str()));
}

#[test]
fn wall_update_length_of_a_free_wall() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_wall(&r, &mut doc, [100.0, 100.0], [100.0, 400.0]);
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": id, "length": 150 }),
    );
    let a = wall(&doc, &id);
    assert_eq!((a.x_start, a.y_start), (100.0, 100.0));
    assert!(close(a.x_end, 100.0) && close(a.y_end, 250.0), "{a:?}");
}

#[test]
fn wall_update_colors_pattern_height_and_arc_are_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_wall(&r, &mut doc, [0.0, 0.0], [300.0, 0.0]);
    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({
            "id": id, "left_side_color": "#112233", "right_side_color": "#80AABBCC",
            "pattern": "crossHatch", "height": 240, "height_at_end": 180,
            "arc_extent_deg": -45, "thickness": 15
        }),
    );
    let a = wall(&doc, &id);
    assert_eq!(a.left_side_color, Some(Color(0xFF11_2233)));
    assert_eq!(
        a.right_side_color,
        Some(Color(0x80AA_BBCC)),
        "alpha is kept"
    );
    assert_eq!(a.pattern.as_deref(), Some("crossHatch"));
    assert_eq!((a.height, a.height_at_end), (Some(240.0), Some(180.0)));
    assert!(close(a.arc_extent.unwrap(), (-45f32).to_radians()));
    assert_eq!(a.thickness, 15.0);
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "wall_update_colors");
    let b = wall(&reopened, &id);
    assert_eq!(b.left_side_color, Some(Color(0xFF11_2233)));
    assert_eq!(b.right_side_color, Some(Color(0x80AA_BBCC)));
    assert_eq!(b.pattern.as_deref(), Some("crossHatch"));
    assert_eq!((b.height, b.height_at_end), (Some(240.0), Some(180.0)));
    assert!(close(b.arc_extent.unwrap(), (-45f32).to_radians()));

    // "" restores the default colors, an arc of 0 makes the wall straight
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": id, "left_side_color": "", "right_side_color": "", "arc_extent_deg": 0 }),
    );
    let c = wall(&doc, &id);
    assert_eq!((c.left_side_color, c.right_side_color), (None, None));
    assert_eq!(c.arc_extent, None);
}

#[test]
fn wall_update_baseboards_are_added_changed_saved_and_removed() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_wall(&r, &mut doc, [0.0, 0.0], [300.0, 0.0]);
    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": id, "left_side_baseboard": {} }),
    );
    let w = doc.home().walls[0].clone();
    assert_eq!(w.baseboards.len(), 1);
    let b = &w.baseboards[0].attrs;
    assert_eq!(b.role, "leftSideBaseboard");
    assert_eq!(
        (b.height, b.thickness, b.color),
        (7.0, 1.0, None),
        "defaults"
    );
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    run(
        &r,
        &mut doc,
        "wall_update",
        json!({
            "id": id,
            "left_side_baseboard": { "height": 12, "thickness": 2, "color": "#336699" },
            "right_side_baseboard": { "height": 5 }
        }),
    );
    let reopened = save_and_reopen(&r, &mut doc, "wall_update_baseboards");
    let w = &reopened.home().walls[0];
    let left = w
        .baseboards
        .iter()
        .find(|b| b.attrs.role == "leftSideBaseboard")
        .unwrap();
    assert_eq!(
        (left.attrs.height, left.attrs.thickness, left.attrs.color),
        (12.0, 2.0, Some(Color(0xFF33_6699)))
    );
    let right = w
        .baseboards
        .iter()
        .find(|b| b.attrs.role == "rightSideBaseboard")
        .unwrap();
    assert_eq!((right.attrs.height, right.attrs.thickness), (5.0, 1.0));

    // Height 0 removes the baseboard
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": id, "left_side_baseboard": { "height": 0 } }),
    );
    let roles: Vec<_> = doc.home().walls[0]
        .baseboards
        .iter()
        .map(|b| b.attrs.role.clone())
        .collect();
    assert_eq!(roles, ["rightSideBaseboard"]);
}

#[test]
fn wall_update_rejects_invalid_values() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_wall(&r, &mut doc, [0.0, 0.0], [300.0, 0.0]);
    let other = add_wall(&r, &mut doc, [0.0, 100.0], [300.0, 100.0]);
    let cases = [
        json!({ "id": "wall-nope", "thickness": 20 }),
        json!({ "thickness": 20 }),
        json!({ "id": id, "thickness": 0 }),
        json!({ "id": id, "thickness": -5 }),
        json!({ "id": id, "length": 0 }),
        json!({ "id": id, "length": -100 }),
        json!({ "id": id, "length": 200, "x_end": 10 }),
        json!({ "id": id, "left_side_color": "#GGGGGG" }),
        json!({ "id": id, "right_side_color": "123" }),
        json!({ "id": id, "left_side_baseboard": { "thickness": 0 } }),
        json!({ "id": id, "right_side_baseboard": { "color": "blue" } }),
        json!({ "ids": [id, other], "x_start": 5 }),
        json!({ "ids": [id, other], "length": 100 }),
        // The second ID is unknown: the change of the first wall is rolled back
        json!({ "ids": [id, "wall-nope"], "thickness": 30 }),
    ];
    for p in cases {
        run_err(&r, &mut doc, "wall_update", p);
    }
}

#[test]
fn wall_update_length_of_a_wall_without_direction_fails() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_wall(&r, &mut doc, [50.0, 50.0], [50.0, 50.0]);
    let err = run_err(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": id, "length": 100 }),
    );
    assert!(err.contains("no direction"), "{err}");
}

#[test]
fn wall_update_unknown_texture_fails() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_wall(&r, &mut doc, [0.0, 0.0], [300.0, 0.0]);
    for p in [
        json!({ "id": id, "left_side_texture": "no#such-texture" }),
        json!({ "id": id, "right_side_texture": "no#such-texture" }),
        json!({ "id": id, "left_side_baseboard": { "texture": "no#such-texture" } }),
    ] {
        let err = run_err(&r, &mut doc, "wall_update", p);
        assert!(err.contains("unknown texture"), "{err}");
    }
}

#[test]
fn wall_side_and_baseboard_textures_are_saved_and_removed() {
    let Some(tex) = any_texture() else {
        eprintln!("skipped: no Sweet Home 3D texture catalog installed");
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_wall(&r, &mut doc, [0.0, 0.0], [300.0, 0.0]);
    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({
            "id": id, "left_side_texture": tex, "right_side_texture": tex,
            "left_side_baseboard": { "texture": tex }
        }),
    );
    let w = doc.home().walls[0].clone();
    let mut roles: Vec<_> = w.textures.iter().filter_map(|t| t.role.clone()).collect();
    roles.sort();
    assert_eq!(roles, ["leftSideTexture", "rightSideTexture"]);
    assert!(
        w.textures
            .iter()
            .all(|t| t.catalog_id.as_deref() == Some(&*tex))
    );
    let bb = w.baseboards[0].texture.clone().unwrap();
    assert_eq!(bb.role, None, "baseboard textures have no role");
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "wall_textures");
    let w = &reopened.home().walls[0];
    assert_eq!(w.textures.len(), 2);
    assert!(w.baseboards[0].texture.is_some());

    // Setting the same texture again replaces it instead of adding a second one
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": id, "left_side_texture": tex }),
    );
    assert_eq!(doc.home().walls[0].textures.len(), 2);
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": id, "left_side_texture": "", "left_side_baseboard": { "texture": "" } }),
    );
    let w = &doc.home().walls[0];
    assert_eq!(w.textures.len(), 1);
    assert_eq!(w.textures[0].role.as_deref(), Some("rightSideTexture"));
    assert!(w.baseboards[0].texture.is_none());
}

/// Saves a home with one texture on all walls, the floor and the ceiling, applied twice and
/// again after an undo. Also written to `MSH_TEXTURE_SCENARIO_OUT` when set (for comparing
/// files with the Sweet Home 3D reader).
#[test]
fn the_same_texture_is_stored_once() {
    let Some(root) = isolated_catalog("the_same_texture_is_stored_once") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let png = root.join("Shared planks Qx4.png");
    std::fs::write(&png, png_bytes(16, 16)).unwrap();
    let tex = run(&r, &mut doc, "texture_import", json!({ "path": png }))["catalog_id"].clone();
    let other_png = root.join("Other stone Qx4.png");
    std::fs::write(&other_png, png_bytes(8, 8)).unwrap();
    let other =
        run(&r, &mut doc, "texture_import", json!({ "path": other_png }))["catalog_id"].clone();

    let corners = [[0, 0], [400, 0], [400, 300], [0, 300]];
    let walls: Vec<String> = (0..4)
        .map(|i| {
            let [a, b] = [corners[i], corners[(i + 1) % 4]];
            run(
                &r,
                &mut doc,
                "wall_add",
                json!({ "x_start": a[0], "y_start": a[1], "x_end": b[0], "y_end": b[1] }),
            )["id"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
    let room = run(&r, &mut doc, "room_add", json!({ "points": corners }))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let contents_before = doc.file.contents.len();

    let apply = |doc: &mut Document| {
        run(
            &r,
            doc,
            "wall_update",
            json!({ "ids": walls, "left_side_texture": tex, "right_side_texture": tex }),
        );
        run(
            &r,
            doc,
            "room_update",
            json!({ "id": room, "floor_texture": tex, "ceiling_texture": tex }),
        );
    };
    apply(&mut doc);
    apply(&mut doc);
    run(&r, &mut doc, "edit_undo", json!({}));
    apply(&mut doc);

    let images = |doc: &Document| -> Vec<String> {
        let home = doc.home();
        home.walls
            .iter()
            .flat_map(|w| w.textures.iter().map(|t| t.image.clone()))
            .chain(
                home.rooms
                    .iter()
                    .flat_map(|r| r.textures.iter().map(|t| t.image.clone())),
            )
            .collect()
    };
    let used = images(&doc);
    let contents_after_shared = doc.file.contents.len();

    // Another image gets its own resource
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": room, "ceiling_texture": other }),
    );
    let ceiling = doc.home().rooms[0]
        .textures
        .iter()
        .find(|t| t.role.as_deref() == Some("ceilingTexture"))
        .unwrap()
        .image
        .clone();
    let contents_after_other = doc.file.contents.len();
    let path = out_dir("the_same_texture_is_stored_once").join("home.sh3d");
    run(&r, &mut doc, "home_save", json!({ "path": path }));
    if let Some(copy) = std::env::var_os("MSH_TEXTURE_SCENARIO_OUT") {
        std::fs::copy(&path, copy).unwrap();
    }

    assert_eq!(used.len(), 10, "{used:?}");
    assert!(used.iter().all(|i| *i == used[0]), "{used:?}");
    // One new resource for all ten uses, also after applying it again and undo
    assert_eq!(contents_after_shared, contents_before + 1);
    assert_ne!(ceiling, used[0]);
    assert_eq!(contents_after_other, contents_before + 2);

    // The saved file keeps one copy that all references find
    let reopened = Document::open(&path).unwrap();
    let names: Vec<&str> = reopened
        .file
        .contents
        .iter()
        .map(|c| c.name.as_str())
        .collect();
    for image in images(&reopened) {
        assert!(
            names.contains(&image.as_str()),
            "{image} missing in {names:?}"
        );
    }
    assert_eq!(names.iter().filter(|n| **n == used[0]).count(), 1);
}
