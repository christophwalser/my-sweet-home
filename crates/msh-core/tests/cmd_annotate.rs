//! Tests of labels, dimension lines and polylines: label_add, label_update, dimension_add,
//! dimension_add_height, dimension_update, polyline_add and polyline_update.

mod common;

use common::*;
use msh_core::{Document, Registry};
use msh_model::Color;
use serde_json::{Value, json};

fn id_of(v: Value) -> String {
    v["id"].as_str().unwrap().to_owned()
}

fn add_label(r: &Registry, doc: &mut Document) -> String {
    id_of(run(
        r,
        doc,
        "label_add",
        json!({ "text": "Hall", "x": 10, "y": 20 }),
    ))
}

fn add_dimension(r: &Registry, doc: &mut Document) -> String {
    id_of(run(
        r,
        doc,
        "dimension_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 300, "y_end": 0 }),
    ))
}

fn add_polyline(r: &Registry, doc: &mut Document) -> String {
    id_of(run(
        r,
        doc,
        "polyline_add",
        json!({ "points": [[0, 0], [100, 0], [100, 100]] }),
    ))
}

// ---------------------------------------------------------------- label_add

#[test]
fn label_add_with_options_is_undoable_and_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let id = id_of(run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "Line 1\nLine 2", "x": 50, "y": -20, "font_size": 30,
                "angle_deg": 45, "color": "#FF0000" }),
    ));
    assert!(id.starts_with("label-"), "{id}");
    let l = doc.home().labels[0].clone();
    assert_eq!(l.text, "Line 1\nLine 2");
    assert_eq!((l.attrs.x, l.attrs.y), (50.0, -20.0));
    assert!(close(l.attrs.angle.unwrap(), 45f32.to_radians()));
    assert_eq!(l.attrs.color, Some(Color(0xFFFF_0000)));
    assert_eq!(l.text_style.as_ref().unwrap().font_size, 30.0);
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "label_add");
    let l = &reopened.home().labels[0];
    assert_eq!(l.attrs.id.as_deref(), Some(id.as_str()));
    assert_eq!(l.text, "Line 1\nLine 2");
    assert_eq!(l.attrs.color, Some(Color(0xFFFF_0000)));
    assert!(close(l.attrs.angle.unwrap(), 45f32.to_radians()));
    assert_eq!(l.text_style.as_ref().unwrap().font_size, 30.0);
}

#[test]
fn label_add_defaults() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    add_label(&r, &mut doc);
    let l = &doc.home().labels[0];
    assert_eq!((l.attrs.angle, l.attrs.color), (None, None));
    assert!(l.text_style.is_none(), "default style");
    assert_eq!(l.attrs.level, None);
}

#[test]
fn label_add_rejects_invalid_input() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let err = run_err(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "A", "x": 0, "y": 0, "color": "#ZZ0000" }),
    );
    assert!(err.contains("invalid color"), "{err}");
    run_err(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "A", "x": 0, "y": 0, "level": "level-nope" }),
    );
    run_err(&r, &mut doc, "label_add", json!({ "x": 0, "y": 0 }));
    // The same rules as label_update
    let err = run_err(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": " ", "x": 0, "y": 0 }),
    );
    assert!(err.contains("must not be empty"), "{err}");
    for size in [0, -3] {
        let err = run_err(
            &r,
            &mut doc,
            "label_add",
            json!({ "text": "A", "x": 0, "y": 0, "font_size": size }),
        );
        assert!(err.contains("font size"), "{err}");
    }
}

// ---------------------------------------------------------------- label_update

#[test]
fn label_update_changes_text_position_angle_and_color() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_label(&r, &mut doc);
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "label_update",
        json!({ "id": id, "text": "Kitchen", "x": -5, "y": 7, "angle_deg": 90,
                "color": "#00ff00", "font_size": 25 }),
    );
    assert_eq!(res, json!({ "id": id }));
    let l = doc.home().labels[0].clone();
    assert_eq!(l.text, "Kitchen");
    assert_eq!((l.attrs.x, l.attrs.y), (-5.0, 7.0));
    assert!(close(l.attrs.angle.unwrap(), 90f32.to_radians()));
    assert_eq!(l.attrs.color, Some(Color(0xFF00_FF00)));
    assert_eq!(l.text_style.unwrap().font_size, 25.0);
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "label_update");
    let l = &reopened.home().labels[0];
    assert_eq!(l.text, "Kitchen");
    assert_eq!((l.attrs.x, l.attrs.y), (-5.0, 7.0));
    assert_eq!(l.attrs.color, Some(Color(0xFF00_FF00)));
}

