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

/// The same catalog piece placed several times shares its model and icons in the home; the
/// saved file keeps one copy that every piece finds. Also written to
/// `MSH_MODEL_SCENARIO_OUT` when set (for comparing files with the Sweet Home 3D reader).
#[test]
fn the_same_model_is_stored_once() {
    let Some(root) = isolated_catalog("the_same_model_is_stored_once") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let chair = import_box(
        &r,
        &mut doc,
        &root,
        "Shared chair Mz7",
        [45.0, 90.0, 50.0],
        json!({}),
    );
    let table = import_box(
        &r,
        &mut doc,
        &root,
        "Other table Mz7",
        [120.0, 75.0, 80.0],
        json!({}),
    );
    let add = |doc: &mut Document, id: &str, x: i32| {
        run(
            &r,
            doc,
            "furniture_add",
            json!({ "catalog_id": id, "x": x, "y": 0 }),
        )["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let before = doc.file.contents.len();
    add(&mut doc, &chair, 0);
    let after_first = doc.file.contents.len();
    add(&mut doc, &chair, 100);
    add(&mut doc, &chair, 200);
    let after_chairs = doc.file.contents.len();
    add(&mut doc, &table, 400);
    let after_table = doc.file.contents.len();
    // Undo and placing again still finds the resources
    run(&r, &mut doc, "edit_undo", json!({}));
    add(&mut doc, &table, 400);
    let after_again = doc.file.contents.len();

    let path = common::out_dir("the_same_model_is_stored_once").join("home.sh3d");
    run(&r, &mut doc, "home_save", json!({ "path": path }));
    if let Some(copy) = std::env::var_os("MSH_MODEL_SCENARIO_OUT") {
        std::fs::copy(&path, copy).unwrap();
    }

    let pieces: Vec<Piece> = doc
        .home()
        .furniture
        .iter()
        .filter_map(|f| match f {
            Furniture::Piece(p) => Some((**p).clone()),
            _ => None,
        })
        .collect();
    assert_eq!(pieces.len(), 4);
    let refs = |p: &Piece| {
        (
            p.attrs.model.clone(),
            p.attrs.icon.clone(),
            p.attrs.plan_icon.clone(),
        )
    };
    assert!(pieces[0].attrs.model.is_some());
    assert_eq!(refs(&pieces[0]), refs(&pieces[1]));
    assert_eq!(refs(&pieces[0]), refs(&pieces[2]));
    assert_ne!(pieces[0].attrs.model, pieces[3].attrs.model);
    assert!(after_first > before);
    assert_eq!(
        after_chairs, after_first,
        "placing the chair again added resources"
    );
    assert!(after_table > after_chairs);
    assert_eq!(after_again, after_table);

    // The saved file: every reference resolves, the chair's model files are there once
    let reopened = Document::open(&path).unwrap();
    let names: Vec<&str> = reopened
        .file
        .contents
        .iter()
        .map(|c| c.name.as_str())
        .collect();
    for p in &pieces {
        for name in [&p.attrs.model, &p.attrs.icon].into_iter().flatten() {
            assert!(
                names.contains(&name.as_str()),
                "{name} missing in {names:?}"
            );
        }
    }
    let model = pieces[0].attrs.model.clone().unwrap();
    assert_eq!(names.iter().filter(|n| **n == model).count(), 1);
}

/// Texture, shininess, description, price, VAT, currency and base plan of a piece, as Sweet
/// Home 3D's furniture dialog sets them; kept when saved.
#[test]
fn update_sets_the_fields_of_the_furniture_dialog() {
    let Some(root) = isolated_catalog("update_sets_the_fields_of_the_furniture_dialog") else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let sofa = import_box(
        &r,
        &mut doc,
        &root,
        "Dialog sofa Qp3",
        [200.0, 80.0, 90.0],
        json!({}),
    );
    let png = root.join("Dialog fabric Qp3.png");
    std::fs::write(&png, png_bytes(8, 8)).unwrap();
    let fabric = run(&r, &mut doc, "texture_import", json!({ "path": png }))["catalog_id"].clone();
    let id = run(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": sofa, "x": 0, "y": 0 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let piece = |doc: &Document| -> Piece {
        let mut found = None;
        doc.home().for_each_piece(|p| {
            if p.attrs.id.as_deref() == Some(id.as_str()) {
                found = Some(p.clone());
            }
        });
        found.unwrap()
    };

    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": id, "color": "#336699" }),
    );
    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": id, "texture": fabric, "shininess": 0.25, "description": "Corner sofa",
                "price": 1299.5, "vat_percent": 8.1, "currency": "chf", "base_plan_item": true }),
    );
    let after = snapshot(&doc);
    let p = piece(&doc);
    assert_eq!(
        p.texture.as_ref().map(|t| t.name.as_str()),
        Some("Dialog fabric Qp3")
    );
    assert_eq!(p.texture.as_ref().unwrap().role, None);
    // A texture replaces the color
    assert_eq!(p.attrs.color, None);
    assert_eq!(p.attrs.shininess, Some(0.25));
    assert_eq!(p.attrs.description.as_deref(), Some("Corner sofa"));
    assert_eq!(p.attrs.price.as_deref(), Some("1299.5"));
    assert_eq!(p.attrs.value_added_tax_percentage.as_deref(), Some("0.081"));
    assert_eq!(p.attrs.currency.as_deref(), Some("CHF"));
    assert_eq!(p.attrs.movable, Some(false));
    check_undo_redo(&r, &mut doc, &before, &after);

    // Saved and read again with the same values
    let reopened = save_and_reopen(
        &r,
        &mut doc,
        "update_sets_the_fields_of_the_furniture_dialog",
    );
    let mut q = None;
    reopened.home().for_each_piece(|x| {
        if x.attrs.id.as_deref() == Some(id.as_str()) {
            q = Some(x.clone());
        }
    });
    let q = q.unwrap();
    assert_eq!(
        q.texture.as_ref().map(|t| t.name.as_str()),
        Some("Dialog fabric Qp3")
    );
    assert_eq!(q.attrs.price, p.attrs.price);
    assert_eq!(
        q.attrs.value_added_tax_percentage,
        p.attrs.value_added_tax_percentage
    );
    assert_eq!(q.attrs.movable, Some(false));

    // A color replaces the texture; negative and empty values remove the fields
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": id, "color": "#aa0000", "shininess": -1, "description": "",
                "price": -1, "vat_percent": -1, "currency": "", "base_plan_item": false }),
    );
    let p = piece(&doc);
    assert!(p.texture.is_none());
    assert!(p.attrs.color.is_some());
    assert_eq!(p.attrs.shininess, None);
    assert_eq!(p.attrs.description, None);
    assert_eq!(p.attrs.price, None);
    assert_eq!(p.attrs.value_added_tax_percentage, None);
    assert_eq!(p.attrs.currency, None);
    assert_eq!(p.attrs.movable, None);
    // Removing the texture keeps everything else
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": id, "texture": fabric }),
    );
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": id, "texture": "" }),
    );
    assert!(piece(&doc).texture.is_none());

    run_err(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": id, "vat_percent": 120 }),
    );
    run_err(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": id, "texture": "no#such" }),
    );
}

