//! Catalog search and furniture commands. Tests that need catalog items import their own
//! models in a child process with a temporary user library folder
//! (`common::isolated_catalog`); `furniture_update` works on pieces put into the home directly.

mod common;

use common::{
    check_undo_redo, close, isolated_catalog, new_doc, png_bytes, run, run_err, save_and_reopen,
    snapshot, write_box_obj,
};
use msh_core::{Document, Registry};
use msh_model::{Color, Furniture, Piece, PieceAttrs, PieceKind};
use serde_json::{Value, json};
use std::path::Path;

/// Imports a box model (x = width, y = height, z = depth in cm) and returns its catalog ID.
fn import_box(
    r: &Registry,
    doc: &mut Document,
    root: &Path,
    name: &str,
    size: [f32; 3],
    extra: Value,
) -> String {
    let obj = write_box_obj(root, &format!("{name}.obj"), size);
    let mut params = json!({ "model_path": obj, "name": name });
    params
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().cloned().unwrap_or_default());
    run(r, doc, "furniture_import", params)["catalog_id"]
        .as_str()
        .unwrap()
        .to_owned()
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

/// Puts a plain piece (no model) into the home.
fn push_piece(doc: &mut Document, id: &str, kind: PieceKind) {
    doc.home_mut()
        .furniture
        .push(Furniture::Piece(Box::new(Piece {
            kind,
            attrs: PieceAttrs {
                id: Some(id.into()),
                name: id.into(),
                x: 100.0,
                y: 100.0,
                width: 80.0,
                depth: 60.0,
                height: 70.0,
                ..Default::default()
            },
            ..Default::default()
        })));
}

fn plain_home(r: &Registry) -> Document {
    let mut doc = new_doc(r);
    push_piece(&mut doc, "chair", PieceKind::Piece);
    push_piece(&mut doc, "table", PieceKind::Piece);
    push_piece(&mut doc, "door", PieceKind::DoorOrWindow);
    doc
}

