//! Tests of the text style handling shared by label_update, dimension_update and room_update
//! (commands/text.rs). Basic setting and clearing is covered by text_styles.rs.

mod common;

use common::*;
use msh_core::{Document, Registry};
use msh_model::TextStyle;
use serde_json::{Value, json};

fn id_of(v: Value) -> String {
    v["id"].as_str().unwrap().to_owned()
}

/// A label, a dimension line and a room; returns their IDs.
fn elements(r: &Registry, doc: &mut Document) -> (String, String, String) {
    let label = id_of(run(
        r,
        doc,
        "label_add",
        json!({ "text": "Hall", "x": 0, "y": 0 }),
    ));
    let dim = id_of(run(
        r,
        doc,
        "dimension_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 100, "y_end": 0 }),
    ));
    let room = id_of(run(
        r,
        doc,
        "room_add",
        json!({ "points": [[0, 0], [300, 0], [300, 300]], "name": "Kitchen" }),
    ));
    (label, dim, room)
}

fn room_style(doc: &Document, role: &str) -> Option<TextStyle> {
    doc.home().rooms[0]
        .text_styles
        .iter()
        .find(|s| s.role.as_deref() == Some(role))
        .cloned()
}

#[test]
fn updates_without_style_changes_create_no_style() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (label, dim, room) = elements(&r, &mut doc);
    run(&r, &mut doc, "label_update", json!({ "id": label, "x": 5 }));
    run(
        &r,
        &mut doc,
        "dimension_update",
        json!({ "id": dim, "offset": 30 }),
    );
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": room, "name": "Bath" }),
    );
    let home = doc.home();
    assert!(home.labels[0].text_style.is_none());
    assert!(home.dimension_lines[0].text_style.is_none());
    assert!(home.rooms[0].text_styles.is_empty());
}

#[test]
fn new_styles_start_with_the_default_size_of_the_element() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (label, dim, room) = elements(&r, &mut doc);
    run(
        &r,
        &mut doc,
        "label_update",
        json!({ "id": label, "bold": true }),
    );
    run(
        &r,
        &mut doc,
        "dimension_update",
        json!({ "id": dim, "italic": true }),
    );
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": room, "name_italic": true }),
    );
    let home = doc.home();
    let l = home.labels[0].text_style.clone().unwrap();
    assert_eq!(
        (l.font_size, l.bold, l.italic, l.role),
        (18.0, Some(true), None, None)
    );
    let d = home.dimension_lines[0].text_style.clone().unwrap();
    assert_eq!((d.font_size, d.italic, d.bold), (18.0, Some(true), None));
    let name = room_style(&doc, "nameStyle").unwrap();
    assert_eq!((name.font_size, name.italic), (24.0, Some(true)));
    assert!(
        room_style(&doc, "areaStyle").is_none(),
        "the area style is untouched"
    );
}

#[test]
fn font_names_are_trimmed_and_blank_means_default() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (label, _, room) = elements(&r, &mut doc);
    run(
        &r,
        &mut doc,
        "label_update",
        json!({ "id": label, "font_name": "  Verdana  " }),
    );
    assert_eq!(
        doc.home().labels[0]
            .text_style
            .clone()
            .unwrap()
            .font_name
            .as_deref(),
        Some("Verdana")
    );
    run(
        &r,
        &mut doc,
        "label_update",
        json!({ "id": label, "font_name": "   " }),
    );
    assert_eq!(
        doc.home().labels[0].text_style.clone().unwrap().font_name,
        None
    );

    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": room, "area_font_name": " Courier New " }),
    );
    assert_eq!(
        room_style(&doc, "areaStyle").unwrap().font_name.as_deref(),
        Some("Courier New")
    );
}

