//! Tests of rotating elements with edit_rotate.

mod common;

use common::*;
use msh_core::{Document, Registry};
use msh_model::{Furniture, Piece, PieceAttrs, PieceKind};
use serde_json::{Value, json};

fn id_of(v: Value) -> String {
    v["id"].as_str().unwrap().to_owned()
}

fn push_piece(doc: &mut Document, id: &str, kind: PieceKind, x: f32, y: f32) {
    doc.home_mut()
        .furniture
        .push(Furniture::Piece(Box::new(Piece {
            kind,
            attrs: PieceAttrs {
                id: Some(id.into()),
                name: id.into(),
                x,
                y,
                width: 80.0,
                depth: 10.0,
                height: 200.0,
                ..Default::default()
            },
            ..Default::default()
        })));
}

fn piece(doc: &Document, id: &str) -> PieceAttrs {
    let mut found = None;
    doc.home().for_each_piece(|p| {
        if p.attrs.id.as_deref() == Some(id) {
            found = Some(p.attrs.clone());
        }
    });
    found.unwrap_or_else(|| panic!("no piece {id}"))
}

#[test]
fn rotate_turns_every_kind_of_element_around_a_point() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let wall = id_of(run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 400, "y_end": 0 }),
    ));
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
        json!({ "text": "L", "x": 10, "y": 0 }),
    ));
    let dim = id_of(run(
        &r,
        &mut doc,
        "dimension_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 100, "y_end": 0, "offset": 30 }),
    ));
    let line = id_of(run(
        &r,
        &mut doc,
        "polyline_add",
        json!({ "points": [[0, 0], [50, 0]] }),
    ));
    let guide = id_of(run(
        &r,
        &mut doc,
        "guide_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 200, "y_end": 0 }),
    ));
    push_piece(&mut doc, "chair", PieceKind::Piece, 100.0, 0.0);
    push_piece(&mut doc, "other", PieceKind::Piece, 100.0, 0.0);

    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "edit_rotate",
        json!({ "ids": [wall, room, label, dim, line, guide, "chair"], "angle_deg": 90, "x": 0, "y": 0 }),
    );
    assert_eq!(res["rotated"], json!(7));
    let home = doc.home();
    // Clockwise in the plan: +x turns to +y
    let w = &home.walls[0].attrs;
    assert!(close(w.x_start, 0.0) && close(w.y_start, 0.0));
    assert!(close(w.x_end, 0.0) && close(w.y_end, 400.0));
    let pts: Vec<(f32, f32)> = home.rooms[0].points.iter().map(|p| (p.x, p.y)).collect();
    assert!(close(pts[1].0, 0.0) && close(pts[1].1, 100.0));
    assert!(close(pts[2].0, -50.0) && close(pts[2].1, 100.0));
    let l = &home.labels[0].attrs;
    assert!(close(l.x, 0.0) && close(l.y, 10.0));
    assert_eq!(l.angle, None, "texts stay upright");
    let d = &home.dimension_lines[0].attrs;
    assert!(close(d.x_end, 0.0) && close(d.y_end, 100.0));
    assert_eq!(d.offset, 30.0);
    let p = &home.polylines[0].points[1];
    assert!(close(p.x, 0.0) && close(p.y, 50.0));
    let chair = piece(&doc, "chair");
    assert!(close(chair.x, 0.0) && close(chair.y, 100.0));
    assert!(close(chair.angle.unwrap().to_degrees(), 90.0));
    let other = piece(&doc, "other");
    assert_eq!((other.x, other.y, other.angle), (100.0, 0.0, None));
    let list = run(&r, &mut doc, "guide_list", json!({}));
    assert!(close(
        list["guides"][0]["y_end"].as_f64().unwrap() as f32,
        200.0
    ));

    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    let reopened = save_and_reopen(&r, &mut doc, "edit_rotate");
    assert!(close(reopened.home().walls[0].attrs.y_end, 400.0));
}

#[test]
fn rotate_defaults_to_the_center_of_the_bounding_box() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let w = ids(
        &run(
            &r,
            &mut doc,
            "wall_add_path",
            json!({ "points": [[0, 0], [400, 0], [400, 200], [0, 200]], "closed": true }),
        ),
        "ids",
    );
    let res = run(
        &r,
        &mut doc,
        "edit_rotate",
        json!({ "ids": w, "angle_deg": 180 }),
    );
    assert_eq!(
        (res["x"].clone(), res["y"].clone()),
        (json!(200.0), json!(100.0))
    );
    let a = &doc.home().walls[0].attrs;
    assert!(close(a.x_start, 400.0) && close(a.y_start, 200.0));
    assert!(close(a.x_end, 0.0) && close(a.y_end, 200.0));
    // A full turn in four steps brings everything back
    for _ in 0..2 {
        run(
            &r,
            &mut doc,
            "edit_rotate",
            json!({ "ids": w, "angle_deg": 90 }),
        );
    }
    let a = &doc.home().walls[0].attrs;
    assert!(close(a.x_start, 0.0) && close(a.y_start, 0.0));
    assert!(close(a.x_end, 400.0) && close(a.y_end, 0.0));
}

#[test]
fn rotate_carries_openings_and_keeps_joined_walls_connected() {
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
    push_piece(&mut doc, "door", PieceKind::DoorOrWindow, 100.0, 0.0);
    run(
        &r,
        &mut doc,
        "edit_rotate",
        json!({ "ids": [w[0]], "angle_deg": 90, "x": 0, "y": 0 }),
    );
    let home = doc.home();
    let (first, second) = (&home.walls[0].attrs, &home.walls[1].attrs);
    assert!(close(first.x_end, 0.0) && close(first.y_end, 400.0));
    assert!(
        close(second.x_start, 0.0) && close(second.y_start, 400.0),
        "the joined end follows"
    );
    assert!(close(second.x_end, 400.0) && close(second.y_end, 300.0));
    let door = piece(&doc, "door");
    assert!(
        close(door.x, 0.0) && close(door.y, 100.0),
        "door in the wall"
    );
    assert!(close(door.angle.unwrap().to_degrees(), 90.0));
}

#[test]
fn rotate_refuses_unknown_ids_and_bad_angles() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let err = run_err(
        &r,
        &mut doc,
        "edit_rotate",
        json!({ "ids": ["nope"], "angle_deg": 90 }),
    );
    assert!(err.contains("no element found"), "{err}");
    run_err(&r, &mut doc, "edit_rotate", json!({ "ids": ["nope"] }));
}
