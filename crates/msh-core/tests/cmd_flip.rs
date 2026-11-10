//! Tests of mirroring elements with edit_flip.

mod common;

use common::*;
use msh_core::{Document, Registry};
use msh_model::{Furniture, FurnitureGroup, GroupAttrs, Piece, PieceAttrs};
use serde_json::{Value, json};
use std::f32::consts::PI;

fn id_of(v: Value) -> String {
    v["id"].as_str().unwrap().to_owned()
}

fn piece(id: &str, x: f32, y: f32, angle_deg: f32) -> Furniture {
    Furniture::Piece(Box::new(Piece {
        attrs: PieceAttrs {
            id: Some(id.into()),
            name: id.into(),
            x,
            y,
            angle: Some(angle_deg.to_radians()),
            width: 50.0,
            depth: 40.0,
            height: 80.0,
            ..Default::default()
        },
        ..Default::default()
    }))
}

fn piece_attrs(doc: &Document, id: &str) -> PieceAttrs {
    let mut found = None;
    doc.home().for_each_piece(|p| {
        if p.attrs.id.as_deref() == Some(id) {
            found = Some(p.attrs.clone());
        }
    });
    found.unwrap_or_else(|| panic!("no piece {id}"))
}

fn angle_close(a: f32, b: f32) -> bool {
    let d = (a - b).rem_euclid(2.0 * PI);
    d < 1e-4 || 2.0 * PI - d < 1e-4
}

#[test]
fn flip_horizontal_mirrors_furniture_around_the_selection_center() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    doc.home_mut().furniture.push(piece("a", 100.0, 50.0, 30.0));
    doc.home_mut().furniture.push(piece("b", 300.0, 80.0, 0.0));
    doc.home_mut()
        .furniture
        .push(piece("other", 1000.0, 0.0, 0.0));
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "edit_flip",
        json!({ "ids": ["a", "b"], "axis": "horizontal" }),
    );
    assert_eq!(res, json!({ "flipped": 2 }));
    let a = piece_attrs(&doc, "a");
    assert_eq!((a.x, a.y), (300.0, 50.0));
    assert!(angle_close(a.angle.unwrap(), (-30f32).to_radians()));
    assert_eq!(a.model_mirrored, Some(true));
    let b = piece_attrs(&doc, "b");
    assert_eq!((b.x, b.y), (100.0, 80.0));
    assert_eq!(piece_attrs(&doc, "other").x, 1000.0, "unselected stays");
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    // A second flip restores the position and the model orientation
    run(
        &r,
        &mut doc,
        "edit_flip",
        json!({ "ids": ["a", "b"], "axis": "horizontal" }),
    );
    let a = piece_attrs(&doc, "a");
    assert_eq!((a.x, a.y, a.model_mirrored), (100.0, 50.0, Some(false)));
    assert!(angle_close(a.angle.unwrap(), 30f32.to_radians()));
}

#[test]
fn flip_vertical_mirrors_y_and_turns_the_angle() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    doc.home_mut().furniture.push(piece("a", 0.0, 0.0, 30.0));
    doc.home_mut().furniture.push(piece("b", 50.0, 200.0, 0.0));
    run(
        &r,
        &mut doc,
        "edit_flip",
        json!({ "ids": ["a", "b"], "axis": "vertical" }),
    );
    let a = piece_attrs(&doc, "a");
    assert_eq!((a.x, a.y), (0.0, 200.0));
    assert!(angle_close(a.angle.unwrap(), PI - 30f32.to_radians()));
    assert_eq!(a.model_mirrored, Some(true));
    assert_eq!(piece_attrs(&doc, "b").y, 0.0);
}

#[test]
fn flipped_furniture_is_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    doc.home_mut().furniture.push(piece("a", 100.0, 50.0, 90.0));
    run(
        &r,
        &mut doc,
        "edit_flip",
        json!({ "ids": ["a"], "axis": "horizontal" }),
    );
    let reopened = save_and_reopen(&r, &mut doc, "flip_furniture");
    let a = piece_attrs(&reopened, "a");
    assert_eq!(a.model_mirrored, Some(true));
    assert!(angle_close(a.angle.unwrap(), 270f32.to_radians()));
    assert_eq!((a.x, a.y), (100.0, 50.0), "a single piece stays in place");
}

