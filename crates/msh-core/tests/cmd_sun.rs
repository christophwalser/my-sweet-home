//! Location, sun, photo settings and 3D view settings (the online address search is only
//! tested for its offline parameter check).

mod common;

use common::{check_undo_redo, new_doc, run, run_err, save_and_reopen, snapshot};
use msh_core::{Document, Registry};
use serde_json::{Value, json};

/// A home in Berlin's time zone with the sun on 2026-12-21 09:00.
fn berlin(r: &Registry) -> Document {
    let mut doc = new_doc(r);
    run(
        r,
        &mut doc,
        "location_set",
        json!({ "latitude": 52.52, "longitude": 13.4, "time_zone": "Europe/Berlin" }),
    );
    run(
        r,
        &mut doc,
        "sun_update",
        json!({ "date": "2026-12-21", "time": "09:00" }),
    );
    doc
}

#[test]
fn location_search_refuses_an_empty_query_before_going_online() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    for query in ["", "   "] {
        let err = run_err(&r, &mut doc, "location_search", json!({ "query": query }));
        assert!(err.contains("empty"), "{err}");
    }
    run_err(&r, &mut doc, "location_search", json!({}));
}

#[test]
fn location_set_is_an_undo_step_and_clamps_coordinates() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let sun = run(
        &r,
        &mut doc,
        "location_set",
        json!({ "latitude": 100, "longitude": -200, "time_zone": "America/New_York" }),
    );
    assert_eq!(sun["latitude"], json!(90.0));
    assert_eq!(sun["longitude"], json!(-180.0));
    assert_eq!(sun["location_set"], json!(true));
    assert_eq!(sun["time_zone"], "America/New_York");
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn location_set_changes_only_the_given_values() {
    let r = Registry::standard();
    let mut doc = berlin(&r);
    let sun = run(&r, &mut doc, "location_set", json!({ "latitude": 48.0 }));
    assert_eq!(sun["latitude"], json!(48.0));
    assert_eq!(sun["longitude"], json!(13.4));
    assert_eq!(sun["time_zone"], "Europe/Berlin");
    let err = run_err(
        &r,
        &mut doc,
        "location_set",
        json!({ "latitude": 10, "time_zone": "Europe/Atlantis" }),
    );
    assert!(err.contains("unknown time zone"), "{err}");
}

#[test]
fn location_is_saved_in_the_compass() {
    let r = Registry::standard();
    let mut doc = berlin(&r);
    let mut reopened = save_and_reopen(&r, &mut doc, "sun-location-save");
    let sun = run(&r, &mut reopened, "sun_get", json!({}));
    assert_eq!(sun["latitude"], json!(52.52));
    assert_eq!(sun["longitude"], json!(13.4));
    assert_eq!(sun["time_zone"], "Europe/Berlin");
    assert_eq!(sun["date"], "2026-12-21");
    assert_eq!(sun["time"], "09:00");
}

#[test]
fn sun_update_with_only_a_date_keeps_the_local_time() {
    let r = Registry::standard();
    let mut doc = berlin(&r);
    let before = snapshot(&doc);
    // Summer time in Berlin: the local time stays 09:00
    let sun = run(&r, &mut doc, "sun_update", json!({ "date": "2026-06-21" }));
    assert_eq!(sun["date"], "2026-06-21");
    assert_eq!(sun["time"], "09:00");
    assert_eq!(sun["utc_ms"], json!(1_782_025_200_000i64));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    let sun = run(&r, &mut doc, "sun_update", json!({ "time": "17:45" }));
    assert_eq!(sun["date"], "2026-06-21");
    assert_eq!(sun["time"], "17:45");
}

#[test]
fn sun_update_refuses_invalid_and_non_existing_times() {
    let r = Registry::standard();
    let mut doc = berlin(&r);
    for bad in [
        json!({ "date": "21.12.2026" }),
        json!({ "date": "2026-02-30" }),
        json!({ "time": "9 o'clock" }),
        // Clocks jump from 02:00 to 03:00 in Berlin on that day
        json!({ "date": "2026-03-29", "time": "02:30" }),
    ] {
        run_err(&r, &mut doc, "sun_update", bad);
    }
}

#[test]
fn follow_clock_is_set_and_removed() {
    let r = Registry::standard();
    let mut doc = berlin(&r);
    let before = snapshot(&doc);
    let sun = run(&r, &mut doc, "sun_update", json!({ "follow_clock": true }));
    assert_eq!(sun["follow_clock"], json!(true));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    let reopened = save_and_reopen(&r, &mut doc, "sun-follow-clock");
    let mut reopened = reopened;
    assert_eq!(
        run(&r, &mut reopened, "sun_get", json!({}))["follow_clock"],
        json!(true)
    );
    let sun = run(
        &r,
        &mut reopened,
        "sun_update",
        json!({ "follow_clock": false }),
    );
    assert_eq!(sun["follow_clock"], json!(false));
    // The stored time is used again
    assert_eq!(sun["date"], "2026-12-21");
}

