//! Tests of the edit commands: edit_copy, edit_paste, edit_duplicate, edit_move,
//! edit_delete, edit_undo and edit_redo.

mod common;

use common::*;
use msh_core::{Document, Registry};
use msh_model::{Furniture, FurnitureGroup, GroupAttrs, Piece, PieceAttrs, WallAttrs};
use serde_json::{Value, json};

fn wall(doc: &Document, id: &str) -> WallAttrs {
    doc.home()
        .walls
        .iter()
        .find(|w| w.attrs.id == id)
        .unwrap_or_else(|| panic!("no wall {id}"))
        .attrs
        .clone()
}

fn id_of(v: Value) -> String {
    v["id"].as_str().unwrap().to_owned()
}

fn piece(id: &str, x: f32, y: f32) -> Furniture {
    Furniture::Piece(Box::new(Piece {
        attrs: PieceAttrs {
            id: Some(id.into()),
            name: id.into(),
            x,
            y,
            width: 50.0,
            depth: 50.0,
            height: 50.0,
            ..Default::default()
        },
        ..Default::default()
    }))
}

fn piece_pos(doc: &Document, id: &str) -> (f32, f32) {
    let mut pos = None;
    doc.home().for_each_piece(|p| {
        if p.attrs.id.as_deref() == Some(id) {
            pos = Some((p.attrs.x, p.attrs.y));
        }
    });
    pos.unwrap_or_else(|| panic!("no piece {id}"))
}

/// One element of every kind; returns their IDs (wall, room, label, dimension, polyline, piece).
fn one_of_each(r: &Registry, doc: &mut Document) -> Vec<String> {
    let wall = id_of(run(
        r,
        doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 300, "y_end": 0 }),
    ));
    let room = id_of(run(
        r,
        doc,
        "room_add",
        json!({ "points": [[0, 0], [100, 0], [100, 100]] }),
    ));
    let label = id_of(run(
        r,
        doc,
        "label_add",
        json!({ "text": "L", "x": 10, "y": 20 }),
    ));
    let dim = id_of(run(
        r,
        doc,
        "dimension_add",
        json!({ "x_start": 0, "y_start": 50, "x_end": 100, "y_end": 50 }),
    ));
    let line = id_of(run(
        r,
        doc,
        "polyline_add",
        json!({ "points": [[0, 0], [50, 50]] }),
    ));
    doc.home_mut().furniture.push(piece("chair", 200.0, 200.0));
    vec![wall, room, label, dim, line, "chair".into()]
}

// ---------------------------------------------------------------- edit_copy

#[test]
fn copy_counts_the_elements_and_does_not_change_the_home() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let all = one_of_each(&r, &mut doc);
    let before = snapshot(&doc);
    let res = run(&r, &mut doc, "edit_copy", json!({ "ids": all }));
    assert_eq!(res, json!({ "copied": 6 }));
    assert_eq!(snapshot(&doc), before);
    run(&r, &mut doc, "edit_undo", json!({}));
    assert_eq!(
        doc.home().labels.len(),
        1,
        "undo skips the copy and removes the polyline"
    );
    assert!(doc.home().polylines.is_empty());
}

#[test]
fn copy_of_unknown_ids_fails_and_keeps_the_clipboard() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let all = one_of_each(&r, &mut doc);
    run(&r, &mut doc, "edit_copy", json!({ "ids": [all[2]] }));
    let err = run_err(&r, &mut doc, "edit_copy", json!({ "ids": ["nope"] }));
    assert!(err.contains("no element found"), "{err}");
    run_err(&r, &mut doc, "edit_copy", json!({ "ids": [] }));
    let clip = doc.clipboard.as_ref().unwrap();
    assert_eq!(clip.labels.len(), 1, "previous clipboard kept");
}

// ---------------------------------------------------------------- edit_paste

#[test]
fn paste_offsets_copies_while_the_originals_exist() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let all = one_of_each(&r, &mut doc);
    run(
        &r,
        &mut doc,
        "edit_copy",
        json!({ "ids": [all[0], all[2]] }),
    );

    let before = snapshot(&doc);
    let res = run(&r, &mut doc, "edit_paste", json!({}));
    let new = ids(&res, "ids");
    assert_eq!(new.len(), 2);
    assert!(!new.contains(&all[0]) && !new.contains(&all[2]), "new IDs");
    let w = wall(&doc, &new[0]);
    assert_eq!(
        (w.x_start, w.y_start, w.x_end, w.y_end),
        (20.0, 20.0, 320.0, 20.0)
    );
    let l = &doc.home().labels[1].attrs;
    assert_eq!((l.x, l.y), (30.0, 40.0));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    // Explicit offset
    let res = run(&r, &mut doc, "edit_paste", json!({ "dx": -5 }));
    let w = wall(&doc, &ids(&res, "ids")[0]);
    assert_eq!((w.x_start, w.y_start), (-5.0, 0.0), "missing dy is 0");

    // Without the originals the copies keep their position
    let mut other = new_doc(&r);
    other.clipboard = doc.clipboard.take();
    let res = run(&r, &mut other, "edit_paste", json!({}));
    let w = wall(&other, &ids(&res, "ids")[0]);
    assert_eq!((w.x_start, w.y_start), (0.0, 0.0));

    let reopened = save_and_reopen(&r, &mut other, "edit_paste");
    assert_eq!(reopened.home().walls.len(), 1);
    assert_eq!(reopened.home().labels[0].text, "L");
}

