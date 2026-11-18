//! Tests of the surface commands (surface_copy, texture_adjust, room_walls,
//! room_walls_update) and of furniture_replace.

mod common;

use common::*;
use msh_core::{Document, Registry};
use msh_model::{Color, Furniture, Piece, PieceAttrs, Texture, Wall};
use serde_json::{Value, json};

fn id_of(v: &Value) -> String {
    v["id"].as_str().unwrap().to_owned()
}

fn wall(doc: &Document, id: &str) -> Wall {
    doc.home()
        .walls
        .iter()
        .find(|w| w.attrs.id == id)
        .unwrap_or_else(|| panic!("no wall {id}"))
        .clone()
}

fn piece(doc: &Document, id: &str) -> Piece {
    let mut found = None;
    doc.home().for_each_piece(|p| {
        if p.attrs.id.as_deref() == Some(id) {
            found = Some(p.clone());
        }
    });
    found.unwrap_or_else(|| panic!("no piece {id}"))
}

fn add_wall(r: &Registry, doc: &mut Document, from: [i32; 2], to: [i32; 2]) -> String {
    id_of(&run(
        r,
        doc,
        "wall_add",
        json!({ "x_start": from[0], "y_start": from[1], "x_end": to[0], "y_end": to[1] }),
    ))
}

/// A room of 400 x 300 cm inside four walls of 10 cm (axes on the rectangle 0..400, 0..300),
/// the walls drawn in different directions. Returns the room and the walls top, right,
/// bottom, left.
fn walled_room(r: &Registry, doc: &mut Document) -> (String, [String; 4]) {
    let top = add_wall(r, doc, [0, 0], [400, 0]);
    let right = add_wall(r, doc, [400, 0], [400, 300]);
    // Drawn against the direction of the others
    let bottom = add_wall(r, doc, [0, 300], [400, 300]);
    let left = add_wall(r, doc, [0, 300], [0, 0]);
    let room = id_of(&run(
        r,
        doc,
        "room_add",
        json!({ "points": [[5, 5], [395, 5], [395, 295], [5, 295]], "name": "Kitchen" }),
    ));
    (room, [top, right, bottom, left])
}

fn oak(role: &str) -> Texture {
    Texture {
        role: Some(role.into()),
        catalog_id: Some("Test#oak".into()),
        name: "Oak".into(),
        width: 20.0,
        height: 120.0,
        image: "0".into(),
        ..Default::default()
    }
}

fn push_piece(doc: &mut Document, id: &str) {
    doc.home_mut()
        .furniture
        .push(Furniture::Piece(Box::new(Piece {
            attrs: PieceAttrs {
                id: Some(id.into()),
                name: id.into(),
                width: 80.0,
                depth: 60.0,
                height: 70.0,
                color: Some(Color(0xFF11_2233)),
                ..Default::default()
            },
            ..Default::default()
        })));
}

// ---------------------------------------------------------------- surface_copy

#[test]
fn surface_copy_gives_other_surfaces_the_look() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (room, [top, ..]) = walled_room(&r, &mut doc);
    push_piece(&mut doc, "table");
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": room, "floor_color": "#AABBCC", "floor_shininess": 0.25 }),
    );
    let mut tex = oak("floorTexture");
    tex.angle = Some(1.0);
    doc.home_mut().rooms[0].textures.push(tex);
    let before = snapshot(&doc);

    // Named surface of a wall, default surface of a piece
    run(
        &r,
        &mut doc,
        "surface_copy",
        json!({ "from_id": room, "from_surface": "floor", "id": top, "surface": "left_side" }),
    );
    let w = wall(&doc, &top);
    assert_eq!(w.attrs.left_side_color, Some(Color(0xFFAA_BBCC)));
    assert_eq!(w.attrs.left_side_shininess, Some(0.25));
    assert_eq!(w.attrs.right_side_color, None);
    assert_eq!(w.textures.len(), 1);
    assert_eq!(w.textures[0].role.as_deref(), Some("leftSideTexture"));
    assert_eq!(w.textures[0].angle, Some(1.0));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    run(
        &r,
        &mut doc,
        "surface_copy",
        json!({ "from_id": room, "from_surface": "floor", "ids": ["table", top] }),
    );
    let p = piece(&doc, "table");
    // A piece has either a texture or a color
    assert_eq!(p.attrs.color, None);
    let t = p.texture.unwrap();
    assert_eq!((t.role, t.name.as_str()), (None, "Oak"));
    assert_eq!(wall(&doc, &top).textures.len(), 2);

    // A color alone replaces the texture of the target
    run(
        &r,
        &mut doc,
        "surface_copy",
        json!({ "from_id": top, "from_surface": "top", "id": "table" }),
    );
    let p = piece(&doc, "table");
    assert_eq!((p.attrs.color, p.texture), (None, None));
}

