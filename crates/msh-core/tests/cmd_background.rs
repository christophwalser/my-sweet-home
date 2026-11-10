//! Background image commands: set, update, remove, for the home and for levels.

mod common;

use base64::Engine;
use common::{check_undo_redo, new_doc, out_dir, run, run_err, save_and_reopen, snapshot};
use msh_core::{Document, Registry};
use serde_json::{Value, json};

/// A 4 x 3 PNG.
fn png_bytes() -> Vec<u8> {
    common::png_bytes(4, 3)
}

fn png_base64() -> String {
    base64::engine::general_purpose::STANDARD.encode(png_bytes())
}

/// Parameters of `background_image_set` with a 1000 px marker of 500 cm (0.5 cm per pixel).
fn set_params(extra: Value) -> Value {
    let mut p = json!({ "image_base64": png_base64(), "scale_distance": 500,
                        "x_start": 0, "y_start": 0, "x_end": 1000, "y_end": 0 });
    for (k, v) in extra.as_object().unwrap() {
        p[k] = v.clone();
    }
    p
}

fn with_levels(r: &Registry) -> (Document, String, String) {
    let mut doc = new_doc(r);
    run(r, &mut doc, "level_add", json!({ "name": "Upper" }));
    let ground = doc.home().levels[0].attrs.id.clone();
    let upper = doc.home().levels[1].attrs.id.clone();
    (doc, ground, upper)
}

#[test]
fn set_from_a_file_on_the_home_without_levels() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let file = out_dir("bg-set-file").join("plan.png");
    std::fs::write(&file, png_bytes()).unwrap();
    let before = snapshot(&doc);
    let result = run(
        &r,
        &mut doc,
        "background_image_set",
        json!({ "path": file, "scale_distance": 300, "x_start": 10, "y_start": 10,
                "x_end": 10, "y_end": 160, "x_origin": 25, "y_origin": 40 }),
    );
    assert_eq!(result["level"], Value::Null);
    assert_eq!(result["cm_per_pixel"], json!(2.0));
    assert_eq!(result["x_origin"], json!(25.0));
    assert_eq!(result["y_origin"], json!(40.0));
    assert_eq!(result["visible"], json!(true));
    let b = doc.home().background_image.as_ref().unwrap();
    assert_eq!(b.scale_distance, 300.0);
    assert_eq!(b.visible, None, "visible is only written for hidden images");
    let image = result["image"].as_str().unwrap();
    assert_eq!(
        doc.file
            .contents
            .iter()
            .find(|c| c.name == image)
            .unwrap()
            .data,
        png_bytes()
    );
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn data_urls_and_other_image_formats_are_accepted() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let url = format!("data:image/png;base64,{}", png_base64());
    run(
        &r,
        &mut doc,
        "background_image_set",
        set_params(json!({ "image_base64": url, "visible": false })),
    );
    assert_eq!(
        doc.home().background_image.as_ref().unwrap().visible,
        Some(false)
    );
    // Recognized by their first bytes: JPEG, GIF and BMP
    for header in [
        &[0xFF, 0xD8, 0xFF, 0xE0][..],
        b"GIF89a".as_slice(),
        b"BM\0\0".as_slice(),
    ] {
        let mut data = header.to_vec();
        data.extend_from_slice(&[0; 16]);
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        run(
            &r,
            &mut doc,
            "background_image_set",
            set_params(json!({ "image_base64": b64 })),
        );
    }
}

#[test]
fn set_replaces_the_image_of_the_selected_level_only() {
    let r = Registry::standard();
    let (mut doc, ground, upper) = with_levels(&r);
    let first = run(
        &r,
        &mut doc,
        "background_image_set",
        set_params(json!({ "level": ground })),
    );
    assert_eq!(first["level"], json!(ground));
    // Without a level: the selected one (the upper level)
    let second = run(&r, &mut doc, "background_image_set", set_params(json!({})));
    assert_eq!(second["level"], json!(upper));
    let before = snapshot(&doc);
    let third = run(
        &r,
        &mut doc,
        "background_image_set",
        set_params(json!({ "scale_distance": 1000 })),
    );
    assert_eq!(third["cm_per_pixel"], json!(1.0));
    // The same image again: the home keeps one resource for it
    assert_eq!(third["image"], second["image"]);
    assert_eq!(first["image"], second["image"]);
    let home = doc.home();
    assert_eq!(
        home.levels[1]
            .background_image
            .as_ref()
            .unwrap()
            .scale_distance,
        1000.0
    );
    assert_eq!(
        home.levels[0]
            .background_image
            .as_ref()
            .unwrap()
            .scale_distance,
        500.0
    );
    assert!(home.background_image.is_none());
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn set_refuses_invalid_input() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let missing = out_dir("bg-invalid").join("missing.png");
    run_err(
        &r,
        &mut doc,
        "background_image_set",
        json!({ "path": missing, "scale_distance": 100, "x_start": 0, "y_start": 0,
                "x_end": 10, "y_end": 0 }),
    );
    // Neither or both sources
    let mut neither = set_params(json!({}));
    neither.as_object_mut().unwrap().remove("image_base64");
    let err = run_err(&r, &mut doc, "background_image_set", neither);
    assert!(err.contains("path or image_base64"), "{err}");
    let both = set_params(json!({ "path": missing }));
    run_err(&r, &mut doc, "background_image_set", both);
    // Not base64, not an image
    let err = run_err(
        &r,
        &mut doc,
        "background_image_set",
        set_params(json!({ "image_base64": "%%%" })),
    );
    assert!(err.contains("invalid image_base64"), "{err}");
    run_err(
        &r,
        &mut doc,
        "background_image_set",
        set_params(json!({ "image_base64": "aGVsbG8gd29ybGQ=" })),
    );
    // Bad scale marker
    for bad in [
        json!({ "scale_distance": 0 }),
        json!({ "scale_distance": -5 }),
        json!({ "x_end": 0.5 }),
    ] {
        run_err(&r, &mut doc, "background_image_set", set_params(bad));
    }
    // A home without levels has no level to name
    let err = run_err(
        &r,
        &mut doc,
        "background_image_set",
        set_params(json!({ "level": "level-1" })),
    );
    assert!(err.contains("no levels"), "{err}");
    assert!(doc.home().background_image.is_none());
}