fn wall(r: &Registry, doc: &mut Document, thickness: f32) -> String {
    run(
        r,
        doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 400, "y_end": 0, "thickness": thickness }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

// ---------------------------------------------------------------- catalog_search

#[test]
fn catalog_search_finds_furniture_and_textures_by_all_words() {
    let Some(root) = isolated_catalog("catalog_search_finds_furniture_and_textures_by_all_words")
    else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    for name in ["Sofa Vx8 red", "Sofa Vx8 blue", "Chair Vx8"] {
        import_box(&r, &mut doc, &root, name, [100.0, 80.0, 90.0], json!({}));
    }
    import_box(
        &r,
        &mut doc,
        &root,
        "Gate Vx8",
        [90.0, 200.0, 10.0],
        json!({ "door_or_window": true, "category": "Openings Vx8" }),
    );
    let png = root.join("Marble Vx8.png");
    std::fs::write(&png, png_bytes(2, 2)).unwrap();
    run(
        &r,
        &mut doc,
        "texture_import",
        json!({ "path": png, "width": 40 }),
    );

    let could_undo = doc.can_undo();
    let found = |doc: &mut Document, params: Value| {
        run(&r, doc, "catalog_search", params)["results"]
            .as_array()
            .unwrap()
            .clone()
    };
    assert_eq!(found(&mut doc, json!({ "query": "vx8 SOFA" })).len(), 2);
    assert_eq!(
        found(&mut doc, json!({ "query": "vx8 sofa blue" })).len(),
        1
    );
    assert_eq!(
        found(&mut doc, json!({ "query": "vx8", "limit": 2 })).len(),
        2
    );
    let gate = found(&mut doc, json!({ "query": "openings vx8" }));
    assert_eq!(gate.len(), 1);
    assert_eq!(gate[0]["door_or_window"], json!(true));
    assert_eq!(gate[0]["light"], json!(false));
    assert_eq!(
        (
            gate[0]["width"].as_f64(),
            gate[0]["depth"].as_f64(),
            gate[0]["height"].as_f64()
        ),
        (Some(90.0), Some(10.0), Some(200.0))
    );
    // Textures only with kind "textures"
    assert!(found(&mut doc, json!({ "query": "marble vx8" })).is_empty());
    let tex = found(
        &mut doc,
        json!({ "query": "marble vx8", "kind": "textures" }),
    );
    assert_eq!(tex.len(), 1);
    assert_eq!(tex[0]["width"].as_f64(), Some(40.0));
    assert!(found(&mut doc, json!({ "query": "vx8 nothing-like-this" })).is_empty());
    assert_eq!(doc.can_undo(), could_undo);
    run_err(&r, &mut doc, "catalog_search", json!({}));
    run_err(
        &r,
        &mut doc,
        "catalog_search",
        json!({ "query": "x", "kind": "lights" }),
    );
}

// ---------------------------------------------------------------- furniture_add

#[test]
fn furniture_add_places_and_embeds_a_catalog_piece() {
    let Some(root) = isolated_catalog("furniture_add_places_and_embeds_a_catalog_piece") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let catalog_id = import_box(
        &r,
        &mut doc,
        &root,
        "Desk Vx8",
        [140.0, 75.0, 70.0],
        json!({}),
    );
    let before = snapshot(&doc);
    let id = run(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": catalog_id, "x": 200, "y": 150 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(id.starts_with("pieceOfFurniture-"));
    let p = piece(&doc, &id);
    assert_eq!(p.kind, PieceKind::Piece);
    assert_eq!(p.attrs.catalog_id.as_deref(), Some(catalog_id.as_str()));
    assert_eq!(p.attrs.name, "Desk Vx8");
    assert_eq!((p.attrs.x, p.attrs.y), (200.0, 150.0));
    assert_eq!(
        (p.attrs.width, p.attrs.depth, p.attrs.height),
        (140.0, 70.0, 75.0)
    );
    assert_eq!(p.attrs.angle, None);
    let model = p.attrs.model.clone().unwrap();
    assert!(
        doc.file
            .contents
            .iter()
            .any(|c| c.name.split('/').next() == model.split('/').next()),
        "the model is embedded"
    );
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    // The saved file works without the catalog
    let reopened = save_and_reopen(&r, &mut doc, "furniture-add-save");
    let p = piece(&reopened, &id);
    assert_eq!(p.attrs.model.as_deref(), Some(model.as_str()));
    assert!(
        reopened
            .file
            .contents
            .iter()
            .any(|c| c.name.split('/').next() == model.split('/').next())
    );
}

#[test]
fn furniture_add_applies_the_given_values() {
    let Some(root) = isolated_catalog("furniture_add_applies_the_given_values") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let catalog_id = import_box(
        &r,
        &mut doc,
        &root,
        "Bed Vx8",
        [140.0, 50.0, 200.0],
        json!({}),
    );
    let id = run(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": catalog_id, "x": 0, "y": 0, "angle_deg": 90, "elevation": 10,
                "width": 160, "depth": 0, "height": 60, "name": "Guest bed",
                "color": "#336699", "mirrored": true }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let a = piece(&doc, &id).attrs;
    assert!(close(a.angle.unwrap(), std::f32::consts::FRAC_PI_2));
    assert_eq!(a.elevation, Some(10.0));
    // A depth of 0 keeps the catalog depth
    assert_eq!((a.width, a.depth, a.height), (160.0, 200.0, 60.0));
    assert_eq!(a.name, "Guest bed");
    assert_eq!(a.color, Some(Color(0xFF33_6699)));
    assert_eq!(a.model_mirrored, Some(true));
}

#[test]
fn furniture_add_uses_the_selected_or_given_level() {
    let Some(root) = isolated_catalog("furniture_add_uses_the_selected_or_given_level") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let catalog_id = import_box(
        &r,
        &mut doc,
        &root,
        "Lamp Vx8",
        [30.0, 50.0, 30.0],
        json!({}),
    );
    run(&r, &mut doc, "level_add", json!({ "name": "Upper" }));
    let (ground, upper) = (
        doc.home().levels[0].attrs.id.clone(),
        doc.home().levels[1].attrs.id.clone(),
    );
    let on_upper = run(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": catalog_id, "x": 0, "y": 0 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let on_ground = run(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": catalog_id, "x": 0, "y": 0, "level": ground }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(piece(&doc, &on_upper).attrs.level, Some(upper));
    assert_eq!(piece(&doc, &on_ground).attrs.level, Some(ground));
    let err = run_err(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": catalog_id, "x": 0, "y": 0, "level": "level-x" }),
    );
    assert!(err.contains("unknown level"), "{err}");
}

#[test]
fn furniture_add_refuses_unknown_items_and_bad_colors() {
    let Some(root) = isolated_catalog("furniture_add_refuses_unknown_items_and_bad_colors") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let catalog_id = import_box(
        &r,
        &mut doc,
        &root,
        "Box Vx8",
        [30.0, 30.0, 30.0],
        json!({}),
    );
    let err = run_err(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": "no-such#item", "x": 0, "y": 0 }),
    );
    assert!(err.contains("unknown catalog ID"), "{err}");
    run_err(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": catalog_id, "x": 0, "y": 0, "color": "blue" }),
    );
    run_err(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": catalog_id, "x": 0 }),
    );
    assert!(doc.home().furniture.is_empty());
}

// ---------------------------------------------------------------- furniture_add_in_wall

#[test]
fn doors_are_placed_along_the_wall_with_its_thickness() {
    let Some(root) = isolated_catalog("doors_are_placed_along_the_wall_with_its_thickness") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let door = import_box(
        &r,
        &mut doc,
        &root,
        "Door Vx8",
        [90.0, 200.0, 10.0],
        json!({ "door_or_window": true }),
    );
    let wall_id = wall(&r, &mut doc, 8.0);
    let before = snapshot(&doc);
    let result = run(
        &r,
        &mut doc,
        "furniture_add_in_wall",
        json!({ "catalog_id": door, "wall_id": wall_id, "offset": 120, "name": "Entry" }),
    );
    assert_eq!(result["x"], json!(120.0));
    assert_eq!(result["angle_deg"], json!(0.0));
    let p = piece(&doc, result["id"].as_str().unwrap());
    assert_eq!(p.kind, PieceKind::DoorOrWindow);
    assert_eq!(p.attrs.name, "Entry");
    assert_eq!(p.attrs.bound_to_wall, Some(true));
    // In a wall thinner than the door, the depth follows the wall, centered on its axis
    assert!(close(p.attrs.depth, 8.0));
    assert!(close(p.attrs.y, 0.0));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    // Flipped: turned by 180°
    let flipped = run(
        &r,
        &mut doc,
        "furniture_add_in_wall",
        json!({ "catalog_id": door, "wall_id": wall_id, "offset": 300, "flip": true,
                "mirrored": true, "width": 80, "height": 210, "elevation": 2 }),
    );
    assert_eq!(flipped["angle_deg"], json!(180.0));
    let a = piece(&doc, flipped["id"].as_str().unwrap()).attrs;
    assert_eq!(a.model_mirrored, Some(true));
    assert_eq!((a.width, a.height, a.elevation), (80.0, 210.0, Some(2.0)));
}

#[test]
fn doors_in_thick_walls_keep_their_depth() {
    let Some(root) = isolated_catalog("doors_in_thick_walls_keep_their_depth") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let door = import_box(
        &r,
        &mut doc,
        &root,
        "Door Vx8",
        [90.0, 200.0, 10.0],
        json!({ "door_or_window": true }),
    );
    let wall_id = wall(&r, &mut doc, 30.0);
    let result = run(
        &r,
        &mut doc,
        "furniture_add_in_wall",
        json!({ "catalog_id": door, "wall_id": wall_id, "offset": 200 }),
    );
    let a = piece(&doc, result["id"].as_str().unwrap()).attrs;
    // Real depth, flush with the side it opens to, opening through the whole wall
    assert!(close(a.depth, 10.0));
    assert!(close(a.y, 10.0), "y = {}", a.y);
    assert_eq!(a.wall_cut_out_on_both_sides, Some(true));
}

#[test]
fn add_in_wall_refuses_unknown_walls_furniture_and_offsets() {
    let Some(root) = isolated_catalog("add_in_wall_refuses_unknown_walls_furniture_and_offsets")
    else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let door = import_box(
        &r,
        &mut doc,
        &root,
        "Window Vx8",
        [100.0, 120.0, 10.0],
        json!({ "door_or_window": true }),
    );
    let table = import_box(
        &r,
        &mut doc,
        &root,
        "Table Vx8",
        [100.0, 75.0, 80.0],
        json!({}),
    );
    let wall_id = wall(&r, &mut doc, 20.0);
    let err = run_err(
        &r,
        &mut doc,
        "furniture_add_in_wall",
        json!({ "catalog_id": door, "wall_id": "wall-x", "offset": 10 }),
    );
    assert!(err.contains("unknown wall"), "{err}");
    let err = run_err(
        &r,
        &mut doc,
        "furniture_add_in_wall",
        json!({ "catalog_id": table, "wall_id": wall_id, "offset": 10 }),
    );
    assert!(err.contains("not a door or window"), "{err}");
    for offset in [-1.0, 400.5] {
        let err = run_err(
            &r,
            &mut doc,
            "furniture_add_in_wall",
            json!({ "catalog_id": door, "wall_id": wall_id, "offset": offset }),
        );
        assert!(err.contains("outside the wall"), "{err}");
    }
    run_err(
        &r,
        &mut doc,
        "furniture_add_in_wall",
        json!({ "catalog_id": "no#such", "wall_id": wall_id, "offset": 10 }),
    );
}

// ---------------------------------------------------------------- furniture_update

#[test]
fn update_moves_rotates_and_resizes_with_undo() {
    let r = Registry::standard();
    let mut doc = plain_home(&r);
    let before = snapshot(&doc);
    let result = run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "chair", "x": 10, "y": 20, "angle_deg": -90, "elevation": 5,
                "width": 50, "depth": -3, "height": 90, "name": "Armchair",
                "mirrored": true, "visible": false }),
    );
    assert_eq!(result, json!({ "id": "chair" }));
    let a = piece(&doc, "chair").attrs;
    assert_eq!((a.x, a.y), (10.0, 20.0));
    // Angles are kept in 0..360°
    assert!(close(a.angle.unwrap(), 1.5 * std::f32::consts::PI));
    assert_eq!(a.elevation, Some(5.0));
    // A negative depth is ignored
    assert_eq!((a.width, a.depth, a.height), (50.0, 60.0, 90.0));
    assert_eq!(a.name, "Armchair");
    assert_eq!(a.model_mirrored, Some(true));
    assert_eq!(a.visible, Some(false));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn update_of_several_pieces_is_one_step() {
    let r = Registry::standard();
    let mut doc = plain_home(&r);
    let before = snapshot(&doc);
    let result = run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "ids": ["chair", "table", "chair"], "elevation": 40, "color": "#FF8800" }),
    );
    // Duplicates count once
    assert_eq!(result, json!({ "ids": ["chair", "table"] }));
    for id in ["chair", "table"] {
        let a = piece(&doc, id).attrs;
        assert_eq!(a.elevation, Some(40.0));
        assert_eq!(a.color, Some(Color(0xFFFF_8800)));
    }
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    // "" restores the model colors
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "table", "color": "" }),
    );
    assert_eq!(piece(&doc, "table").attrs.color, None);
}