#[test]
fn sun_get_at_another_moment_changes_nothing() {
    let r = Registry::standard();
    let mut doc = berlin(&r);
    let could_undo = doc.can_undo();
    let before = snapshot(&doc);
    let noon = run(&r, &mut doc, "sun_get", json!({ "at": "2026-06-21T13:00" }));
    assert_eq!(noon["date"], "2026-06-21");
    assert_eq!(noon["time"], "13:00");
    // High in the south at summer noon (solar noon in Berlin is about 13:07 CEST)
    let az = noon["azimuth"].as_f64().unwrap();
    let el = noon["elevation"].as_f64().unwrap();
    assert!((170.0..190.0).contains(&az), "azimuth {az}");
    assert!((60.0..62.0).contains(&el), "elevation {el}");
    let dir = noon["direction"].as_array().unwrap();
    assert!(
        dir[1].as_f64().unwrap() > 0.0,
        "the sun is towards +y (south)"
    );
    assert_eq!(snapshot(&doc), before);
    assert_eq!(doc.can_undo(), could_undo);
    // The stored time is unchanged
    assert_eq!(run(&r, &mut doc, "sun_get", json!({}))["time"], "09:00");
}

#[test]
fn sun_get_refuses_invalid_moments_and_reports_the_default_location() {
    let r = Registry::standard();
    let mut doc = berlin(&r);
    run_err(&r, &mut doc, "sun_get", json!({ "at": "2026-06-21 13:00" }));
    run_err(&r, &mut doc, "sun_get", json!({ "at": "2026-03-29T02:30" }));
    let mut fresh = new_doc(&r);
    let sun = run(&r, &mut fresh, "sun_get", json!({}));
    assert_eq!(sun["location_set"], json!(false));
    assert_eq!(sun["follow_clock"], json!(false));
    assert!(!fresh.can_undo());
}

#[test]
fn render_settings_change_lens_lights_and_size() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    assert_eq!(
        run(&r, &mut doc, "render_settings_get", json!({})),
        json!({ "lens": "pinhole", "ceiling_lights": false, "width": null, "height": null })
    );
    assert!(!doc.can_undo());
    let before = snapshot(&doc);
    let photo = run(
        &r,
        &mut doc,
        "render_settings_update",
        json!({ "lens": "fisheye", "ceiling_lights": true, "width": 4, "height": 20000 }),
    );
    assert_eq!(
        photo,
        json!({ "lens": "fisheye", "ceiling_lights": true, "width": 16, "height": 8192 })
    );
    // Both cameras get the lens
    let lenses: Vec<Option<&str>> = doc
        .home()
        .cameras
        .iter()
        .map(|c| c.attrs.lens.as_deref())
        .collect();
    assert_eq!(lenses, [Some("FISHEYE"), Some("FISHEYE")]);
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let off = run(
        &r,
        &mut doc,
        "render_settings_update",
        json!({ "ceiling_lights": false }),
    );
    assert_eq!(off["ceiling_lights"], json!(false));
    assert_eq!(off["lens"], "fisheye");
    run_err(
        &r,
        &mut doc,
        "render_settings_update",
        json!({ "lens": "tilt-shift" }),
    );
}

#[test]
fn render_settings_are_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "render_settings_update",
        json!({ "lens": "spherical", "ceiling_lights": true, "width": 2000, "height": 1000 }),
    );
    let mut reopened = save_and_reopen(&r, &mut doc, "sun-render-settings");
    assert_eq!(
        run(&r, &mut reopened, "render_settings_get", json!({})),
        json!({ "lens": "spherical", "ceiling_lights": true, "width": 2000, "height": 1000 })
    );
}

#[test]
fn view3d_update_clamps_and_can_be_undone() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let before = snapshot(&doc);
    let v = run(
        &r,
        &mut doc,
        "view3d_update",
        json!({ "sky_color": "#102030", "light_brightness": 500, "walls_transparency": 99,
                "all_levels_visible": true }),
    );
    assert_eq!(v["sky_color"], "#102030");
    assert_eq!(v["light_brightness"], json!(120.0));
    assert_eq!(v["walls_transparency"], json!(90.0));
    assert_eq!(v["all_levels_visible"], json!(true));
    assert_eq!(v["ground_texture"], Value::Null);
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    let dark = run(
        &r,
        &mut doc,
        "view3d_update",
        json!({ "light_brightness": -10, "walls_transparency": -5 }),
    );
    assert_eq!(dark["light_brightness"], json!(0.0));
    assert_eq!(dark["walls_transparency"], json!(0.0));
}

#[test]
fn view3d_update_refuses_invalid_colors_and_textures() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    for bad in [
        json!({ "ground_color": "green" }),
        json!({ "sky_color": "#12345" }),
        json!({ "ground_texture": "no-such#texture" }),
        json!({ "sky_texture": "no-such#texture", "light_brightness": 50 }),
    ] {
        run_err(&r, &mut doc, "view3d_update", bad);
    }
    assert!(doc.home().environment.is_none());
    // "" for a texture just means none
    let v = run(
        &r,
        &mut doc,
        "view3d_update",
        json!({ "ground_texture": "", "sky_texture": "" }),
    );
    assert_eq!(v["ground_texture"], Value::Null);
}

#[test]
fn view3d_settings_are_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "view3d_update",
        json!({ "ground_color": "#445566", "sky_color": "#AABBCC", "light_brightness": 80,
                "walls_transparency": 25 }),
    );
    let reopened = save_and_reopen(&r, &mut doc, "sun-view3d-save");
    let a = &reopened.home().environment.as_ref().unwrap().attrs;
    assert_eq!(a.ground_color.map(|c| c.0 & 0xFF_FFFF), Some(0x445566));
    assert_eq!(a.sky_color.map(|c| c.0 & 0xFF_FFFF), Some(0xAABBCC));
    assert_eq!(a.walls_alpha, Some(0.25));
    let mut reopened = reopened;
    let v = run(&r, &mut reopened, "view3d_update", json!({}));
    assert_eq!(v["light_brightness"], json!(80.0));
}