#[test]
fn paste_keeps_only_joins_between_copied_walls() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let w = ids(
        &run(
            &r,
            &mut doc,
            "wall_add_path",
            json!({ "points": [[0, 0], [300, 0], [300, 300], [0, 300]] }),
        ),
        "ids",
    );
    run(&r, &mut doc, "edit_copy", json!({ "ids": [w[0], w[1]] }));
    let new = ids(&run(&r, &mut doc, "edit_paste", json!({})), "ids");
    let (a, b) = (wall(&doc, &new[0]), wall(&doc, &new[1]));
    assert_eq!(a.wall_at_end.as_deref(), Some(new[1].as_str()));
    assert_eq!(b.wall_at_start.as_deref(), Some(new[0].as_str()));
    assert_eq!(b.wall_at_end, None, "the third wall was not copied");
    assert_eq!(a.wall_at_start, None);
}

#[test]
fn paste_on_a_level_and_invalid_paste() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let err = run_err(&r, &mut doc, "edit_paste", json!({}));
    assert!(err.contains("clipboard is empty"), "{err}");

    let label = id_of(run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "L", "x": 0, "y": 0 }),
    ));
    run(&r, &mut doc, "level_add", json!({ "name": "Upper" }));
    let l0 = doc.home().levels[0].attrs.id.clone();
    let upper = doc.home().levels[1].attrs.id.clone();
    run(&r, &mut doc, "edit_copy", json!({ "ids": [label] }));
    run(&r, &mut doc, "edit_paste", json!({}));
    assert_eq!(
        doc.home().labels[1].attrs.level.as_deref(),
        Some(upper.as_str()),
        "selected level by default"
    );
    run(&r, &mut doc, "edit_paste", json!({ "level": l0 }));
    assert_eq!(
        doc.home().labels[2].attrs.level.as_deref(),
        Some(l0.as_str())
    );
    run_err(&r, &mut doc, "edit_paste", json!({ "level": "level-nope" }));
}

#[test]
fn paste_on_another_level_keeps_the_position() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let ground = id_of(run(&r, &mut doc, "level_add", json!({ "name": "Ground" })));
    let w = ids(
        &run(
            &r,
            &mut doc,
            "wall_add_path",
            json!({ "points": [[0, 0], [400, 0], [400, 300]] }),
        ),
        "ids",
    );
    assert_eq!(wall(&doc, &w[0]).level.as_deref(), Some(ground.as_str()));
    let upper = id_of(run(&r, &mut doc, "level_add", json!({ "name": "Upper" })));
    run(&r, &mut doc, "edit_copy", json!({ "ids": w }));

    // On the level above the copies lie exactly over the originals
    let new = ids(&run(&r, &mut doc, "edit_paste", json!({})), "ids");
    let a = wall(&doc, &new[0]);
    assert_eq!(a.level.as_deref(), Some(upper.as_str()));
    assert_eq!(
        (a.x_start, a.y_start, a.x_end, a.y_end),
        (0.0, 0.0, 400.0, 0.0)
    );
    let b = wall(&doc, &new[1]);
    assert_eq!((b.x_end, b.y_end), (400.0, 300.0));

    // On their own level they are moved, so they do not hide the originals
    let new = ids(
        &run(&r, &mut doc, "edit_paste", json!({ "level": ground })),
        "ids",
    );
    let a = wall(&doc, &new[0]);
    assert_eq!((a.x_start, a.y_start), (20.0, 20.0));
}

// ---------------------------------------------------------------- edit_duplicate