#[test]
fn update_refuses_invalid_targets_and_values() {
    let r = Registry::standard();
    let mut doc = plain_home(&r);
    for params in [
        json!({ "name": "X" }),
        json!({ "id": "sofa", "name": "X" }),
        // Pieces before the unknown one are not changed either
        json!({ "ids": ["chair", "sofa"], "elevation": 3 }),
        json!({ "ids": ["chair", "table"], "x": 5 }),
        json!({ "id": "chair", "color": "#12" }),
        json!({ "id": "door", "pitch_deg": 10 }),
        json!({ "id": "chair", "power": 50 }),
        json!({ "id": "chair", "spot_angle_deg": 30 }),
        json!({ "id": "chair", "name_font_size": 0 }),
        json!({ "id": "chair", "materials": [{ "name": "seat", "texture": "no#texture" }] }),
    ] {
        run_err(&r, &mut doc, "furniture_update", params);
    }
    if let Some(Furniture::Piece(p)) = doc.home_mut().furniture.first_mut() {
        p.attrs.horizontally_rotatable = Some(false);
    }
    let err = run_err(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "chair", "roll_deg": 5 }),
    );
    assert!(err.contains("cannot be tilted"), "{err}");
}

#[test]
fn tilt_and_name_style_are_set_and_cleared() {
    let r = Registry::standard();
    let mut doc = plain_home(&r);
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "table", "pitch_deg": 90, "name_visible": true, "name_font_size": 24,
                "name_font_name": "Arial", "name_bold": true }),
    );
    let p = piece(&doc, "table");
    // Tilted forward by 90°: depth and height swap in the plan
    assert!(close(p.attrs.depth_in_plan.unwrap(), 70.0));
    assert!(close(p.attrs.height_in_plan.unwrap(), 60.0));
    assert_eq!(p.attrs.name_visible, Some(true));
    let style = p.text_style.unwrap();
    assert_eq!(style.font_size, 24.0);
    assert_eq!(style.font_name.as_deref(), Some("Arial"));
    assert_eq!(style.bold, Some(true));
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "table", "pitch_deg": 0, "name_visible": false, "name_font_name": "",
                "name_bold": false }),
    );
    let p = piece(&doc, "table");
    assert_eq!(p.attrs.pitch, None);
    assert_eq!(p.attrs.depth_in_plan, None);
    assert_eq!(p.attrs.name_visible, None);
    let style = p.text_style.unwrap();
    assert_eq!((style.font_name, style.bold), (None, None));
}