#[test]
fn unknown_level_is_refused_when_the_home_has_levels() {
    let r = Registry::standard();
    let (mut doc, _, _) = with_levels(&r);
    for cmd in ["background_image_set", "background_image_update"] {
        let err = run_err(&r, &mut doc, cmd, set_params(json!({ "level": "nope" })));
        assert!(err.contains("unknown level"), "{err}");
    }
    run_err(
        &r,
        &mut doc,
        "background_image_remove",
        json!({ "level": "nope" }),
    );
}

#[test]
fn update_changes_marker_origin_and_visibility() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(&r, &mut doc, "background_image_set", set_params(json!({})));
    let before = snapshot(&doc);
    let result = run(
        &r,
        &mut doc,
        "background_image_update",
        json!({ "scale_distance": 250, "x_start": 100, "y_start": 0, "x_end": 100, "y_end": 500,
                "x_origin": -10, "y_origin": 12.5, "visible": false }),
    );
    assert_eq!(result["cm_per_pixel"], json!(0.5));
    assert_eq!(result["x_origin"], json!(-10.0));
    assert_eq!(result["y_origin"], json!(12.5));
    assert_eq!(result["visible"], json!(false));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    // Showing it again removes the attribute
    let shown = run(
        &r,
        &mut doc,
        "background_image_update",
        json!({ "visible": true }),
    );
    assert_eq!(shown["visible"], json!(true));
    assert_eq!(doc.home().background_image.as_ref().unwrap().visible, None);
}

#[test]
fn update_refuses_a_missing_image_and_an_invalid_result() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let err = run_err(
        &r,
        &mut doc,
        "background_image_update",
        json!({ "visible": false }),
    );
    assert!(err.contains("has no background image"), "{err}");
    run(&r, &mut doc, "background_image_set", set_params(json!({})));
    // The changed marker would collapse to one point: the image stays as it was
    run_err(
        &r,
        &mut doc,
        "background_image_update",
        json!({ "x_end": 0 }),
    );
    run_err(
        &r,
        &mut doc,
        "background_image_update",
        json!({ "scale_distance": 0 }),
    );
    assert_eq!(
        doc.home()
            .background_image
            .as_ref()
            .unwrap()
            .scale_distance_x_end,
        1000.0
    );
}

#[test]
fn remove_deletes_the_image_and_can_be_undone() {
    let r = Registry::standard();
    let (mut doc, ground, upper) = with_levels(&r);
    run(
        &r,
        &mut doc,
        "background_image_set",
        set_params(json!({ "level": ground })),
    );
    // The selected (upper) level has none
    let err = run_err(&r, &mut doc, "background_image_remove", json!({}));
    assert!(err.contains(&upper), "{err}");
    let before = snapshot(&doc);
    let result = run(
        &r,
        &mut doc,
        "background_image_remove",
        json!({ "level": ground }),
    );
    assert_eq!(result, json!({ "removed": true }));
    assert!(doc.home().levels[0].background_image.is_none());
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn background_of_the_home_is_saved_with_its_image() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "background_image_set",
        set_params(json!({ "x_origin": 30, "y_origin": 60, "visible": false })),
    );
    let reopened = save_and_reopen(&r, &mut doc, "bg-save-home");
    let b = reopened.home().background_image.as_ref().unwrap();
    assert_eq!(b.scale_distance, 500.0);
    assert_eq!(b.scale_distance_x_end, 1000.0);
    assert_eq!((b.x_origin, b.y_origin), (Some(30.0), Some(60.0)));
    assert_eq!(b.visible, Some(false));
    let data = &reopened
        .file
        .contents
        .iter()
        .find(|c| c.name == b.image)
        .expect("the image is saved in the file")
        .data;
    assert_eq!(data, &png_bytes());
}

#[test]
fn removed_background_is_not_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let set = run(&r, &mut doc, "background_image_set", set_params(json!({})));
    run(&r, &mut doc, "background_image_remove", json!({}));
    let reopened = save_and_reopen(&r, &mut doc, "bg-save-removed");
    assert!(reopened.home().background_image.is_none());
    let image = set["image"].as_str().unwrap();
    assert!(
        !reopened.file.contents.iter().any(|c| c.name == image),
        "the unused image resource is dropped"
    );
}