#[test]
fn label_update_rejects_invalid_input() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_label(&r, &mut doc);
    let cases = [
        (json!({ "id": "label-nope", "x": 1 }), "unknown label"),
        (json!({ "id": id, "text": "   " }), "must not be empty"),
        (json!({ "id": id, "text": "" }), "must not be empty"),
        (
            json!({ "id": id, "x": 99, "color": "green" }),
            "invalid color",
        ),
        (json!({ "id": id, "font_size": 0 }), "font size"),
        (json!({ "id": id, "x": 5, "font_size": -1 }), "font size"),
    ];
    for (p, msg) in cases {
        let err = run_err(&r, &mut doc, "label_update", p.clone());
        assert!(err.contains(msg), "{p}: {err}");
    }
}

// ---------------------------------------------------------------- dimension_add

#[test]
fn dimension_add_is_undoable_and_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let id = add_dimension(&r, &mut doc);
    assert!(id.starts_with("dimensionLine-"), "{id}");
    let d = doc.home().dimension_lines[0].attrs.clone();
    assert_eq!(
        (d.x_start, d.y_start, d.x_end, d.y_end),
        (0.0, 0.0, 300.0, 0.0)
    );
    assert_eq!(d.offset, 20.0, "default offset");
    assert_eq!((d.elevation_start, d.elevation_end), (None, None));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let id2 = id_of(run(
        &r,
        &mut doc,
        "dimension_add",
        json!({ "x_start": 10, "y_start": 10, "x_end": 10, "y_end": 210, "offset": -35 }),
    ));
    let reopened = save_and_reopen(&r, &mut doc, "dimension_add");
    let lines = &reopened.home().dimension_lines;
    assert_eq!(lines.len(), 2);
    let d2 = lines
        .iter()
        .find(|d| d.attrs.id.as_deref() == Some(id2.as_str()))
        .unwrap();
    assert_eq!((d2.attrs.y_end, d2.attrs.offset), (210.0, -35.0));
}

#[test]
fn dimension_add_rejects_invalid_input() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run_err(
        &r,
        &mut doc,
        "dimension_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 1, "y_end": 0, "level": "level-nope" }),
    );
    run_err(
        &r,
        &mut doc,
        "dimension_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 1 }),
    );
}

// ---------------------------------------------------------------- dimension_update

#[test]
fn dimension_update_changes_points_and_offset() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_dimension(&r, &mut doc);
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "dimension_update",
        json!({ "id": id, "x_end": 450, "y_start": -10, "offset": 40 }),
    );
    assert_eq!(res, json!({ "id": id }));
    let d = doc.home().dimension_lines[0].clone();
    assert_eq!(
        (
            d.attrs.x_start,
            d.attrs.y_start,
            d.attrs.x_end,
            d.attrs.y_end
        ),
        (0.0, -10.0, 450.0, 0.0)
    );
    assert_eq!(d.attrs.offset, 40.0);
    assert!(d.text_style.is_none(), "no style without style changes");
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "dimension_update");
    let d = &reopened.home().dimension_lines[0].attrs;
    assert_eq!((d.y_start, d.x_end, d.offset), (-10.0, 450.0, 40.0));
}

#[test]
fn dimension_update_unknown_id_fails() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    add_dimension(&r, &mut doc);
    let err = run_err(
        &r,
        &mut doc,
        "dimension_update",
        json!({ "id": "dimensionLine-nope", "offset": 5 }),
    );
    assert!(err.contains("unknown dimension line"), "{err}");
    run_err(&r, &mut doc, "dimension_update", json!({ "offset": 5 }));
}

// ---------------------------------------------------------------- dimension_add_height