#[test]
fn materials_are_changed_and_reset() {
    let r = Registry::standard();
    let mut doc = plain_home(&r);
    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "chair", "materials": [
            { "name": "seat", "color": "#AA0000", "shininess": 3 },
            { "name": "legs", "shininess": 0.25 },
            { "name": "unchanged" }
        ] }),
    );
    let m = piece(&doc, "chair").materials;
    // Materials without any change are not kept
    assert_eq!(m.len(), 2);
    assert_eq!(m[0].attrs.name, "seat");
    assert_eq!(m[0].attrs.color, Some(Color(0xFFAA_0000)));
    assert_eq!(m[0].attrs.shininess, Some(1.0), "clamped");
    assert_eq!(m[1].attrs.shininess, Some(0.25));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    // Back to the model's values: the material disappears
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "chair", "materials": [{ "name": "legs", "shininess": -1 }] }),
    );
    assert_eq!(piece(&doc, "chair").materials.len(), 1);
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "chair", "reset_materials": true }),
    );
    assert!(piece(&doc, "chair").materials.is_empty());
}

#[test]
fn updated_pieces_are_saved() {
    let r = Registry::standard();
    let mut doc = plain_home(&r);
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "chair", "x": 33, "angle_deg": 45, "name": "Saved chair", "color": "#010203",
                "visible": false, "materials": [{ "name": "seat", "color": "#00FF00" }] }),
    );
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "door", "wall_cut_out_on_both_sides": true }),
    );
    let reopened = save_and_reopen(&r, &mut doc, "furniture-update-save");
    let p = piece(&reopened, "chair");
    assert_eq!(p.attrs.x, 33.0);
    assert!(close(p.attrs.angle.unwrap(), std::f32::consts::FRAC_PI_4));
    assert_eq!(p.attrs.name, "Saved chair");
    assert_eq!(p.attrs.color, Some(Color(0xFF01_0203)));
    assert_eq!(p.attrs.visible, Some(false));
    assert_eq!(p.materials[0].attrs.color, Some(Color(0xFF00_FF00)));
    assert_eq!(
        piece(&reopened, "door").attrs.wall_cut_out_on_both_sides,
        Some(true)
    );
}

#[test]
fn pieces_inside_groups_can_be_updated() {
    let r = Registry::standard();
    let mut doc = plain_home(&r);
    run(
        &r,
        &mut doc,
        "furniture_group",
        json!({ "ids": ["chair", "table"] }),
    );
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "table", "name": "Grouped table" }),
    );
    assert_eq!(piece(&doc, "table").attrs.name, "Grouped table");
}
