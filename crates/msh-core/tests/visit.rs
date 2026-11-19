//! Cameras of the 3D view, points of view and 3D view settings.

use msh_core::{Document, Registry};
use serde_json::{Value, json};

fn run(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    r.execute(doc, name, params)
        .unwrap_or_else(|e| panic!("{name} failed: {e}"))
}

#[test]
fn camera_set_moves_without_undo() {
    let r = Registry::standard();
    let mut doc = Document::default();
    let pose = run(
        &r,
        &mut doc,
        "camera_set",
        json!({ "mode": "observer", "x": 120, "y": 340, "yaw": 90, "field_of_view": 70, "activate": true }),
    );
    assert_eq!(pose["x"], json!(120.0));
    assert_eq!(pose["yaw"], json!(90.0));
    assert_eq!(pose["z"], json!(170.0));
    assert_eq!(doc.home().attrs.camera.as_deref(), Some("observerCamera"));
    let observer = doc
        .home()
        .cameras
        .iter()
        .find(|c| c.attrs.role == "observerCamera")
        .unwrap();
    assert!(observer.observer);
    // Camera moves are no undo steps and do not mark the home as modified
    assert!(!doc.can_undo());
    assert!(!doc.modified);
    assert!(
        r.execute(
            &mut doc,
            "camera_set",
            json!({ "mode": "aerial", "field_of_view": 200 })
        )
        .is_err()
    );
}

#[test]
fn viewpoints_are_stored_and_restored() {
    let r = Registry::standard();
    let mut doc = Document::default();
    run(
        &r,
        &mut doc,
        "camera_set",
        json!({ "mode": "observer", "x": 100, "y": 200, "yaw": 45, "activate": true }),
    );
    run(&r, &mut doc, "viewpoint_store", json!({ "name": "Hall" }));
    run(
        &r,
        &mut doc,
        "viewpoint_store",
        json!({ "name": "Top", "mode": "aerial", "x": 0, "y": 900, "z": 800, "pitch": 40 }),
    );
    // Same name replaces and keeps its place; a new name comes first
    run(
        &r,
        &mut doc,
        "viewpoint_store",
        json!({ "name": "Hall", "x": 150 }),
    );
    let list = run(&r, &mut doc, "viewpoint_list", json!({}));
    let list = list["points_of_view"].as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["mode"], json!("aerial"));
    assert_eq!(list[1]["name"], json!("Hall"));
    assert_eq!(list[1]["mode"], json!("observer"));
    assert_eq!(list[1]["x"], json!(150.0));

    run(&r, &mut doc, "viewpoint_go", json!({ "name": "Top" }));
    assert_eq!(doc.home().attrs.camera.as_deref(), Some("topCamera"));
    let cams = run(&r, &mut doc, "camera_get", json!({}));
    assert_eq!(cams["active"], json!("aerial"));
    assert_eq!(cams["aerial"]["z"], json!(800.0));

    run(&r, &mut doc, "viewpoint_delete", json!({ "name": "Top" }));
    assert!(
        r.execute(&mut doc, "viewpoint_go", json!({ "name": "Top" }))
            .is_err()
    );

    // Stored as Sweet Home 3D does: observerCamera / camera elements with storedCamera
    let dir = std::env::temp_dir().join(format!("msh-visit-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("visit.sh3d");
    run(
        &r,
        &mut doc,
        "view3d_update",
        json!({ "all_levels_visible": true }),
    );
    run(
        &r,
        &mut doc,
        "home_save",
        json!({ "path": path.display().to_string() }),
    );
    let reopened = msh_format::Sh3dDocument::open(&path).unwrap();
    let home = &reopened.home;
    let hall = home
        .cameras
        .iter()
        .find(|c| c.attrs.name.as_deref() == Some("Hall"))
        .unwrap();
    assert!(hall.observer);
    assert_eq!(hall.attrs.role, "storedCamera");
    assert_eq!(
        home.environment.as_ref().unwrap().attrs.all_levels_visible,
        Some(true)
    );
    std::fs::remove_dir_all(&dir).ok();
}