#[test]
fn surface_copy_refuses_unknown_elements_and_surfaces() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (room, [top, ..]) = walled_room(&r, &mut doc);
    for params in [
        json!({ "from_id": "nope", "from_surface": "floor", "id": top }),
        json!({ "from_id": room, "from_surface": "left_side", "id": top }),
        json!({ "from_id": room, "from_surface": "floor", "id": top, "surface": "ceiling" }),
        json!({ "from_id": room, "from_surface": "floor", "id": "nope" }),
        json!({ "from_id": room, "from_surface": "floor" }),
    ] {
        run_err(&r, &mut doc, "surface_copy", params);
    }
}

// ---------------------------------------------------------------- texture_adjust

#[test]
fn texture_adjust_rotates_resizes_and_shifts() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (room, [top, ..]) = walled_room(&r, &mut doc);
    doc.home_mut().rooms[0].textures.push(oak("floorTexture"));
    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "texture_adjust",
        json!({ "id": room, "surface": "floor", "angle_deg": 90, "scale": 2, "x_offset": 0.25 }),
    );
    let t = doc.home().rooms[0].textures[0].clone();
    assert!(close(t.angle.unwrap(), std::f32::consts::FRAC_PI_2));
    assert_eq!(
        (t.scale, t.x_offset, t.y_offset),
        (Some(2.0), Some(0.25), None)
    );
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    let reopened = save_and_reopen(&r, &mut doc, "texture_adjust");
    assert_eq!(reopened.home().rooms[0].textures[0].scale, Some(2.0));

    // The defaults are not stored
    run(
        &r,
        &mut doc,
        "texture_adjust",
        json!({ "id": room, "surface": "floor", "angle_deg": 360, "scale": 1, "x_offset": 0 }),
    );
    let t = doc.home().rooms[0].textures[0].clone();
    assert_eq!((t.angle, t.scale, t.x_offset), (None, None, None));

    for params in [
        json!({ "id": room, "surface": "floor", "scale": 0 }),
        json!({ "id": room, "surface": "ceiling", "angle_deg": 10 }),
        json!({ "id": top, "surface": "left_side", "angle_deg": 10 }),
        json!({ "id": top, "surface": "floor", "angle_deg": 10 }),
    ] {
        run_err(&r, &mut doc, "texture_adjust", params);
    }
}

// ---------------------------------------------------------------- room_walls

