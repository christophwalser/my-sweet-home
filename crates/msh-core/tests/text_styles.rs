//! Text styles, curved polylines, the compass in edit_move and height dimensions.

use msh_core::{Document, Registry};
use msh_model::{Furniture, Piece, PieceAttrs};
use serde_json::{Value, json};

fn run(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    r.execute(doc, name, params)
        .unwrap_or_else(|e| panic!("{name} failed: {e}"))
}

fn id(v: Value) -> String {
    v["id"].as_str().unwrap().to_string()
}

#[test]
fn text_styles_are_set_and_cleared() {
    let r = Registry::standard();
    let mut doc = Document::default();
    let label = id(run(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "Hall", "x": 0, "y": 0 }),
    ));
    run(
        &r,
        &mut doc,
        "label_update",
        json!({ "id": label, "font_name": "Georgia", "bold": true, "italic": true }),
    );
    let style = doc.home().labels[0].text_style.clone().unwrap();
    assert_eq!(style.font_name.as_deref(), Some("Georgia"));
    assert_eq!(
        (style.bold, style.italic, style.font_size),
        (Some(true), Some(true), 18.0)
    );
    // "" restores the default font, false removes the flag
    run(
        &r,
        &mut doc,
        "label_update",
        json!({ "id": label, "font_name": "", "bold": false }),
    );
    let style = doc.home().labels[0].text_style.clone().unwrap();
    assert_eq!((style.font_name, style.bold), (None, None));

    let room = id(run(
        &r,
        &mut doc,
        "room_add",
        json!({ "points": [[0, 0], [300, 0], [300, 300]], "name": "Kitchen" }),
    ));
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": room, "name_bold": true, "area_font_name": "Arial", "area_font_size": 30 }),
    );
    let styles = &doc.home().rooms[0].text_styles;
    let name = styles
        .iter()
        .find(|s| s.role.as_deref() == Some("nameStyle"))
        .unwrap();
    let area = styles
        .iter()
        .find(|s| s.role.as_deref() == Some("areaStyle"))
        .unwrap();
    assert_eq!((name.bold, name.font_size), (Some(true), 24.0));
    assert_eq!(
        (area.font_name.as_deref(), area.font_size),
        (Some("Arial"), 30.0)
    );

    let dim = id(run(
        &r,
        &mut doc,
        "dimension_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 100, "y_end": 0 }),
    ));
    run(
        &r,
        &mut doc,
        "dimension_update",
        json!({ "id": dim, "font_size": 24, "italic": true }),
    );
    let style = doc.home().dimension_lines[0].text_style.clone().unwrap();
    assert_eq!((style.font_size, style.italic), (24.0, Some(true)));
    assert!(
        r.execute(
            &mut doc,
            "dimension_update",
            json!({ "id": dim, "font_size": 0 })
        )
        .is_err()
    );

    doc.home_mut()
        .furniture
        .push(Furniture::Piece(Box::new(Piece {
            attrs: PieceAttrs {
                id: Some("sofa".into()),
                name: "Sofa".into(),
                width: 200.0,
                depth: 90.0,
                height: 80.0,
                ..Default::default()
            },
            ..Default::default()
        })));
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "sofa", "name_visible": true, "name_font_size": 22, "name_bold": true }),
    );
    let mut found = None;
    doc.home().for_each_piece(|p| found = Some(p.clone()));
    let sofa = found.unwrap();
    assert_eq!(sofa.attrs.name_visible, Some(true));
    let style = sofa.text_style.unwrap();
    assert_eq!((style.font_size, style.bold), (22.0, Some(true)));
}

#[test]
fn curved_lines_compass_and_height_dimensions() {
    let r = Registry::standard();
    let mut doc = Document::default();
    let line = id(run(
        &r,
        &mut doc,
        "polyline_add",
        json!({ "points": [[0, 0], [100, 50], [200, 0]], "curved": true }),
    ));
    assert_eq!(
        doc.home().polylines[0].attrs.join_style.as_deref(),
        Some("CURVED")
    );
    run(
        &r,
        &mut doc,
        "polyline_update",
        json!({ "id": line, "curved": false }),
    );
    assert_eq!(
        doc.home().polylines[0].attrs.join_style.as_deref(),
        Some("MITER")
    );

    run(&r, &mut doc, "compass_update", json!({ "x": 10, "y": 20 }));
    run(
        &r,
        &mut doc,
        "edit_move",
        json!({ "ids": ["compass"], "dx": 5, "dy": -5 }),
    );
    let c = &doc.home().compass.as_ref().unwrap().attrs;
    assert_eq!((c.x, c.y), (15.0, 15.0));

    run(
        &r,
        &mut doc,
        "dimension_add_height",
        json!({ "x": 50, "y": 60, "elevation_end": 250 }),
    );
    let a = &doc.home().dimension_lines[0].attrs;
    assert_eq!((a.x_start, a.y_start), (a.x_end, a.y_end));
    assert_eq!(
        (a.elevation_start, a.elevation_end),
        (Some(0.0), Some(250.0))
    );
    assert!(
        r.execute(
            &mut doc,
            "dimension_add_height",
            json!({ "x": 0, "y": 0, "elevation_end": 0 })
        )
        .is_err()
    );
}
