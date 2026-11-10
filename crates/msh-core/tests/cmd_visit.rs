//! Cameras of the 3D view and stored points of view.

mod common;

use common::{check_undo_redo, new_doc, run, run_err, save_and_reopen, snapshot};
use msh_core::Registry;
use serde_json::{Value, json};

fn names(list: &Value) -> Vec<String> {
    list["points_of_view"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn camera_get_reports_the_active_camera() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    // A new home uses the aerial view and has no cameras yet
    let cams = run(&r, &mut doc, "camera_get", json!({}));
    assert_eq!(cams["active"], "aerial");
    assert_eq!(cams["observer"], Value::Null);
    run(
        &r,
        &mut doc,
        "camera_set",
        json!({ "mode": "observer", "x": 10, "activate": true }),
    );
    let cams = run(&r, &mut doc, "camera_get", json!({}));
    assert_eq!(cams["active"], "observer");
    assert_eq!(cams["observer"]["x"], json!(10.0));
    // Sweet Home 3D's defaults for the values not given
    assert_eq!(cams["observer"]["y"], json!(50.0));
    assert_eq!(cams["observer"]["z"], json!(170.0));
    assert_eq!(cams["observer"]["yaw"], json!(315.0));
    assert!(!doc.can_undo());
}

#[test]
fn camera_set_keeps_omitted_values_and_clamps_the_pitch() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "camera_set",
        json!({ "mode": "aerial", "x": 100, "y": 200, "z": 900, "yaw": 450, "pitch": 30 }),
    );
    let pose = run(
        &r,
        &mut doc,
        "camera_set",
        json!({ "mode": "aerial", "pitch": 120 }),
    );
    assert_eq!(pose["x"], json!(100.0));
    assert_eq!(pose["z"], json!(900.0));
    assert_eq!(pose["yaw"], json!(90.0), "shown in 0..360");
    assert_eq!(pose["pitch"], json!(90.0), "clamped");
    // Without activate the 3D view keeps its camera
    run(
        &r,
        &mut doc,
        "camera_set",
        json!({ "mode": "observer", "x": 1 }),
    );
    assert_eq!(doc.home().attrs.camera.as_deref(), Some("topCamera"));
    assert!(!doc.can_undo());
}

#[test]
fn camera_set_refuses_invalid_values() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "camera_set",
        json!({ "mode": "observer", "x": 1 }),
    );
    for fov in [1.0, 171.0] {
        let err = run_err(
            &r,
            &mut doc,
            "camera_set",
            json!({ "mode": "observer", "x": 5, "field_of_view": fov }),
        );
        assert!(err.contains("field_of_view"), "{err}");
    }
    run_err(&r, &mut doc, "camera_set", json!({ "mode": "drone" }));
    run_err(&r, &mut doc, "camera_set", json!({ "x": 5 }));
}

#[test]
fn failed_camera_set_creates_no_camera() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    // camera_set is a view command without undo checkpoint: it must validate before changing
    run_err(
        &r,
        &mut doc,
        "camera_set",
        json!({ "mode": "observer", "field_of_view": 1 }),
    );
    assert!(doc.home().cameras.is_empty());
}

#[test]
fn camera_moves_are_saved_without_marking_the_home_modified() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "camera_set",
        json!({ "mode": "observer", "x": 321, "y": 123, "yaw": 180, "activate": true }),
    );
    assert!(!doc.modified);
    let reopened = save_and_reopen(&r, &mut doc, "visit-camera-save");
    let home = reopened.home();
    assert_eq!(home.attrs.camera.as_deref(), Some("observerCamera"));
    let cam = home
        .cameras
        .iter()
        .find(|c| c.attrs.role == "observerCamera")
        .unwrap();
    assert_eq!((cam.attrs.x, cam.attrs.y), (321.0, 123.0));
    assert!((cam.attrs.yaw - std::f32::consts::PI).abs() < 1e-4);
}

#[test]
fn viewpoint_store_is_an_undo_step() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let list = run(
        &r,
        &mut doc,
        "viewpoint_store",
        json!({ "name": "  Garden  ", "x": 50, "y": 60 }),
    );
    // The name is trimmed; without mode the camera of the 3D view (aerial) is stored
    assert_eq!(names(&list), ["Garden"]);
    assert_eq!(list["points_of_view"][0]["mode"], "aerial");
    assert_eq!(list["points_of_view"][0]["x"], json!(50.0));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn viewpoint_store_refuses_empty_names_and_bad_values() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let err = run_err(&r, &mut doc, "viewpoint_store", json!({ "name": "   " }));
    assert!(err.contains("empty"), "{err}");
    run_err(
        &r,
        &mut doc,
        "viewpoint_store",
        json!({ "name": "Wide", "field_of_view": 200 }),
    );
    run_err(&r, &mut doc, "viewpoint_store", json!({}));
}

#[test]
fn at_most_fifty_points_of_view_are_kept() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    for i in 0..52 {
        run(
            &r,
            &mut doc,
            "viewpoint_store",
            json!({ "name": format!("View {i}") }),
        );
    }
    let list = run(&r, &mut doc, "viewpoint_list", json!({}));
    let names = names(&list);
    assert_eq!(names.len(), 50);
    // Newest first; the oldest two are dropped
    assert_eq!(names[0], "View 51");
    assert_eq!(names[49], "View 2");
}

#[test]
fn viewpoint_list_is_no_undo_step() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    assert_eq!(
        run(&r, &mut doc, "viewpoint_list", json!({})),
        json!({ "points_of_view": [] })
    );
    assert!(!doc.can_undo());
}

#[test]
fn viewpoint_go_switches_the_view_without_undo() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "viewpoint_store",
        json!({ "name": "Door", "mode": "observer", "x": 77, "y": 88, "yaw": 90, "field_of_view": 50 }),
    );
    let could_undo = doc.can_undo();
    let pose = run(&r, &mut doc, "viewpoint_go", json!({ "name": "Door" }));
    assert_eq!(pose["x"], json!(77.0));
    assert_eq!(pose["field_of_view"], json!(50.0));
    assert_eq!(doc.home().attrs.camera.as_deref(), Some("observerCamera"));
    assert_eq!(doc.can_undo(), could_undo);
    let err = run_err(&r, &mut doc, "viewpoint_go", json!({ "name": "door" }));
    assert!(err.contains("no stored point of view"), "{err}");
}

#[test]
fn viewpoint_delete_is_an_undo_step() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    for name in ["A", "B"] {
        run(&r, &mut doc, "viewpoint_store", json!({ "name": name }));
    }
    let before = snapshot(&doc);
    let list = run(&r, &mut doc, "viewpoint_delete", json!({ "name": "A" }));
    assert_eq!(names(&list), ["B"]);
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    run_err(&r, &mut doc, "viewpoint_delete", json!({ "name": "A" }));
}

#[test]
fn aerial_points_of_view_are_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "viewpoint_store",
        json!({ "name": "Above", "mode": "aerial", "x": 0, "y": 900, "z": 700, "pitch": 40 }),
    );
    let mut reopened = save_and_reopen(&r, &mut doc, "visit-aerial-save");
    let list = run(&r, &mut reopened, "viewpoint_list", json!({}));
    let p = &list["points_of_view"][0];
    assert_eq!(p["name"], "Above");
    assert_eq!(p["mode"], "aerial");
    assert_eq!(p["z"], json!(700.0));
    assert_eq!(p["pitch"], json!(40.0));
}