#[test]
fn flip_walls_reverses_their_direction_joins_and_slope() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let w = ids(
        &run(
            &r,
            &mut doc,
            "wall_add_path",
            json!({ "points": [[0, 0], [100, 50], [200, 50]] }),
        ),
        "ids",
    );
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": w[0], "height": 300, "height_at_end": 200 }),
    );
    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "edit_flip",
        json!({ "ids": [w[0]], "axis": "horizontal" }),
    );
    let a = doc.home().walls[0].attrs.clone();
    // Mirrored around x = 50 and reversed, so the sides keep their physical side
    assert_eq!(
        (a.x_start, a.y_start, a.x_end, a.y_end),
        (0.0, 50.0, 100.0, 0.0)
    );
    assert_eq!(a.wall_at_start.as_deref(), Some(w[1].as_str()));
    assert_eq!(a.wall_at_end, None);
    assert_eq!((a.height, a.height_at_end), (Some(200.0), Some(300.0)));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "flip_walls");
    let a = reopened.home().walls[0].attrs.clone();
    assert_eq!(
        (a.x_start, a.y_start, a.x_end, a.y_end),
        (0.0, 50.0, 100.0, 0.0)
    );
    assert_eq!((a.height, a.height_at_end), (Some(200.0), Some(300.0)));
}

#[test]
fn flip_rooms_labels_dimensions_and_polylines() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let room = id_of(run(
        &r,
        &mut doc,
        "room_add",
        json!({ "points": [[0, 0], [100, 0], [100, 50]] }),
    ));
    let label = id_of(run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "L", "x": 20, "y": 10 }),
    ));
    let dim = id_of(run(
        &r,
        &mut doc,
        "dimension_add",
        json!({ "x_start": 0, "y_start": 30, "x_end": 100, "y_end": 40, "offset": 15 }),
    ));
    let line = id_of(run(
        &r,
        &mut doc,
        "polyline_add",
        json!({ "points": [[0, 0], [50, 20], [100, 50]] }),
    ));
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "edit_flip",
        json!({ "ids": [room, label, dim, line], "axis": "vertical" }),
    );
    assert_eq!(res, json!({ "flipped": 4 }));
    // The selection spans y = 0 .. 50, so the center line is y = 25
    let home = doc.home();
    let pts: Vec<_> = home.rooms[0].points.iter().map(|p| (p.x, p.y)).collect();
    assert_eq!(
        pts,
        [(100.0, 0.0), (100.0, 50.0), (0.0, 50.0)],
        "mirrored and reversed"
    );
    assert_eq!(
        (home.labels[0].attrs.x, home.labels[0].attrs.y),
        (20.0, 40.0)
    );
    let d = &home.dimension_lines[0].attrs;
    assert_eq!((d.y_start, d.y_end, d.offset), (20.0, 10.0, -15.0));
    let pts: Vec<_> = home.polylines[0]
        .points
        .iter()
        .map(|p| (p.x, p.y))
        .collect();
    assert_eq!(pts, [(0.0, 50.0), (50.0, 30.0), (100.0, 0.0)], "order kept");
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "flip_annotations");
    assert_eq!(reopened.home().dimension_lines[0].attrs.offset, -15.0);
    assert_eq!(reopened.home().labels[0].attrs.y, 40.0);
}

#[test]
fn flip_group_mirrors_its_pieces() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    doc.home_mut()
        .furniture
        .push(Furniture::Group(Box::new(FurnitureGroup {
            attrs: GroupAttrs {
                id: Some("group".into()),
                name: "Group".into(),
                x: Some(50.0),
                y: Some(0.0),
                angle: Some(0.5),
                ..Default::default()
            },
            items: vec![piece("a", 0.0, 0.0, 0.0), piece("b", 100.0, 0.0, 0.0)],
            properties: Vec::new(),
            text_style: None,
            extra_children: Vec::new(),
        })));
    let res = run(
        &r,
        &mut doc,
        "edit_flip",
        json!({ "ids": ["group"], "axis": "horizontal" }),
    );
    assert_eq!(res, json!({ "flipped": 1 }));
    assert_eq!(piece_attrs(&doc, "a").x, 100.0);
    assert_eq!(piece_attrs(&doc, "b").x, 0.0);
    assert_eq!(piece_attrs(&doc, "a").model_mirrored, Some(true));
    match &doc.home().furniture[0] {
        Furniture::Group(g) => {
            assert_eq!(g.attrs.x, Some(50.0));
            assert!(angle_close(g.attrs.angle.unwrap(), -0.5));
        }
        Furniture::Piece(_) => panic!("group expected"),
    }
}

#[test]
fn flip_rejects_unknown_ids_and_axes() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    doc.home_mut().furniture.push(piece("a", 0.0, 0.0, 0.0));
    let err = run_err(
        &r,
        &mut doc,
        "edit_flip",
        json!({ "ids": ["nope"], "axis": "horizontal" }),
    );
    assert!(err.contains("no element found"), "{err}");
    run_err(
        &r,
        &mut doc,
        "edit_flip",
        json!({ "ids": [], "axis": "vertical" }),
    );
    run_err(
        &r,
        &mut doc,
        "edit_flip",
        json!({ "ids": ["a"], "axis": "diagonal" }),
    );
    run_err(&r, &mut doc, "edit_flip", json!({ "ids": ["a"] }));
}
