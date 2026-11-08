//! Background images of levels and of the home through the command registry.

use base64::Engine;
use msh_core::{Document, Registry};
use serde_json::{Value, json};

fn run(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    r.execute(doc, name, params)
        .unwrap_or_else(|e| panic!("{name} failed: {e}"))
}

/// A 2 x 2 PNG.
fn png() -> String {
    const PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x08, 0x02, 0x00, 0x00, 0x00, 0xFD,
        0xD4, 0x9A, 0x73, 0x00, 0x00, 0x00, 0x16, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8,
        0xCF, 0xC0, 0xF0, 0x1F, 0x08, 0x19, 0x18, 0xFE, 0x03, 0x00, 0x1D, 0xF2, 0x03, 0xFD, 0x8E,
        0x3B, 0x71, 0x23, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];
    base64::engine::general_purpose::STANDARD.encode(PNG)
}

#[test]
fn background_image_per_level_is_set_updated_saved_and_removed() {
    let r = Registry::standard();
    let mut doc = Document::default();
    run(&r, &mut doc, "home_new", json!({}));

    // Without levels the image belongs to the home
    let set = run(
        &r,
        &mut doc,
        "background_image_set",
        json!({ "image_base64": png(), "scale_distance": 500, "x_start": 0, "y_start": 0,
                "x_end": 1000, "y_end": 0, "x_origin": 20, "y_origin": 30 }),
    );
    assert_eq!(set["level"], Value::Null);
    assert_eq!(set["cm_per_pixel"], json!(0.5));
    assert!(doc.home().background_image.is_some());

    // With levels it belongs to the selected level
    run(&r, &mut doc, "level_add", json!({ "name": "Upper floor" }));
    let upper = doc.home().attrs.selected_level.clone().unwrap();
    // The first level ("Level 0") took over the home's image
    assert!(doc.home().background_image.is_none());
    assert!(doc.home().levels[0].background_image.is_some());
    let set = run(
        &r,
        &mut doc,
        "background_image_set",
        json!({ "image_base64": png(), "scale_distance": 100, "x_start": 10,
                "y_start": 10, "x_end": 10, "y_end": 210 }),
    );
    assert_eq!(set["level"], json!(upper));
    let updated = run(
        &r,
        &mut doc,
        "background_image_update",
        json!({ "visible": false, "x_origin": 5 }),
    );
    assert_eq!(updated["visible"], json!(false));
    assert_eq!(updated["x_origin"], json!(5.0));

    // Invalid input
    assert!(
        r.execute(
            &mut doc,
            "background_image_update",
            json!({ "x_end": 10, "y_end": 10 })
        )
        .is_err()
    );
    assert!(
        r.execute(
            &mut doc,
            "background_image_set",
            json!({ "image_base64": "aGVsbG8=", "scale_distance": 100, "x_start": 0,
                    "y_start": 0, "x_end": 10, "y_end": 0 })
        )
        .is_err()
    );

    // Saved and read back with the image resource
    let dir = std::env::temp_dir().join(format!("msh-background-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("background.sh3d");
    run(&r, &mut doc, "home_save", json!({ "path": path }));
    run(&r, &mut doc, "home_open", json!({ "path": path }));
    let level = doc
        .home()
        .levels
        .iter()
        .find(|l| l.attrs.id == upper)
        .unwrap();
    let b = level.background_image.as_ref().unwrap();
    assert_eq!(b.visible, Some(false));
    assert!(doc.file.contents.iter().any(|c| c.name == b.image));

    run(
        &r,
        &mut doc,
        "background_image_remove",
        json!({ "level": upper }),
    );
    assert!(
        r.execute(
            &mut doc,
            "background_image_remove",
            json!({ "level": upper })
        )
        .is_err()
    );
    std::fs::remove_dir_all(&dir).ok();
}