#[test]
fn dimension_add_height_with_start_and_offset_is_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let id = id_of(run(
        &r,
        &mut doc,
        "dimension_add_height",
        json!({ "x": 100, "y": 50, "elevation_start": 80, "elevation_end": 210, "offset": 35 }),
    ));
    let d = doc.home().dimension_lines[0].attrs.clone();
    assert_eq!(d.id.as_deref(), Some(id.as_str()));
    assert_eq!(
        (d.elevation_start, d.elevation_end),
        (Some(80.0), Some(210.0))
    );
    assert_eq!((d.offset, d.visible_in_3d), (35.0, Some(true)));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "dimension_add_height");
    let d = &reopened.home().dimension_lines[0].attrs;
    assert_eq!(
        (d.x_start, d.y_start, d.x_end, d.y_end),
        (100.0, 50.0, 100.0, 50.0)
    );
    assert_eq!(
        (d.elevation_start, d.elevation_end),
        (Some(80.0), Some(210.0))
    );
    assert_eq!((d.offset, d.visible_in_3d), (35.0, Some(true)));
}

#[test]
fn dimension_add_height_measures_downwards_too() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "dimension_add_height",
        json!({ "x": 0, "y": 0, "elevation_start": 200, "elevation_end": 50 }),
    );
    let d = &doc.home().dimension_lines[0].attrs;
    assert_eq!(
        (d.elevation_start, d.elevation_end, d.offset),
        (Some(200.0), Some(50.0), 20.0)
    );
}

#[test]
fn dimension_add_height_rejects_tiny_heights_and_unknown_levels() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let err = run_err(
        &r,
        &mut doc,
        "dimension_add_height",
        json!({ "x": 0, "y": 0, "elevation_start": 100, "elevation_end": 100.05 }),
    );
    assert!(err.contains("at least 0.1"), "{err}");
    run_err(
        &r,
        &mut doc,
        "dimension_add_height",
        json!({ "x": 0, "y": 0, "elevation_end": 100, "level": "level-nope" }),
    );
    run_err(
        &r,
        &mut doc,
        "dimension_add_height",
        json!({ "x": 0, "y": 0 }),
    );
}

// ---------------------------------------------------------------- polyline_add

#[test]
fn polyline_add_defaults_are_undoable_and_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let id = add_polyline(&r, &mut doc);
    assert!(id.starts_with("polyline-"), "{id}");
    let p = doc.home().polylines[0].clone();
    let a = &p.attrs;
    assert_eq!(a.thickness, Some(2.0));
    assert_eq!(a.cap_style.as_deref(), Some("BUTT"));
    assert_eq!(a.join_style.as_deref(), Some("MITER"));
    assert_eq!(a.dash_style.as_deref(), Some("SOLID"));
    assert_eq!(a.start_arrow_style.as_deref(), Some("NONE"));
    assert_eq!(a.end_arrow_style.as_deref(), Some("NONE"));
    assert_eq!(a.color, Some(Color(0xFF00_0000)), "black");
    assert_eq!(a.closed_path, Some(false));
    assert_eq!(p.points.len(), 3);
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "polyline_add_defaults");
    let a = &reopened.home().polylines[0].attrs;
    assert_eq!(a.thickness, Some(2.0));
    assert_eq!(a.color, Some(Color(0xFF00_0000)));
    assert_eq!(reopened.home().polylines[0].points.len(), 3);
}

#[test]
fn polyline_add_options_are_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "polyline_add",
        json!({
            "points": [[0, 0], [100, 0], [50, 80]], "closed": true, "thickness": 5,
            "color": "#123456", "dash_style": "DASH_DOT", "start_arrow": "DISC",
            "end_arrow": "DELTA"
        }),
    );
    let check = |doc: &Document| {
        let a = &doc.home().polylines[0].attrs;
        assert_eq!(a.closed_path, Some(true));
        assert_eq!(a.thickness, Some(5.0));
        assert_eq!(a.color, Some(Color(0xFF12_3456)));
        assert_eq!(a.dash_style.as_deref(), Some("DASH_DOT"));
        assert_eq!(a.start_arrow_style.as_deref(), Some("DISC"));
        assert_eq!(a.end_arrow_style.as_deref(), Some("DELTA"));
    };
    check(&doc);
    let reopened = save_and_reopen(&r, &mut doc, "polyline_add_options");
    check(&reopened);

    // Two points cannot form a closed path
    run(
        &r,
        &mut doc,
        "polyline_add",
        json!({ "points": [[0, 0], [100, 0]], "closed": true }),
    );
    assert_eq!(doc.home().polylines[1].attrs.closed_path, Some(false));
}

