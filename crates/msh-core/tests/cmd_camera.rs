//! Camera path of the video and video settings.

mod common;

use common::{check_undo_redo, new_doc, run, run_err, save_and_reopen, snapshot};
use msh_core::{Document, Registry};
use serde_json::json;

fn points(r: &Registry, doc: &mut Document) -> Vec<serde_json::Value> {
    run(r, doc, "camera_path_get", json!({}))["points"]
        .as_array()
        .unwrap()
        .clone()
}

/// A path of three key points at x = 0, 100, 200.
fn three_points(r: &Registry) -> Document {
    let mut doc = new_doc(r);
    for x in [0, 100, 200] {
        run(r, &mut doc, "camera_path_add", json!({ "x": x, "y": 0 }));
    }
    doc
}

#[test]
fn add_appends_with_defaults_and_can_be_undone() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let added = run(&r, &mut doc, "camera_path_add", json!({ "x": 50, "y": 75 }));
    assert_eq!(added, json!({ "index": 0, "count": 1 }));
    let p = &points(&r, &mut doc)[0];
    assert_eq!(p["z"], json!(170.0), "default eye elevation");
    assert_eq!(p["yaw"], json!(0.0));
    assert_eq!(p["pitch"], json!(0.0));
    assert_eq!(p["field_of_view"], json!(63.03), "1.1 rad as Sweet Home 3D");
    assert_eq!(msh_core::camera_path_len(doc.home()), 1);
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn look_at_point_gives_yaw_and_pitch() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    // Looking towards -x from (100, 0) at eye height, and down onto a point 100 cm lower
    run(
        &r,
        &mut doc,
        "camera_path_add",
        json!({ "x": 100, "y": 0, "look_at_x": 0, "look_at_y": 0 }),
    );
    run(
        &r,
        &mut doc,
        "camera_path_add",
        json!({ "x": 0, "y": 0, "z": 200, "look_at_x": 100, "look_at_y": 0, "look_at_z": 100 }),
    );
    let p = points(&r, &mut doc);
    assert_eq!(p[0]["yaw"], json!(90.0));
    assert_eq!(p[0]["pitch"], json!(0.0));
    assert_eq!(p[1]["yaw"], json!(270.0));
    assert_eq!(p[1]["pitch"], json!(45.0));
}

#[test]
fn add_refuses_incomplete_or_degenerate_key_points() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let err = run_err(&r, &mut doc, "camera_path_add", json!({ "x": 10 }));
    assert!(err.contains("stored"), "{err}");
    let err = run_err(
        &r,
        &mut doc,
        "camera_path_add",
        json!({ "x": 10, "y": 20, "look_at_x": 10, "look_at_y": 20 }),
    );
    assert!(err.contains("look at"), "{err}");
    run_err(
        &r,
        &mut doc,
        "camera_path_add",
        json!({ "stored": "Nowhere" }),
    );
    assert_eq!(msh_core::camera_path_len(doc.home()), 0);
}

#[test]
fn index_inserts_and_too_large_index_appends() {
    let r = Registry::standard();
    let mut doc = three_points(&r);
    let first = run(
        &r,
        &mut doc,
        "camera_path_add",
        json!({ "x": -100, "y": 0, "index": 0 }),
    );
    assert_eq!(first, json!({ "index": 0, "count": 4 }));
    let last = run(
        &r,
        &mut doc,
        "camera_path_add",
        json!({ "x": 300, "y": 0, "index": 99 }),
    );
    assert_eq!(last, json!({ "index": 4, "count": 5 }));
    let xs: Vec<f64> = points(&r, &mut doc)
        .iter()
        .map(|p| p["x"].as_f64().unwrap())
        .collect();
    assert_eq!(xs, [-100.0, 0.0, 100.0, 200.0, 300.0]);
}

#[test]
fn path_cameras_stay_apart_from_other_cameras() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "viewpoint_store",
        json!({ "name": "Hall", "mode": "observer", "x": 5, "y": 5 }),
    );
    run(&r, &mut doc, "camera_path_add", json!({ "x": 1, "y": 2 }));
    run(
        &r,
        &mut doc,
        "camera_path_add",
        json!({ "stored": "Hall", "index": 0 }),
    );
    let info = run(&r, &mut doc, "camera_path_get", json!({}));
    assert_eq!(info["points"].as_array().unwrap().len(), 2);
    assert_eq!(info["points"][0]["x"], json!(5.0));
    assert_eq!(info["stored_points_of_view"][0]["name"], "Hall");
    // Clearing the path keeps the stored point of view
    let cleared = run(&r, &mut doc, "camera_path_clear", json!({}));
    assert_eq!(cleared, json!({ "removed": 2 }));
    let list = run(&r, &mut doc, "viewpoint_list", json!({}));
    assert_eq!(list["points_of_view"].as_array().unwrap().len(), 1);
}