fn sides(v: &Value) -> Vec<(String, String)> {
    v["walls"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| {
            (
                w["id"].as_str().unwrap().to_owned(),
                w["side"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

#[test]
fn room_walls_finds_the_side_facing_the_room() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (room, [top, right, bottom, left]) = walled_room(&r, &mut doc);
    // A wall elsewhere and a partition inside the room
    add_wall(&r, &mut doc, [600, 0], [600, 300]);
    let inner = add_wall(&r, &mut doc, [200, 100], [200, 200]);
    let found = sides(&run(&r, &mut doc, "room_walls", json!({ "id": room })));
    let side = |id: &str| -> Vec<&str> {
        found
            .iter()
            .filter(|(w, _)| w == id)
            .map(|(_, s)| s.as_str())
            .collect()
    };
    // Top and bottom are drawn in the same direction, so the room is on different sides
    assert_eq!(side(&top), ["right"]);
    assert_eq!(side(&bottom), ["left"]);
    assert_eq!(side(&right), ["right"]);
    assert_eq!(side(&left), ["right"]);
    assert_eq!(side(&inner), ["left", "right"]);
    assert_eq!(found.len(), 6);
    run_err(&r, &mut doc, "room_walls", json!({ "id": "nope" }));
}

#[test]
fn room_walls_update_changes_only_the_facing_sides() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (room, [top, _, bottom, _]) = walled_room(&r, &mut doc);
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "room_walls_update",
        json!({ "id": room, "color": "#336699", "shininess": 0.25, "baseboard": { "height": 8 } }),
    );
    assert_eq!(sides(&res).len(), 4);
    let blue = Some(Color(0xFF33_6699));
    let t = wall(&doc, &top);
    assert_eq!(
        (t.attrs.right_side_color, t.attrs.left_side_color),
        (blue, None)
    );
    assert_eq!(t.attrs.right_side_shininess, Some(0.25));
    assert_eq!(t.baseboards.len(), 1);
    assert_eq!(t.baseboards[0].attrs.role, "rightSideBaseboard");
    assert_eq!(t.baseboards[0].attrs.height, 8.0);
    let b = wall(&doc, &bottom);
    assert_eq!(
        (b.attrs.left_side_color, b.attrs.right_side_color),
        (blue, None)
    );
    assert_eq!(b.baseboards[0].attrs.role, "leftSideBaseboard");
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    // "" takes the color back, a baseboard of height 0 goes
    run(
        &r,
        &mut doc,
        "room_walls_update",
        json!({ "id": room, "color": "", "baseboard": { "height": 0 } }),
    );
    let t = wall(&doc, &top);
    assert_eq!(t.attrs.right_side_color, None);
    assert!(t.baseboards.is_empty());

    for params in [
        json!({ "id": "nope", "color": "#336699" }),
        json!({ "id": room, "color": "blue" }),
        json!({ "id": room, "texture": "no#such-texture" }),
    ] {
        run_err(&r, &mut doc, "room_walls_update", params);
    }
}

#[test]
fn room_walls_update_needs_walls_around_the_room() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let room = id_of(&run(
        &r,
        &mut doc,
        "room_add",
        json!({ "points": [[0, 0], [100, 0], [100, 100]] }),
    ));
    let err = run_err(
        &r,
        &mut doc,
        "room_walls_update",
        json!({ "id": room, "color": "#336699" }),
    );
    assert!(err.contains("no wall"), "{err}");
}

// ---------------------------------------------------------------- furniture_replace

fn import_box(r: &Registry, doc: &mut Document, root: &std::path::Path, name: &str) -> String {
    let size = if name.starts_with("Sofa") {
        [200.0, 80.0, 90.0]
    } else {
        [60.0, 45.0, 60.0]
    };
    let obj = write_box_obj(root, &format!("{name}.obj"), size);
    run(
        r,
        doc,
        "furniture_import",
        json!({ "model_path": obj, "name": name }),
    )["catalog_id"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn furniture_replace_keeps_the_place_of_the_piece() {
    let Some(root) = isolated_catalog("furniture_replace_keeps_the_place_of_the_piece") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let stool = import_box(&r, &mut doc, &root, "Stool Qx7");
    let sofa = import_box(&r, &mut doc, &root, "Sofa Qx7");
    let mut ids = Vec::new();
    for x in [100, 400] {
        ids.push(id_of(&run(
            &r,
            &mut doc,
            "furniture_add",
            json!({ "catalog_id": stool, "x": x, "y": 150, "angle_deg": 90, "elevation": 12 }),
        )));
    }
    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "furniture_replace",
        json!({ "id": ids[0], "catalog_id": sofa }),
    );
    let p = piece(&doc, &ids[0]);
    assert_eq!(p.attrs.name, "Sofa Qx7");
    assert_eq!(p.attrs.catalog_id.as_deref(), Some(sofa.as_str()));
    assert_eq!((p.attrs.x, p.attrs.y), (100.0, 150.0));
    assert_eq!(p.attrs.elevation, Some(12.0));
    assert!(close(p.attrs.angle.unwrap(), std::f32::consts::FRAC_PI_2));
    assert_eq!(
        (p.attrs.width, p.attrs.depth, p.attrs.height),
        (200.0, 90.0, 80.0)
    );
    // The other piece is untouched
    assert_eq!(piece(&doc, &ids[1]).attrs.name, "Stool Qx7");
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    run(
        &r,
        &mut doc,
        "furniture_replace",
        json!({ "ids": ids, "catalog_id": sofa, "keep_size": true }),
    );
    let p = piece(&doc, &ids[1]);
    assert_eq!(p.attrs.name, "Sofa Qx7");
    assert_eq!(
        (p.attrs.width, p.attrs.depth, p.attrs.height),
        (60.0, 60.0, 45.0)
    );
    assert_eq!(doc.home().piece_count(), 2);

    run_err(
        &r,
        &mut doc,
        "furniture_replace",
        json!({ "id": ids[0], "catalog_id": "no#such" }),
    );
    run_err(
        &r,
        &mut doc,
        "furniture_replace",
        json!({ "id": "nope", "catalog_id": sofa }),
    );
}

// ---------------------------------------------------------------- texture_apply

#[test]
fn texture_apply_textures_the_default_surfaces() {
    let Some(root) = isolated_catalog("texture_apply_textures_the_default_surfaces") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (room, [top, ..]) = walled_room(&r, &mut doc);
    push_piece(&mut doc, "table");
    let png = root.join("Linen Qx7.png");
    std::fs::write(&png, png_bytes(8, 8)).unwrap();
    let linen = run(&r, &mut doc, "texture_import", json!({ "path": png }))["catalog_id"]
        .as_str()
        .unwrap()
        .to_owned();
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": room, "floor_color": "#AABBCC" }),
    );
    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "texture_apply",
        json!({ "ids": [room, top, "table"], "texture": linen }),
    );
    let floor = doc.home().rooms[0].clone();
    assert_eq!(floor.textures.len(), 1);
    assert_eq!(floor.textures[0].role.as_deref(), Some("floorTexture"));
    // The color stays below the texture
    assert_eq!(floor.attrs.floor_color, Some(Color(0xFFAA_BBCC)));
    let roles: Vec<_> = wall(&doc, &top)
        .textures
        .iter()
        .map(|t| t.role.clone().unwrap())
        .collect();
    assert_eq!(roles, ["leftSideTexture", "rightSideTexture"]);
    let p = piece(&doc, "table");
    assert_eq!(p.attrs.color, None);
    assert_eq!(
        p.texture.unwrap().catalog_id.as_deref(),
        Some(linen.as_str())
    );
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    run(
        &r,
        &mut doc,
        "texture_apply",
        json!({ "id": top, "texture": "", "surface": "left_side" }),
    );
    assert_eq!(wall(&doc, &top).textures.len(), 1);
    run_err(
        &r,
        &mut doc,
        "texture_apply",
        json!({ "id": room, "texture": "no#such-texture" }),
    );
}