#[test]
fn duplicate_copies_on_the_same_level_without_touching_the_clipboard() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(&r, &mut doc, "level_add", json!({ "name": "Ground" }));
    let ground = doc.home().attrs.selected_level.clone();
    let room = id_of(run(
        &r,
        &mut doc,
        "room_add",
        json!({ "points": [[0, 0], [100, 0], [100, 100]], "name": "R" }),
    ));
    run(&r, &mut doc, "level_add", json!({ "name": "Upper" }));

    let before = snapshot(&doc);
    let res = run(&r, &mut doc, "edit_duplicate", json!({ "ids": [room] }));
    let new = ids(&res, "ids");
    assert_eq!(new.len(), 1);
    let copy = doc.home().rooms[1].clone();
    assert_eq!(copy.attrs.id.as_deref(), Some(new[0].as_str()));
    assert_eq!(copy.attrs.level, ground, "on the level of the original");
    assert_eq!((copy.points[0].x, copy.points[0].y), (20.0, 20.0));
    assert_eq!(copy.attrs.name.as_deref(), Some("R"));
    assert!(doc.clipboard.is_none());
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    run(
        &r,
        &mut doc,
        "edit_duplicate",
        json!({ "ids": [room], "dx": 0, "dy": -50 }),
    );
    let p = &doc.home().rooms[2].points[0];
    assert_eq!((p.x, p.y), (0.0, -50.0));

    let err = run_err(&r, &mut doc, "edit_duplicate", json!({ "ids": ["nope"] }));
    assert!(err.contains("no element found"), "{err}");
}

// ---------------------------------------------------------------- edit_move

#[test]
fn move_shifts_every_kind_of_element() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let all = one_of_each(&r, &mut doc);
    doc.home_mut()
        .furniture
        .push(Furniture::Group(Box::new(FurnitureGroup {
            attrs: GroupAttrs {
                id: Some("group".into()),
                name: "Group".into(),
                x: Some(500.0),
                y: Some(500.0),
                ..Default::default()
            },
            items: vec![piece("inner", 500.0, 500.0)],
            properties: Vec::new(),
            text_style: None,
            extra_children: Vec::new(),
        })));
    let mut targets = all.clone();
    targets.push("group".into());
    targets.push("nope".into());

    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "edit_move",
        json!({ "ids": targets, "dx": 10, "dy": -5 }),
    );
    assert_eq!(res, json!({ "moved": 7 }), "unknown IDs are ignored");
    let home = doc.home();
    let w = &home.walls[0].attrs;
    assert_eq!(
        (w.x_start, w.y_start, w.x_end, w.y_end),
        (10.0, -5.0, 310.0, -5.0)
    );
    assert_eq!(
        (home.rooms[0].points[1].x, home.rooms[0].points[1].y),
        (110.0, -5.0)
    );
    assert_eq!(
        (home.labels[0].attrs.x, home.labels[0].attrs.y),
        (20.0, 15.0)
    );
    let d = &home.dimension_lines[0].attrs;
    assert_eq!(
        (d.x_start, d.y_start, d.x_end, d.y_end),
        (10.0, 45.0, 110.0, 45.0)
    );
    assert_eq!(
        (home.polylines[0].points[1].x, home.polylines[0].points[1].y),
        (60.0, 45.0)
    );
    assert_eq!(piece_pos(&doc, "chair"), (210.0, 195.0));
    assert_eq!(
        piece_pos(&doc, "inner"),
        (510.0, 495.0),
        "group content moves"
    );
    match &doc.home().furniture[1] {
        Furniture::Group(g) => assert_eq!((g.attrs.x, g.attrs.y), (Some(510.0), Some(495.0))),
        Furniture::Piece(_) => panic!("group expected"),
    }
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn move_of_unknown_ids_fails() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    one_of_each(&r, &mut doc);
    let err = run_err(
        &r,
        &mut doc,
        "edit_move",
        json!({ "ids": ["nope"], "dx": 1, "dy": 1 }),
    );
    assert!(err.contains("no element found"), "{err}");
    run_err(
        &r,
        &mut doc,
        "edit_move",
        json!({ "ids": [], "dx": 1, "dy": 1 }),
    );
    run_err(
        &r,
        &mut doc,
        "edit_move",
        json!({ "ids": ["chair"], "dx": 1 }),
    );
}

// ---------------------------------------------------------------- edit_delete

#[test]
fn delete_removes_elements_and_reports_missing_ones() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let all = one_of_each(&r, &mut doc);
    let mut targets = all.clone();
    targets.push("nope".into());
    let before = snapshot(&doc);
    let res = run(&r, &mut doc, "edit_delete", json!({ "ids": targets }));
    assert_eq!(res["deleted"], json!(all));
    assert_eq!(res["not_found"], json!(["nope"]));
    let home = doc.home();
    assert!(home.walls.is_empty() && home.rooms.is_empty() && home.labels.is_empty());
    assert!(home.dimension_lines.is_empty() && home.polylines.is_empty());
    assert!(home.furniture.is_empty());
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "edit_delete");
    assert!(reopened.home().walls.is_empty() && reopened.home().labels.is_empty());
}

