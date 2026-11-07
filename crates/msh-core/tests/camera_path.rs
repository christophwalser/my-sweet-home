//! Camera path of the video and video settings through the command registry.

use msh_core::{Document, Registry};
use serde_json::{Value, json};

fn run(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    r.execute(doc, name, params)
        .unwrap_or_else(|e| panic!("{name} failed: {e}"))
}

#[test]
fn camera_path_is_edited_and_saved() {
    let r = Registry::standard();
    let mut doc = Document::default();
    run(&r, &mut doc, "home_new", json!({ "name": "Video.sh3d" }));

    run(
        &r,
        &mut doc,
        "camera_path_add",
        json!({ "x": 100, "y": 100, "yaw": 90 }),
    );
    // Looking from (100, 300) towards (100, 600): straight down the plan, yaw 0
    run(
        &r,
        &mut doc,
        "camera_path_add",
        json!({ "x": 100, "y": 300, "look_at_x": 100, "look_at_y": 600 }),
    );
    // Inserted between the two
    let added = run(
        &r,
        &mut doc,
        "camera_path_add",
        json!({ "x": 100, "y": 200, "z": 150, "yaw": 45, "pitch": 10, "field_of_view": 70, "index": 1 }),
    );
    assert_eq!(added, json!({ "index": 1, "count": 3 }));

    let info = run(&r, &mut doc, "camera_path_get", json!({}));
    let points = info["points"].as_array().unwrap();
    assert_eq!(points.len(), 3);
    assert_eq!(points[0]["yaw"], json!(90.0));
    assert_eq!(points[1]["z"], json!(150.0));
    assert_eq!(points[1]["field_of_view"], json!(70.0));
    assert_eq!(points[2]["y"], json!(300.0));
    assert_eq!(points[2]["yaw"].as_f64().unwrap().abs(), 0.0);
    // Default settings: 640 x 480 at 25 fps and 2.4 km/h
    assert_eq!(info["video"]["width"], json!(640));
    assert_eq!(info["video"]["height"], json!(480));
    assert!(info["video"]["frames"].as_u64().unwrap() > 25);

    let settings = run(
        &r,
        &mut doc,
        "video_settings_update",
        json!({ "width": 1280, "aspect_ratio": "16:9", "frame_rate": 30, "speed": 1.0 }),
    );
    assert_eq!(settings["height"], json!(720));
    assert_eq!(settings["frame_rate"], json!(30));
    assert!(
        r.execute(&mut doc, "video_settings_update", json!({ "speed": -1 }))
            .is_err()
    );

    run(&r, &mut doc, "camera_path_remove", json!({ "index": 0 }));
    assert!(
        r.execute(&mut doc, "camera_path_remove", json!({ "index": 5 }))
            .is_err()
    );

    // Saved as <camera attribute="cameraPath"> in the environment and read back
    let dir = std::env::temp_dir().join(format!("msh-camera-path-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("video.sh3d");
    run(
        &r,
        &mut doc,
        "home_save",
        json!({ "path": path.display().to_string() }),
    );
    run(
        &r,
        &mut doc,
        "home_open",
        json!({ "path": path.display().to_string() }),
    );
    let info = run(&r, &mut doc, "camera_path_get", json!({}));
    assert_eq!(info["points"].as_array().unwrap().len(), 2);
    assert_eq!(info["video"]["aspect_ratio"], json!("16:9"));

    let cleared = run(&r, &mut doc, "camera_path_clear", json!({}));
    assert_eq!(cleared, json!({ "removed": 2 }));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn stored_points_of_view_become_key_points() {
    let r = Registry::standard();
    let mut doc = Document::default();
    let file = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/corpus/examples/1BedroomApartmentWithRoundWall.xml"
    );
    *doc.home_mut() = msh_format::read_home_xml(&std::fs::read(file).unwrap()).unwrap();
    let info = run(&r, &mut doc, "camera_path_get", json!({}));
    let stored = info["stored_points_of_view"].as_array().unwrap();
    assert!(stored.iter().any(|s| s["name"] == "Kitchen"));
    run(
        &r,
        &mut doc,
        "camera_path_add",
        json!({ "stored": "Kitchen" }),
    );
    let info = run(&r, &mut doc, "camera_path_get", json!({}));
    let kitchen = stored.iter().find(|s| s["name"] == "Kitchen").unwrap();
    assert_eq!(info["points"][0]["x"], kitchen["x"]);
    assert!(
        r.execute(&mut doc, "camera_path_add", json!({ "stored": "Attic" }))
            .is_err()
    );
}