#[test]
fn furniture_add_keeps_ceiling_pieces_under_the_ceiling_of_their_level() {
    let Some(root) =
        isolated_catalog("furniture_add_keeps_ceiling_pieces_under_the_ceiling_of_their_level")
    else {
        return;
    };
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    // A ceiling spot whose catalog elevation assumes a 250 cm ceiling
    let spot = import_box(
        &r,
        &mut doc,
        &root,
        "Spot Vx8",
        [10.0, 0.3, 10.0],
        json!({ "elevation": 249.7 }),
    );
    let lamp = import_box(
        &r,
        &mut doc,
        &root,
        "Wall lamp Vx8",
        [20.0, 10.0, 10.0],
        json!({ "elevation": 150 }),
    );
    let level = run(
        &r,
        &mut doc,
        "level_add",
        json!({ "name": "Basement", "elevation": 0, "height": 238 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let add = |doc: &mut Document, id: &str, extra: Value| {
        let mut params = json!({ "catalog_id": id, "x": 0, "y": 0, "level": level });
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().cloned().unwrap_or_default());
        run(&r, doc, "furniture_add", params)["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let s = add(&mut doc, &spot, json!({}));
    let a = piece(&doc, &s).attrs;
    assert!(close(a.elevation.unwrap(), 237.7), "{:?}", a.elevation);
    // Pieces below the ceiling and explicit elevations stay as they are
    let l = add(&mut doc, &lamp, json!({}));
    assert_eq!(piece(&doc, &l).attrs.elevation, Some(150.0));
    let e = add(&mut doc, &spot, json!({ "elevation": 249.7 }));
    assert_eq!(piece(&doc, &e).attrs.elevation, Some(249.7));

    // Changing the level height keeps ceiling pieces at the ceiling
    run(
        &r,
        &mut doc,
        "level_update",
        json!({ "id": level, "height": 230 }),
    );
    assert!(close(piece(&doc, &s).attrs.elevation.unwrap(), 229.7));
    assert_eq!(piece(&doc, &l).attrs.elevation, Some(150.0));
}