#[test]
fn remove_takes_out_one_key_point_and_can_be_undone() {
    let r = Registry::standard();
    let mut doc = three_points(&r);
    let before = snapshot(&doc);
    let removed = run(&r, &mut doc, "camera_path_remove", json!({ "index": 1 }));
    assert_eq!(removed, json!({ "count": 2 }));
    let xs: Vec<f64> = points(&r, &mut doc)
        .iter()
        .map(|p| p["x"].as_f64().unwrap())
        .collect();
    assert_eq!(xs, [0.0, 200.0]);
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    let err = run_err(&r, &mut doc, "camera_path_remove", json!({ "index": 2 }));
    assert!(err.contains("the path has 2"), "{err}");
    run_err(&r, &mut doc, "camera_path_remove", json!({ "index": -1 }));
}

#[test]
fn clear_removes_all_key_points_and_can_be_undone() {
    let r = Registry::standard();
    let mut doc = three_points(&r);
    let before = snapshot(&doc);
    assert_eq!(
        run(&r, &mut doc, "camera_path_clear", json!({})),
        json!({ "removed": 3 })
    );
    assert_eq!(msh_core::camera_path_len(doc.home()), 0);
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    // Nothing left to clear
    run(&r, &mut doc, "camera_path_clear", json!({}));
    assert_eq!(
        run(&r, &mut doc, "camera_path_clear", json!({})),
        json!({ "removed": 0 })
    );
}

#[test]
fn get_is_no_undo_step_and_reports_the_duration() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let empty = run(&r, &mut doc, "camera_path_get", json!({}));
    assert_eq!(empty["video"]["frames"], json!(0));
    assert_eq!(empty["video"]["duration_seconds"], json!(0.0));
    run(&r, &mut doc, "camera_path_add", json!({ "x": 0, "y": 0 }));
    run(&r, &mut doc, "camera_path_add", json!({ "x": 200, "y": 0 }));
    run(
        &r,
        &mut doc,
        "video_settings_update",
        json!({ "speed": 1.0, "frame_rate": 25 }),
    );
    let could_undo = doc.can_undo();
    let before = snapshot(&doc);
    let info = run(&r, &mut doc, "camera_path_get", json!({}));
    // 2 m at 1 m/s and 25 fps: 50 frames plus the first one
    assert_eq!(info["video"]["frames"], json!(51));
    assert_eq!(info["video"]["duration_seconds"], json!(2.04));
    assert_eq!(doc.can_undo(), could_undo);
    assert_eq!(snapshot(&doc), before);
}

#[test]
fn video_settings_are_clamped_undone_and_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let v = run(
        &r,
        &mut doc,
        "video_settings_update",
        json!({ "width": 5, "aspect_ratio": "24:10", "frame_rate": 500 }),
    );
    assert_eq!(v["width"], json!(16));
    assert_eq!(v["frame_rate"], json!(60));
    assert_eq!(v["aspect_ratio"], json!("24:10"));
    let mid = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &mid);
    let v = run(
        &r,
        &mut doc,
        "video_settings_update",
        json!({ "width": 9999, "frame_rate": 0 }),
    );
    assert_eq!(v["width"], json!(3840));
    assert_eq!(v["height"], json!(1600));
    assert_eq!(v["frame_rate"], json!(1));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &mid, &after);

    let reopened = save_and_reopen(&r, &mut doc, "video-settings");
    let a = &reopened.home().environment.as_ref().unwrap().attrs;
    assert_eq!(a.video_width, Some(3840));
    assert_eq!(a.video_aspect_ratio.as_deref(), Some("RATIO_24_10"));
    assert_eq!(a.video_frame_rate, Some(1));
}

#[test]
fn video_settings_refuse_invalid_speed_and_aspect_ratio() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    for speed in [0.0, -1.0, 100.5] {
        let err = run_err(
            &r,
            &mut doc,
            "video_settings_update",
            json!({ "speed": speed }),
        );
        assert!(err.contains("speed"), "{err}");
    }
    run_err(
        &r,
        &mut doc,
        "video_settings_update",
        json!({ "aspect_ratio": "3:2" }),
    );
    // A failing update also leaves the other values alone
    run_err(
        &r,
        &mut doc,
        "video_settings_update",
        json!({ "width": 800, "speed": 0 }),
    );
    let v = run(&r, &mut doc, "camera_path_get", json!({}))["video"].clone();
    assert_eq!(v["width"], json!(640));
}

#[test]
fn key_points_are_saved_with_their_view() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "camera_path_add",
        json!({ "x": 10, "y": 20, "z": 160, "yaw": 30, "pitch": -15, "field_of_view": 80 }),
    );
    let mut reopened = save_and_reopen(&r, &mut doc, "camera-path-save");
    let p = &points(&r, &mut reopened)[0];
    assert_eq!(
        (&p["x"], &p["y"], &p["z"]),
        (&json!(10.0), &json!(20.0), &json!(160.0))
    );
    assert_eq!(p["yaw"], json!(30.0));
    assert_eq!(p["pitch"], json!(-15.0));
    assert_eq!(p["field_of_view"], json!(80.0));
}
