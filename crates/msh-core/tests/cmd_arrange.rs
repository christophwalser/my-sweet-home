//! Reverse walls, align and distribute furniture, paste style: undo, errors and saving
//! (the geometry of each alignment is checked in `arrange.rs`).

mod common;

use common::{check_undo_redo, close, new_doc, run, run_err, save_and_reopen, snapshot};
use msh_core::{Document, Registry};
use msh_model::{Color, Furniture, Piece, PieceAttrs};
use serde_json::json;

fn add_piece(doc: &mut Document, id: &str, x: f32, y: f32, w: f32, d: f32) {
    doc.home_mut()
        .furniture
        .push(Furniture::Piece(Box::new(Piece {
            attrs: PieceAttrs {
                id: Some(id.into()),
                name: id.into(),
                x,
                y,
                width: w,
                depth: d,
                height: 80.0,
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

fn three_pieces(r: &Registry) -> Document {
    let mut doc = new_doc(r);
    add_piece(&mut doc, "p1", 0.0, 0.0, 20.0, 20.0);
    add_piece(&mut doc, "p2", 30.0, 40.0, 20.0, 20.0);
    add_piece(&mut doc, "p3", 60.0, 300.0, 20.0, 20.0);
    doc
}

fn wall(r: &Registry, doc: &mut Document, x_end: f32) -> String {
    run(
        r,
        doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": x_end, "y_end": 0, "thickness": 20 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn wall_reverse_is_an_undo_step_and_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = wall(&r, &mut doc, 400.0);
    doc.home_mut().walls[0].attrs.left_side_color = Some(Color(0xFF11_2233));
    let before = snapshot(&doc);
    let result = run(&r, &mut doc, "wall_reverse", json!({ "ids": [id] }));
    assert_eq!(result, json!({ "reversed": 1 }));
    let a = &doc.home().walls[0].attrs;
    assert_eq!((a.x_start, a.x_end), (400.0, 0.0));
    assert_eq!(a.right_side_color, Some(Color(0xFF11_2233)));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "arrange-reverse-save");
    let a = &reopened.home().walls[0].attrs;
    assert_eq!((a.x_start, a.x_end), (400.0, 0.0));
    assert_eq!(a.left_side_color, None);
    assert_eq!(a.right_side_color, Some(Color(0xFF11_2233)));
}

#[test]
fn reversing_twice_restores_the_wall() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = wall(&r, &mut doc, 300.0);
    {
        let a = &mut doc.home_mut().walls[0].attrs;
        a.height = Some(250.0);
        a.height_at_end = Some(200.0);
        a.arc_extent = Some(0.7);
    }
    let original = serde_json::to_value(&doc.home().walls[0]).unwrap();
    run(&r, &mut doc, "wall_reverse", json!({ "ids": [id] }));
    assert_eq!(doc.home().walls[0].attrs.height, Some(200.0));
    run(&r, &mut doc, "wall_reverse", json!({ "ids": [id] }));
    assert_eq!(
        serde_json::to_value(&doc.home().walls[0]).unwrap(),
        original
    );
}

#[test]
fn wall_reverse_needs_at_least_one_known_wall() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = wall(&r, &mut doc, 300.0);
    let err = run_err(&r, &mut doc, "wall_reverse", json!({ "ids": ["wall-x"] }));
    assert!(err.contains("no wall found"), "{err}");
    run_err(&r, &mut doc, "wall_reverse", json!({ "ids": [] }));
    // Unknown IDs next to a known one are ignored
    let result = run(
        &r,
        &mut doc,
        "wall_reverse",
        json!({ "ids": [id, "wall-x"] }),
    );
    assert_eq!(result["reversed"], json!(1));
}

#[test]
fn furniture_align_is_an_undo_step_and_saved() {
    let r = Registry::standard();
    let mut doc = three_pieces(&r);
    let before = snapshot(&doc);
    let result = run(
        &r,
        &mut doc,
        "furniture_align",
        json!({ "ids": ["p2", "p3", "p1"], "how": "left" }),
    );
    // The leader is the last ID
    assert_eq!(result, json!({ "aligned": 3, "leader": "p1" }));
    assert!(close(piece(&doc, "p2").x, 0.0));
    assert!(close(piece(&doc, "p3").x, 0.0));
    assert!(close(piece(&doc, "p3").y, 300.0), "only x changes");
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    let reopened = save_and_reopen(&r, &mut doc, "arrange-align-save");
    assert!(close(piece(&reopened, "p3").x, 0.0));
}

#[test]
fn furniture_align_refuses_too_few_or_unknown_pieces() {
    let r = Registry::standard();
    let mut doc = three_pieces(&r);
    for params in [
        json!({ "ids": [], "how": "left" }),
        json!({ "ids": ["p1"], "how": "left" }),
        json!({ "ids": ["p1", "nope"], "how": "left" }),
        json!({ "ids": ["p1", "p2"], "how": "left", "leader": "nope" }),
        json!({ "ids": ["p1", "p2"], "how": "diagonal" }),
    ] {
        run_err(&r, &mut doc, "furniture_align", params);
    }
}

#[test]
fn leader_outside_the_ids_is_used_too() {
    let r = Registry::standard();
    let mut doc = three_pieces(&r);
    doc.home_mut().furniture.iter_mut().for_each(|f| {
        if let Furniture::Piece(p) = f
            && p.attrs.id.as_deref() == Some("p3")
        {
            p.attrs.elevation = Some(50.0);
        }
    });
    run(
        &r,
        &mut doc,
        "furniture_align",
        json!({ "ids": ["p1", "p2"], "how": "bottom", "leader": "p3" }),
    );
    assert_eq!(piece(&doc, "p1").elevation, Some(50.0));
    assert_eq!(piece(&doc, "p2").elevation, Some(50.0));
}

#[test]
fn groups_are_aligned_with_their_pieces() {
    let r = Registry::standard();
    let mut doc = three_pieces(&r);
    let group = run(
        &r,
        &mut doc,
        "furniture_group",
        json!({ "ids": ["p1", "p2"], "name": "Pair" }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    if let Some(Furniture::Piece(p)) = doc
        .home_mut()
        .furniture
        .iter_mut()
        .find(|f| matches!(f, Furniture::Piece(p) if p.attrs.id.as_deref() == Some("p3")))
    {
        p.attrs.elevation = Some(30.0);
    }
    run(
        &r,
        &mut doc,
        "furniture_align",
        json!({ "ids": [group, "p3"], "how": "bottom" }),
    );
    // The pieces of the group are raised with it
    assert_eq!(piece(&doc, "p1").elevation, Some(30.0));
    assert_eq!(piece(&doc, "p2").elevation, Some(30.0));
}

#[test]
fn furniture_distribute_vertically_is_an_undo_step() {
    let r = Registry::standard();
    let mut doc = three_pieces(&r);
    let before = snapshot(&doc);
    let result = run(
        &r,
        &mut doc,
        "furniture_distribute",
        json!({ "ids": ["p3", "p1", "p2"], "axis": "vertical" }),
    );
    // From y -10 to 310 with 60 cm of pieces: two gaps of 130 cm
    assert_eq!(result, json!({ "distributed": 3, "gap": 130.0 }));
    assert!(close(piece(&doc, "p2").y, 150.0));
    assert!(close(piece(&doc, "p2").x, 30.0), "only y changes");
    assert!(close(piece(&doc, "p1").y, 0.0) && close(piece(&doc, "p3").y, 300.0));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn furniture_distribute_needs_three_known_pieces() {
    let r = Registry::standard();
    let mut doc = three_pieces(&r);
    let err = run_err(
        &r,
        &mut doc,
        "furniture_distribute",
        json!({ "ids": ["p1", "p2", "nope"], "axis": "horizontal" }),
    );
    assert!(err.contains("at least three"), "{err}");
    run_err(
        &r,
        &mut doc,
        "furniture_distribute",
        json!({ "ids": ["p1", "p2", "p3"], "axis": "diagonal" }),
    );
}

#[test]
fn paste_style_needs_a_copied_element_of_the_same_kind() {
    let r = Registry::standard();
    let mut doc = three_pieces(&r);
    let err = run_err(&r, &mut doc, "edit_paste_style", json!({ "ids": ["p1"] }));
    assert!(err.contains("clipboard is empty"), "{err}");
    let id = wall(&r, &mut doc, 200.0);
    run(&r, &mut doc, "edit_copy", json!({ "ids": [id] }));
    let err = run_err(&r, &mut doc, "edit_paste_style", json!({ "ids": ["p1"] }));
    assert!(err.contains("same kind"), "{err}");
}

#[test]
fn wall_style_keeps_thickness_and_heights() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let source = wall(&r, &mut doc, 200.0);
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": source, "height": 120, "height_at_end": 90, "right_side_color": "#336699" }),
    );
    let target = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 300, "x_end": 200, "y_end": 300, "thickness": 36.5 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let height = doc.home().walls[1].attrs.height;
    run(&r, &mut doc, "edit_copy", json!({ "ids": [source] }));
    run(&r, &mut doc, "edit_paste_style", json!({ "ids": [target] }));
    let a = &doc.home().walls[1].attrs;
    assert_eq!(a.right_side_color, Some(Color(0xFF336699)));
    assert_eq!(a.thickness, 36.5, "the thickness is no style");
    assert_eq!(a.height, height, "the height is no style");
    assert_eq!(a.height_at_end, None);
}

#[test]
fn room_style_is_pasted_undone_and_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let source = run(
        &r,
        &mut doc,
        "room_add",
        json!({ "name": "Source", "points": [[0, 0], [100, 0], [100, 100]],
                "floor_color": "#AA0000", "ceiling_color": "#00BB00", "area_visible": false }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let target = run(
        &r,
        &mut doc,
        "room_add",
        json!({ "name": "Target", "points": [[200, 0], [300, 0], [300, 100]] }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    run(&r, &mut doc, "edit_copy", json!({ "ids": [source] }));
    let before = snapshot(&doc);
    let result = run(&r, &mut doc, "edit_paste_style", json!({ "ids": [target] }));
    assert_eq!(result, json!({ "styled": 1 }));
    let room = &doc.home().rooms[1];
    assert_eq!(room.attrs.name.as_deref(), Some("Target"), "the name stays");
    assert_eq!(room.attrs.floor_color, Some(Color(0xFFAA_0000)));
    assert_eq!(room.attrs.ceiling_color, Some(Color(0xFF00_BB00)));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    let reopened = save_and_reopen(&r, &mut doc, "arrange-paste-room");
    assert_eq!(
        reopened.home().rooms[1].attrs.floor_color,
        Some(Color(0xFFAA_0000))
    );
}

#[test]
fn furniture_style_keeps_materials_for_the_same_model_only() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    for (id, model) in [("src", "0"), ("same", "0"), ("other", "1")] {
        add_piece(&mut doc, id, 0.0, 0.0, 50.0, 50.0);
        if let Some(Furniture::Piece(p)) = doc.home_mut().furniture.last_mut() {
            p.attrs.model = Some(model.into());
        }
    }
    if let Some(Furniture::Piece(p)) = doc.home_mut().furniture.first_mut() {
        p.attrs.color = Some(Color(0xFF12_3456));
        p.materials.push(msh_model::Material {
            attrs: msh_model::MaterialAttrs {
                name: "seat".into(),
                color: Some(Color(0xFF00_00FF)),
                ..Default::default()
            },
            texture: None,
            extra_children: Vec::new(),
        });
    }
    run(&r, &mut doc, "edit_copy", json!({ "ids": ["src"] }));
    let result = run(
        &r,
        &mut doc,
        "edit_paste_style",
        json!({ "ids": ["same", "other"] }),
    );
    assert_eq!(result["styled"], json!(2));
    let pieces: Vec<&Piece> = doc
        .home()
        .furniture
        .iter()
        .filter_map(|f| match f {
            Furniture::Piece(p) => Some(p.as_ref()),
            _ => None,
        })
        .collect();
    assert_eq!(pieces[1].attrs.color, Some(Color(0xFF12_3456)));
    assert_eq!(pieces[1].materials.len(), 1);
    assert_eq!(pieces[2].attrs.color, Some(Color(0xFF12_3456)));
    assert!(pieces[2].materials.is_empty(), "another model");
}

#[test]
fn label_style_is_pasted() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let source = run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "Big", "x": 0, "y": 0, "font_size": 40, "color": "#FF0000" }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let target = run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "Small", "x": 0, "y": 100 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    run(&r, &mut doc, "edit_copy", json!({ "ids": [source] }));
    let before = snapshot(&doc);
    run(&r, &mut doc, "edit_paste_style", json!({ "ids": [target] }));
    let (src, dst) = (&doc.home().labels[0], &doc.home().labels[1]);
    assert_eq!(dst.text, "Small");
    assert_eq!(dst.attrs.color, src.attrs.color);
    assert_eq!(
        serde_json::to_value(&dst.text_style).unwrap(),
        serde_json::to_value(&src.text_style).unwrap()
    );
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}
