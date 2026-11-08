//! Location, sun time and 3D view settings (the address search needs the network and is
//! not tested here).

use msh_core::{Document, Registry};
use serde_json::{Value, json};

fn run(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    r.execute(doc, name, params)
        .unwrap_or_else(|e| panic!("{name} failed: {e}"))
}

#[test]
fn sun_follows_location_date_and_time() {
    let r = Registry::standard();
    let mut doc = Document::default();
    run(
        &r,
        &mut doc,
        "location_set",
        json!({ "latitude": 48.1375, "longitude": 11.5748, "time_zone": "Europe/Berlin" }),
    );
    let sun = run(
        &r,
        &mut doc,
        "sun_update",
        json!({ "date": "2026-12-21", "time": "09:00" }),
    );
    assert_eq!(sun["time_zone"], json!("Europe/Berlin"));
    assert_eq!(
        (sun["date"].as_str(), sun["time"].as_str()),
        (Some("2026-12-21"), Some("09:00"))
    );
    // Sweet Home 3D computes 136.79° / 6.59° for this moment
    let azimuth = sun["azimuth"].as_f64().unwrap();
    let elevation = sun["elevation"].as_f64().unwrap();
    assert!((azimuth - 136.8).abs() < 0.3, "azimuth {azimuth}");
    assert!((elevation - 6.6).abs() < 0.2, "elevation {elevation}");
    // Both cameras of the 3D view keep the time (UTC milliseconds: 08:00 UTC)
    let times: Vec<Option<i64>> = doc
        .home()
        .cameras
        .iter()
        .filter(|c| matches!(c.attrs.role.as_str(), "topCamera" | "observerCamera"))
        .map(|c| c.attrs.time)
        .collect();
    assert_eq!(times.len(), 2);
    assert!(times.iter().all(|t| *t == Some(1_797_840_000_000)));

    run(&r, &mut doc, "sun_update", json!({ "follow_clock": true }));
    assert_eq!(
        run(&r, &mut doc, "sun_get", json!({}))["follow_clock"],
        json!(true)
    );
    assert!(
        r.execute(
            &mut doc,
            "location_set",
            json!({ "time_zone": "Mars/Olympus" })
        )
        .is_err()
    );
    assert!(
        r.execute(&mut doc, "sun_update", json!({ "time": "25:00" }))
            .is_err()
    );
}

#[test]
fn view3d_settings() {
    let r = Registry::standard();
    let mut doc = Document::default();
    let v = run(
        &r,
        &mut doc,
        "view3d_update",
        json!({ "ground_color": "#336633", "light_brightness": 50, "walls_transparency": 40 }),
    );
    assert_eq!(v["ground_color"], json!("#336633"));
    assert_eq!(v["light_brightness"], json!(50.0));
    assert_eq!(v["walls_transparency"], json!(40.0));
    let a = &doc.home().environment.as_ref().unwrap().attrs;
    assert_eq!(a.light_color.map(|c| c.0), Some(0xFF68_6868));
    assert_eq!(a.walls_alpha, Some(0.4));
    // "" restores the default color
    let v = run(&r, &mut doc, "view3d_update", json!({ "ground_color": "" }));
    assert_eq!(v["ground_color"], Value::Null);
}