#[test]
fn partial_style_changes_keep_the_other_values() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let label = id_of(run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "Big", "x": 0, "y": 0, "font_size": 30 }),
    ));
    run(
        &r,
        &mut doc,
        "label_update",
        json!({ "id": label, "italic": true, "font_name": "Arial" }),
    );
    run(
        &r,
        &mut doc,
        "label_update",
        json!({ "id": label, "bold": true }),
    );
    let s = doc.home().labels[0].text_style.clone().unwrap();
    assert_eq!(s.font_size, 30.0, "size given at creation is kept");
    assert_eq!((s.italic, s.bold), (Some(true), Some(true)));
    assert_eq!(s.font_name.as_deref(), Some("Arial"));
    // false removes only that flag; a flag that was never set stays unset
    run(
        &r,
        &mut doc,
        "label_update",
        json!({ "id": label, "italic": false }),
    );
    let s = doc.home().labels[0].text_style.clone().unwrap();
    assert_eq!((s.italic, s.bold), (None, Some(true)));

    let room = id_of(run(
        &r,
        &mut doc,
        "room_add",
        json!({ "points": [[0, 0], [300, 0], [300, 300]] }),
    ));
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": room, "area_font_size": 30 }),
    );
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": room, "area_bold": true, "name_bold": false }),
    );
    let styles = &doc.home().rooms[0].text_styles;
    let areas: Vec<_> = styles
        .iter()
        .filter(|s| s.role.as_deref() == Some("areaStyle"))
        .collect();
    assert_eq!(areas.len(), 1, "the role style is reused");
    assert_eq!((areas[0].font_size, areas[0].bold), (30.0, Some(true)));
    let name = room_style(&doc, "nameStyle").unwrap();
    assert_eq!((name.font_size, name.bold), (24.0, None));
}

#[test]
fn invalid_font_sizes_leave_everything_unchanged() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (label, dim, room) = elements(&r, &mut doc);
    let cases = [
        (
            "label_update",
            json!({ "id": label, "bold": true, "font_size": -2 }),
        ),
        (
            "dimension_update",
            json!({ "id": dim, "offset": 50, "font_size": -5 }),
        ),
        ("dimension_update", json!({ "id": dim, "font_size": 0 })),
        (
            "room_update",
            json!({ "id": room, "name_bold": true, "name_font_size": -1 }),
        ),
        (
            "room_update",
            json!({ "id": room, "name": "X", "area_font_size": 0 }),
        ),
    ];
    for (cmd, p) in cases {
        let err = run_err(&r, &mut doc, cmd, p);
        assert!(err.contains("font size must be positive"), "{cmd}: {err}");
    }
}

#[test]
fn style_changes_are_undone_and_redone() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (label, dim, room) = elements(&r, &mut doc);
    for (cmd, p) in [
        (
            "label_update",
            json!({ "id": label, "font_size": 40, "bold": true }),
        ),
        (
            "dimension_update",
            json!({ "id": dim, "font_name": "Georgia" }),
        ),
        (
            "room_update",
            json!({ "id": room, "name_font_size": 35, "area_italic": true }),
        ),
    ] {
        let before = snapshot(&doc);
        run(&r, &mut doc, cmd, p);
        let after = snapshot(&doc);
        assert_ne!(before, after, "{cmd} changed nothing");
        check_undo_redo(&r, &mut doc, &before, &after);
    }
}

#[test]
fn text_styles_are_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (label, dim, room) = elements(&r, &mut doc);
    run(
        &r,
        &mut doc,
        "label_update",
        json!({ "id": label, "font_size": 40, "bold": true, "font_name": "Georgia" }),
    );
    run(
        &r,
        &mut doc,
        "dimension_update",
        json!({ "id": dim, "font_size": 12, "italic": true }),
    );
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": room, "name_font_size": 35, "name_bold": true,
                "area_font_name": "Arial", "area_italic": true }),
    );
    let reopened = save_and_reopen(&r, &mut doc, "text_styles_saved");
    let home = reopened.home();
    let l = home.labels[0].text_style.clone().unwrap();
    assert_eq!(
        (l.font_size, l.bold, l.font_name.as_deref()),
        (40.0, Some(true), Some("Georgia"))
    );
    let d = home.dimension_lines[0].text_style.clone().unwrap();
    assert_eq!((d.font_size, d.italic), (12.0, Some(true)));
    let styles = &home.rooms[0].text_styles;
    let name = styles
        .iter()
        .find(|s| s.role.as_deref() == Some("nameStyle"))
        .unwrap();
    assert_eq!((name.font_size, name.bold), (35.0, Some(true)));
    let area = styles
        .iter()
        .find(|s| s.role.as_deref() == Some("areaStyle"))
        .unwrap();
    assert_eq!(
        (area.font_size, area.font_name.as_deref(), area.italic),
        (24.0, Some("Arial"), Some(true))
    );
}
