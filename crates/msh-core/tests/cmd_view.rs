//! `view_plan_image`: the plan as PNG or SVG for visual feedback.

mod common;

use base64::Engine;
use common::{new_doc, run, snapshot};
use msh_core::{Document, Registry};
use serde_json::json;

/// Width and height of a PNG from its IHDR chunk.
fn png_size(png: &[u8]) -> (u32, u32) {
    assert!(png.starts_with(b"\x89PNG"), "not a PNG");
    let be = |i: usize| u32::from_be_bytes(png[i..i + 4].try_into().unwrap());
    (be(16), be(20))
}

fn decode(v: &serde_json::Value) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(v["image_base64"].as_str().unwrap())
        .unwrap()
}

/// A home with one wall, a named room and a label.
fn small_plan(r: &Registry) -> Document {
    let mut doc = new_doc(r);
    run(
        r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 500, "y_end": 0 }),
    );
    run(
        r,
        &mut doc,
        "room_add",
        json!({ "name": "Kitchen", "points": [[0, 0], [500, 0], [500, 400], [0, 400]] }),
    );
    doc
}

#[test]
fn png_is_the_default_with_1200_pixels_width() {
    let r = Registry::standard();
    let mut doc = small_plan(&r);
    let could_undo = doc.can_undo();
    let before = snapshot(&doc);
    let image = run(&r, &mut doc, "view_plan_image", json!({}));
    assert_eq!(image["mime_type"], "image/png");
    assert_eq!(png_size(&decode(&image)).0, 1200);
    // A view creates no undo step and leaves the home as it is
    assert_eq!(doc.can_undo(), could_undo);
    assert_eq!(snapshot(&doc), before);
}

#[test]
fn png_width_is_clamped_to_100_to_4000_pixels() {
    let r = Registry::standard();
    let mut doc = small_plan(&r);
    let small = run(&r, &mut doc, "view_plan_image", json!({ "width": 10 }));
    assert_eq!(png_size(&decode(&small)).0, 100);
    let large = run(&r, &mut doc, "view_plan_image", json!({ "width": 9000 }));
    assert_eq!(png_size(&decode(&large)).0, 4000);
    let exact = run(&r, &mut doc, "view_plan_image", json!({ "width": 640 }));
    assert_eq!(png_size(&decode(&exact)).0, 640);
}

#[test]
fn svg_contains_room_names_and_can_hide_furniture_names() {
    let r = Registry::standard();
    let mut doc = small_plan(&r);
    doc.home_mut()
        .furniture
        .push(msh_model::Furniture::Piece(Box::new(msh_model::Piece {
            attrs: msh_model::PieceAttrs {
                id: Some("sofa".into()),
                name: "Sofa Lund".into(),
                x: 250.0,
                y: 200.0,
                width: 200.0,
                depth: 90.0,
                height: 80.0,
                ..Default::default()
            },
            ..Default::default()
        })));
    let svg = run(&r, &mut doc, "view_plan_image", json!({ "format": "svg" }));
    assert_eq!(svg["mime_type"], "image/svg+xml");
    let text = svg["svg"].as_str().unwrap();
    assert!(text.starts_with("<svg") || text.contains("<svg"));
    assert!(text.contains("Kitchen"));
    assert!(text.contains("Sofa Lund"));
    let without = run(
        &r,
        &mut doc,
        "view_plan_image",
        json!({ "format": "svg", "furniture_names": false }),
    );
    let text = without["svg"].as_str().unwrap();
    assert!(text.contains("Kitchen"), "room names stay");
    assert!(!text.contains("Sofa Lund"));
}

#[test]
fn selected_level_is_drawn_unless_a_level_is_given() {
    let r = Registry::standard();
    let mut doc = small_plan(&r);
    run(&r, &mut doc, "level_add", json!({ "name": "Attic" }));
    let ground = doc.home().levels[0].attrs.id.clone();
    run(
        &r,
        &mut doc,
        "room_add",
        json!({ "name": "Studio", "points": [[0, 0], [300, 0], [300, 300], [0, 300]] }),
    );
    // The attic is selected
    let svg = run(&r, &mut doc, "view_plan_image", json!({ "format": "svg" }));
    let text = svg["svg"].as_str().unwrap();
    assert!(text.contains("Studio"));
    assert!(!text.contains("Kitchen"));
    let svg = run(
        &r,
        &mut doc,
        "view_plan_image",
        json!({ "format": "svg", "level": ground }),
    );
    let text = svg["svg"].as_str().unwrap();
    assert!(text.contains("Kitchen"));
    assert!(!text.contains("Studio"));
}

#[test]
fn unknown_format_is_refused() {
    let r = Registry::standard();
    let mut doc = small_plan(&r);
    let err = common::run_err(&r, &mut doc, "view_plan_image", json!({ "format": "gif" }));
    assert!(err.contains("gif") || err.contains("variant"), "{err}");
}