#[test]
fn polyline_add_rejects_invalid_input() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let two = json!([[0, 0], [10, 0]]);
    let cases = [
        json!({ "points": [[0, 0]] }),
        json!({ "points": [] }),
        json!({ "points": two, "color": "black" }),
        json!({ "points": two, "dash_style": "WAVY" }),
        json!({ "points": two, "start_arrow": "delta" }),
        json!({ "points": two, "level": "level-nope" }),
    ];
    for p in cases {
        run_err(&r, &mut doc, "polyline_add", p);
    }
}

// ---------------------------------------------------------------- polyline_update

#[test]
fn polyline_update_shows_the_polyline_in_3d() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_polyline(&r, &mut doc);
    assert_eq!(doc.home().polylines[0].attrs.elevation, None);
    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "polyline_update",
        json!({ "id": id, "visible_in_3d": true }),
    );
    assert_eq!(doc.home().polylines[0].attrs.elevation, Some(0.0));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "polyline_visible_in_3d");
    assert_eq!(reopened.home().polylines[0].attrs.elevation, Some(0.0));

    run(
        &r,
        &mut doc,
        "polyline_update",
        json!({ "id": id, "visible_in_3d": false }),
    );
    assert_eq!(doc.home().polylines[0].attrs.elevation, None);
}

#[test]
fn polyline_update_changes_all_properties() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_polyline(&r, &mut doc);
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "polyline_update",
        json!({
            "id": id, "points": [[5, 5], [50, 5], [30, 40]], "closed": true, "thickness": 8,
            "color": "#ABCDEF", "dash_style": "DOT", "start_arrow": "OPEN", "end_arrow": "DISC"
        }),
    );
    assert_eq!(res, json!({ "id": id }));
    let p = doc.home().polylines[0].clone();
    let pts: Vec<_> = p.points.iter().map(|pt| (pt.x, pt.y)).collect();
    assert_eq!(pts, [(5.0, 5.0), (50.0, 5.0), (30.0, 40.0)]);
    let a = &p.attrs;
    assert_eq!((a.closed_path, a.thickness), (Some(true), Some(8.0)));
    assert_eq!(a.color, Some(Color(0xFFAB_CDEF)));
    assert_eq!(a.dash_style.as_deref(), Some("DOT"));
    assert_eq!(a.start_arrow_style.as_deref(), Some("OPEN"));
    assert_eq!(a.end_arrow_style.as_deref(), Some("DISC"));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "polyline_update");
    let p = &reopened.home().polylines[0];
    assert_eq!(p.points.len(), 3);
    assert_eq!(p.attrs.dash_style.as_deref(), Some("DOT"));
    assert_eq!(p.attrs.color, Some(Color(0xFFAB_CDEF)));
}

#[test]
fn polyline_update_keeps_two_points_open() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_polyline(&r, &mut doc);
    run(
        &r,
        &mut doc,
        "polyline_update",
        json!({ "id": id, "points": [[0, 0], [100, 0]], "closed": true }),
    );
    assert_eq!(doc.home().polylines[0].attrs.closed_path, Some(false));
}

#[test]
fn polyline_update_rejects_invalid_input() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_polyline(&r, &mut doc);
    let cases = [
        (
            json!({ "id": "polyline-nope", "thickness": 3 }),
            "unknown polyline",
        ),
        (json!({ "id": id, "points": [[0, 0]] }), "at least 2"),
        (
            json!({ "id": id, "thickness": 4, "color": "#12" }),
            "invalid color",
        ),
        (
            json!({ "id": id, "end_arrow": "ARROW" }),
            "invalid parameters",
        ),
    ];
    for (p, msg) in cases {
        let err = run_err(&r, &mut doc, "polyline_update", p.clone());
        assert!(err.contains(msg), "{p}: {err}");
    }
}