// ---------------------------------------------------------------- furniture_update

#[test]
fn furniture_update_keeps_the_proportions_of_each_piece() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    push_piece(&mut doc, "a");
    push_piece(&mut doc, "b");
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "b", "width": 40, "depth": 40, "height": 40 }),
    );
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "ids": ["a", "b"], "width": 160, "keep_proportions": true }),
    );
    let a = piece(&doc, "a").attrs;
    assert_eq!((a.width, a.depth, a.height), (160.0, 120.0, 140.0));
    let b = piece(&doc, "b").attrs;
    assert_eq!((b.width, b.depth, b.height), (160.0, 160.0, 160.0));
    // Two dimensions are taken as given
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "a", "width": 80, "depth": 80, "keep_proportions": true }),
    );
    let a = piece(&doc, "a").attrs;
    assert_eq!((a.width, a.depth, a.height), (80.0, 80.0, 140.0));
}

#[test]
fn furniture_update_moves_pieces_to_another_level() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let ground = id_of(&run(&r, &mut doc, "level_add", json!({ "name": "Ground" })));
    let first = id_of(&run(&r, &mut doc, "level_add", json!({ "name": "First" })));
    push_piece(&mut doc, "a");
    push_piece(&mut doc, "b");
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "ids": ["a", "b"], "level": first }),
    );
    assert_eq!(
        piece(&doc, "a").attrs.level.as_deref(),
        Some(first.as_str())
    );
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "a", "level": ground }),
    );
    assert_eq!(
        piece(&doc, "a").attrs.level.as_deref(),
        Some(ground.as_str())
    );
    assert_eq!(
        piece(&doc, "b").attrs.level.as_deref(),
        Some(first.as_str())
    );
    run_err(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "a", "level": "level-x" }),
    );
}