#[test]
fn delete_of_unknown_ids_fails() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    one_of_each(&r, &mut doc);
    let err = run_err(
        &r,
        &mut doc,
        "edit_delete",
        json!({ "ids": ["nope", "other"] }),
    );
    assert!(err.contains("no element found"), "{err}");
    run_err(&r, &mut doc, "edit_delete", json!({ "ids": [] }));
}

#[test]
fn delete_wall_clears_the_joins_of_its_neighbors() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let w = ids(
        &run(
            &r,
            &mut doc,
            "wall_add_path",
            json!({ "points": [[0, 0], [300, 0], [300, 300]] }),
        ),
        "ids",
    );
    run(&r, &mut doc, "edit_delete", json!({ "ids": [w[1]] }));
    assert_eq!(wall(&doc, &w[0]).wall_at_end, None);
}

#[test]
fn delete_level_removes_its_elements_and_selects_another_level() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "Down", "x": 0, "y": 0 }),
    );
    let upper = id_of(run(&r, &mut doc, "level_add", json!({ "name": "Upper" })));
    let l0 = doc.home().levels[0].attrs.id.clone();
    run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "Up", "x": 0, "y": 0 }),
    );
    run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 100, "y_end": 0 }),
    );
    doc.home_mut().furniture.push(piece("lamp", 0.0, 0.0));
    if let Furniture::Piece(p) = &mut doc.home_mut().furniture[0] {
        p.attrs.level = Some(upper.clone());
    }

    let before = snapshot(&doc);
    run(&r, &mut doc, "edit_delete", json!({ "ids": [upper] }));
    let home = doc.home();
    assert_eq!(home.levels.len(), 1);
    assert!(home.walls.is_empty() && home.furniture.is_empty());
    assert_eq!(home.labels.len(), 1);
    assert_eq!(home.labels[0].text, "Down");
    assert_eq!(home.attrs.selected_level.as_deref(), Some(l0.as_str()));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn delete_compass_hides_it() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(&r, &mut doc, "compass_update", json!({ "visible": true }));
    let res = run(&r, &mut doc, "edit_delete", json!({ "ids": ["compass"] }));
    assert_eq!(res["deleted"], json!(["compass"]));
    let c = doc.home().compass.as_ref().unwrap();
    assert_eq!(c.attrs.visible, Some(false), "hidden, not removed");
    // Already hidden: nothing to delete
    run_err(&r, &mut doc, "edit_delete", json!({ "ids": ["compass"] }));
}

#[test]
fn delete_piece_inside_a_group() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    doc.home_mut()
        .furniture
        .push(Furniture::Group(Box::new(FurnitureGroup {
            attrs: GroupAttrs {
                id: Some("group".into()),
                name: "Group".into(),
                ..Default::default()
            },
            items: vec![piece("a", 0.0, 0.0), piece("b", 100.0, 0.0)],
            properties: Vec::new(),
            text_style: None,
            extra_children: Vec::new(),
        })));
    let res = run(&r, &mut doc, "edit_delete", json!({ "ids": ["a"] }));
    assert_eq!(res["deleted"], json!(["a"]));
    assert_eq!(doc.home().piece_count(), 1);
    assert_eq!(doc.home().furniture.len(), 1, "the group stays");
}

// ---------------------------------------------------------------- edit_undo / edit_redo

#[test]
fn undo_and_redo_report_the_command_and_fail_when_empty() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let err = run_err(&r, &mut doc, "edit_undo", json!({}));
    assert!(err.contains("nothing to undo"), "{err}");
    let err = run_err(&r, &mut doc, "edit_redo", json!({}));
    assert!(err.contains("nothing to redo"), "{err}");

    run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "A", "x": 0, "y": 0 }),
    );
    let res = run(&r, &mut doc, "edit_undo", json!({}));
    assert_eq!(res, json!({ "undone": "label_add" }));
    assert!(doc.can_redo());
    let res = run(&r, &mut doc, "edit_redo", json!({}));
    assert_eq!(res, json!({ "redone": "label_add" }));
    assert_eq!(doc.home().labels.len(), 1);

    // A new change after an undo discards the redo history
    run(&r, &mut doc, "edit_undo", json!({}));
    run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "B", "x": 0, "y": 0 }),
    );
    assert!(!doc.can_redo());
    run_err(&r, &mut doc, "edit_redo", json!({}));
    assert_eq!(doc.home().labels[0].text, "B");
}

#[test]
fn failed_commands_do_not_disturb_the_redo_history() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "A", "x": 0, "y": 0 }),
    );
    run(&r, &mut doc, "edit_undo", json!({}));
    run_err(
        &r,
        &mut doc,
        "edit_move",
        json!({ "ids": ["nope"], "dx": 1, "dy": 1 }),
    );
    assert!(doc.can_redo(), "a failed command keeps the redo step");
    run(&r, &mut doc, "edit_redo", json!({}));
    assert_eq!(doc.home().labels.len(), 1);
}
