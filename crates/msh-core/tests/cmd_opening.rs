//! Floor openings: opening_add, opening_update and what furniture_update does with them.

mod common;

use common::{check_undo_redo, close, new_doc, run, run_err, save_and_reopen, snapshot};
use msh_core::{Document, Registry};
use msh_model::Piece;
use serde_json::json;

fn piece(doc: &Document, id: &str) -> Piece {
    let mut found = None;
    doc.home().for_each_piece(|p| {
        if p.attrs.id.as_deref() == Some(id) {
            found = Some(p.clone());
        }
    });
    found.unwrap_or_else(|| panic!("no piece {id}"))
}

fn model_text(doc: &Document, id: &str) -> String {
    let model = piece(doc, id).attrs.model.expect("the piece has no model");
    let entry = doc
        .file
        .contents
        .iter()
        .find(|c| c.name == model)
        .unwrap_or_else(|| panic!("the home has no resource {model}"));
    String::from_utf8(entry.data.clone()).unwrap()
}

/// A home with two levels and the ID of the upper one (its floor 12 cm thick).
fn two_levels(r: &Registry) -> (Document, String) {
    let mut doc = new_doc(r);
    run(r, &mut doc, "level_add", json!({ "name": "Upper floor" }));
    let upper = doc.home().levels[1].attrs.id.clone();
    (doc, upper)
}

fn add_opening(r: &Registry, doc: &mut Document, level: &str) -> String {
    let added = run(
        r,
        doc,
        "opening_add",
        json!({
            "points": [[100, 100], [300, 100], [300, 250], [100, 250]],
            "level": level,
        }),
    );
    added["id"].as_str().unwrap().to_owned()
}

#[test]
fn opening_add_cuts_the_floor_and_the_ceiling_below() {
    let r = Registry::standard();
    let (mut doc, upper) = two_levels(&r);
    let before = snapshot(&doc);
    let id = add_opening(&r, &mut doc, &upper);
    let after = snapshot(&doc);
    let p = piece(&doc, &id);
    let a = &p.attrs;
    assert_eq!(a.level.as_deref(), Some(upper.as_str()));
    assert!(close(a.x, 200.0) && close(a.y, 175.0));
    assert!(close(a.width, 200.0) && close(a.depth, 150.0));
    // From 2 cm below the floor slab up to the floor
    assert_eq!(a.elevation, Some(-14.0));
    assert!(close(a.height, 14.0));
    assert_eq!(
        a.staircase_cut_out_shape.as_deref(),
        Some("M0,0 L1,0 L1,1 L0,1 Z")
    );
    assert_eq!(a.movable, Some(false));
    // The model is the edge of the hole: two triangles for each side
    let model = model_text(&doc, &id);
    assert_eq!(model.lines().filter(|l| l.starts_with("f ")).count(), 8);
    assert!(model.contains("usemtl opening_edge"));
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn opening_follows_new_corners_and_sizes() {
    let r = Registry::standard();
    let (mut doc, upper) = two_levels(&r);
    let id = add_opening(&r, &mut doc, &upper);
    run(
        &r,
        &mut doc,
        "opening_update",
        json!({ "id": id, "width": 300 }),
    );
    let a = piece(&doc, &id).attrs;
    assert!(close(a.width, 300.0) && close(a.depth, 150.0));
    assert!(close(a.x, 200.0) && close(a.y, 175.0));

    // An L shaped opening keeps its corners in the cut-out
    run(
        &r,
        &mut doc,
        "opening_update",
        json!({ "id": id, "points": [[0, 0], [200, 0], [200, 100], [100, 100], [100, 200], [0, 200]] }),
    );
    let a = piece(&doc, &id).attrs;
    assert!(close(a.width, 200.0) && close(a.depth, 200.0));
    assert_eq!(
        a.staircase_cut_out_shape.as_deref(),
        Some("M0,0 L1,0 L1,0.5 L0.5,0.5 L0.5,1 L0,1 Z")
    );

    // Resizing the piece stretches the outline; the opening stays below the floor
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "ids": [id], "width": 400 }),
    );
    let a = piece(&doc, &id).attrs;
    assert!(close(a.width, 400.0) && close(a.depth, 200.0));
    assert_eq!(a.elevation, Some(-14.0));
    assert_eq!(
        a.staircase_cut_out_shape.as_deref(),
        Some("M0,0 L1,0 L1,0.5 L0.5,0.5 L0.5,1 L0,1 Z")
    );

    // A thicker floor: the opening reaches deeper on its next change
    run(
        &r,
        &mut doc,
        "level_update",
        json!({ "id": upper, "floor_thickness": 30 }),
    );
    run(
        &r,
        &mut doc,
        "opening_update",
        json!({ "id": id, "depth": 250 }),
    );
    assert_eq!(piece(&doc, &id).attrs.elevation, Some(-32.0));
}

#[test]
fn opening_survives_saving_and_refuses_bad_outlines() {
    let r = Registry::standard();
    let (mut doc, upper) = two_levels(&r);
    let id = add_opening(&r, &mut doc, &upper);
    let mut reopened = save_and_reopen(&r, &mut doc, "opening_saved");
    let a = piece(&reopened, &id).attrs;
    assert_eq!(a.elevation, Some(-14.0));
    assert!(a.staircase_cut_out_shape.is_some());
    run(
        &r,
        &mut reopened,
        "opening_update",
        json!({ "id": id, "depth": 100 }),
    );

    let err = run_err(
        &r,
        &mut reopened,
        "opening_add",
        json!({ "points": [[0, 0], [100, 0]] }),
    );
    assert!(err.contains("at least 3 corners"), "{err}");
    let err = run_err(
        &r,
        &mut reopened,
        "opening_add",
        json!({ "points": [[0, 0], [100, 100], [100, 0], [0, 100]] }),
    );
    assert!(err.contains("cross"), "{err}");
    let stair = run(&r, &mut reopened, "stair_add", json!({ "x": 0, "y": 0 }));
    let err = run_err(
        &r,
        &mut reopened,
        "opening_update",
        json!({ "id": stair["id"], "width": 100 }),
    );
    assert!(err.contains("not a floor opening"), "{err}");
}
