//! Stair commands: stair_add, stair_update and stair_calc.

mod common;

use common::{check_undo_redo, close, new_doc, run, run_err, save_and_reopen, snapshot};
use msh_core::{Document, Registry};
use msh_model::Piece;
use serde_json::{Value, json};

const STAIR_PROPERTY: &str = "mySweetHome.stair";

fn piece(doc: &Document, id: &str) -> Piece {
    let mut found = None;
    doc.home().for_each_piece(|p| {
        if p.attrs.id.as_deref() == Some(id) {
            found = Some(p.clone());
        }
    });
    found.unwrap_or_else(|| panic!("no piece {id}"))
}

/// What the stair was made from, as stored in its property.
fn data(doc: &Document, id: &str) -> Value {
    let p = piece(doc, id);
    let value = &p
        .properties
        .iter()
        .find(|pr| pr.name == STAIR_PROPERTY)
        .expect("the piece has no stair property")
        .value;
    serde_json::from_str(value).unwrap()
}

/// Where the stair starts in the plan, from its piece and its data.
fn start(doc: &Document, id: &str) -> [f32; 2] {
    let p = piece(doc, id);
    let d = data(doc, id);
    let (sx, sy) = (
        d["start"][0].as_f64().unwrap() as f32,
        d["start"][1].as_f64().unwrap() as f32,
    );
    let (sin, cos) = p.attrs.angle.unwrap_or(0.0).sin_cos();
    [
        p.attrs.x + sx * cos - sy * sin,
        p.attrs.y + sx * sin + sy * cos,
    ]
}

/// A home with two levels: Level 0 from 0 to 250 cm, the floor of Level 1 at 262 cm.
fn two_levels(r: &Registry) -> (Document, String) {
    let mut doc = new_doc(r);
    run(r, &mut doc, "level_add", json!({ "name": "Upper floor" }));
    let ground = doc.home().levels[0].attrs.id.clone();
    (doc, ground)
}

fn model_text(doc: &Document, id: &str) -> String {
    let model = piece(doc, id).attrs.model.expect("the piece has no model");
    let entry = doc
        .file
        .contents
        .iter()
        .find(|c| c.name == model)
        .unwrap_or_else(|| panic!("the home has no resource {model}"));
    String::from_utf8(entry.data.clone()).unwrap()
}

#[test]
fn stair_add_makes_a_straight_stair_up_to_the_next_level() {
    let r = Registry::standard();
    let (mut doc, ground) = two_levels(&r);
    let before = snapshot(&doc);
    let added = run(
        &r,
        &mut doc,
        "stair_add",
        json!({ "x": 500, "y": 600, "level": ground }),
    );
    let after = snapshot(&doc);
    // 262 cm in 15 risers of 17.47 cm, treads by the step rule
    assert_eq!(added["risers"], 15);
    assert_eq!(added["riser"], 17.47);
    assert_eq!(added["tread"], 28.1);
    assert_eq!(added["step_length"], 63.03);
    assert_eq!(added["warnings"], json!([]));
    let id = added["id"].as_str().unwrap();
    let p = piece(&doc, id);
    let a = &p.attrs;
    assert_eq!(a.level.as_deref(), Some(ground.as_str()));
    assert!(close(a.width, 100.0), "{}", a.width);
    assert!(close(a.depth, 393.4), "{}", a.depth);
    // Up to the floor above, the handrails above that
    assert!(
        a.height > 262.0 + 80.0 && a.height < 262.0 + 100.0,
        "{}",
        a.height
    );
    // It climbs up the plan from its start
    assert!(
        close(a.x, 500.0) && close(a.y, 600.0 - 393.4 / 2.0),
        "{} {}",
        a.x,
        a.y
    );
    assert_eq!(a.resizable, Some(false));
    // The floor above is cut where the headroom of 2 m ends: from the third tread (its top at
    // 52 cm, the floor of 12 cm at 250 cm) to the top
    assert_eq!(
        a.staircase_cut_out_shape.as_deref(),
        Some("M0,0.8571 L1,0.8571 L1,0 L0,0 Z")
    );
    let d = data(&doc, id);
    assert_eq!(d["shape"], "straight");
    assert_eq!(d["flights"], json!([14]));
    assert_eq!(d["walk"].as_array().unwrap().len(), 2);
    // Edges of the treads seen from above: 15 across and 2 sides of each of 14 treads
    assert_eq!(d["lines"].as_array().unwrap().len(), 15 + 28);
    let model = model_text(&doc, id);
    assert!(model.contains("usemtl stair_steps") && model.contains("usemtl stair_frame"));
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn stair_add_turns_the_stair_towards_its_angle() {
    let r = Registry::standard();
    let (mut doc, ground) = two_levels(&r);
    let added = run(
        &r,
        &mut doc,
        "stair_add",
        json!({ "x": 0, "y": 0, "angle_deg": 90, "level": ground, "rails": "none" }),
    );
    let id = added["id"].as_str().unwrap();
    let a = piece(&doc, id).attrs;
    // Climbing to the right: the middle lies right of the start
    assert!(
        close(a.x, 393.4 / 2.0) && close(a.y, 0.0),
        "{} {}",
        a.x,
        a.y
    );
    let [x, y] = start(&doc, id);
    assert!(close(x, 0.0) && close(y, 0.0));
    // Without handrails the stair ends at the floor above
    assert!(close(a.height, 262.0));
}

#[test]
fn stair_update_keeps_the_start_and_follows_the_rise() {
    let r = Registry::standard();
    let (mut doc, ground) = two_levels(&r);
    let added = run(
        &r,
        &mut doc,
        "stair_add",
        json!({ "x": 400, "y": 500, "angle_deg": 30, "level": ground }),
    );
    let id = added["id"].as_str().unwrap().to_owned();
    let before = snapshot(&doc);
    let changed = run(
        &r,
        &mut doc,
        "stair_update",
        json!({ "id": id, "shape": "l", "turn": "left" }),
    );
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
    assert_eq!(changed["flights"], json!([7, 6]));
    let [x, y] = start(&doc, &id);
    assert!(close(x, 400.0) && close(y, 500.0), "{x} {y}");
    // An L turning left reaches out to the left of the first flight
    let a = piece(&doc, &id).attrs;
    assert!(close(a.width, 50.0 + 6.0 * 28.1 + 50.0), "{}", a.width);

    // A new rise gives a new riser count and a tread by the step rule
    let changed = run(
        &r,
        &mut doc,
        "stair_update",
        json!({ "id": id, "rise": 300 }),
    );
    assert_eq!(changed["risers"], 17);
    assert_eq!(changed["tread"], 27.7);
    // A given tread stays
    let changed = run(
        &r,
        &mut doc,
        "stair_update",
        json!({ "id": id, "tread": 25, "first_flight": 3 }),
    );
    assert_eq!(changed["tread"], 25.0);
    assert_eq!(changed["flights"], json!([3, 12]));
    assert_eq!(changed["warnings"], json!([]));
    let changed = run(
        &r,
        &mut doc,
        "stair_update",
        json!({ "id": id, "tread": 20 }),
    );
    assert_eq!(
        changed["warnings"],
        json!([{ "kind": "tread", "value": 20.0 }, { "kind": "step_rule", "value": 55.3 }])
    );
    let [x, y] = start(&doc, &id);
    assert!(close(x, 400.0) && close(y, 500.0), "{x} {y}");
}

#[test]
fn spiral_and_u_stairs() {
    let r = Registry::standard();
    let (mut doc, ground) = two_levels(&r);
    let added = run(
        &r,
        &mut doc,
        "stair_add",
        json!({ "x": 0, "y": 0, "level": ground, "shape": "spiral", "diameter": 180 }),
    );
    let id = added["id"].as_str().unwrap().to_owned();
    let a = piece(&doc, &id).attrs;
    // The steps run around the circle; their corners lie on it, not always at its extremes
    assert!((a.width - 180.0).abs() < 0.5 && (a.depth - 180.0).abs() < 0.5);
    assert_eq!(data(&doc, &id)["style"], "open");
    // The whole circle is cut out of the floor above
    let cut = a.staircase_cut_out_shape.unwrap();
    assert!(
        cut.starts_with('M') && cut.matches('L').count() == 31,
        "{cut}"
    );

    let changed = run(
        &r,
        &mut doc,
        "stair_update",
        json!({ "id": id, "shape": "u", "width": 90, "gap": 20, "style": "solid" }),
    );
    assert_eq!(changed["shape"], "u");
    let a = piece(&doc, &id).attrs;
    assert!(close(a.width, 90.0 + 20.0 + 90.0), "{}", a.width);
    let [x, y] = start(&doc, &id);
    assert!(close(x, 0.0) && close(y, 0.0), "{x} {y}");
    // Between spiral and other shapes the style follows the shape unless it is given
    run(
        &r,
        &mut doc,
        "stair_update",
        json!({ "id": id, "shape": "spiral" }),
    );
    assert_eq!(data(&doc, &id)["style"], "open");
    run(
        &r,
        &mut doc,
        "stair_update",
        json!({ "id": id, "shape": "l" }),
    );
    assert_eq!(data(&doc, &id)["style"], "solid");
    run(
        &r,
        &mut doc,
        "stair_update",
        json!({ "id": id, "shape": "straight", "style": "open" }),
    );
    assert_eq!(data(&doc, &id)["style"], "open");
}

#[test]
fn stair_calc_works_out_a_stair_without_adding_it() {
    let r = Registry::standard();
    let (mut doc, ground) = two_levels(&r);
    let before = snapshot(&doc);
    let calc = run(
        &r,
        &mut doc,
        "stair_calc",
        json!({ "level": ground, "shape": "straight", "width": 80 }),
    );
    assert_eq!(snapshot(&doc), before);
    assert_eq!(calc["rise"], 262.0);
    assert_eq!(calc["risers"], 15);
    assert_eq!(calc["width"], 80.0);
    assert_eq!(calc["depth"], 393.4);
    assert_eq!(
        calc["footprint"],
        json!([[-40.0, 0.0], [40.0, 0.0], [40.0, -393.4], [-40.0, -393.4]])
    );
    // Without a level above: the height of the level and its floor
    let mut single = new_doc(&r);
    let calc = run(&r, &mut single, "stair_calc", json!({}));
    assert_eq!(calc["rise"], 262.0);
}

#[test]
fn stair_survives_saving_and_refuses_what_it_cannot_make() {
    let r = Registry::standard();
    let (mut doc, ground) = two_levels(&r);
    let added = run(
        &r,
        &mut doc,
        "stair_add",
        json!({ "x": 0, "y": 0, "level": ground, "color": "#806040" }),
    );
    let id = added["id"].as_str().unwrap().to_owned();
    let mut reopened = save_and_reopen(&r, &mut doc, "stair_saved");
    assert_eq!(data(&reopened, &id)["color"], "#806040");
    assert!(
        piece(&reopened, &id)
            .attrs
            .staircase_cut_out_shape
            .is_some()
    );
    run(
        &r,
        &mut reopened,
        "stair_update",
        json!({ "id": id, "rails": "left" }),
    );
    assert_eq!(data(&reopened, &id)["rails"], "left");

    let err = run_err(
        &r,
        &mut reopened,
        "stair_update",
        json!({ "id": id, "shape": "l", "risers": 3 }),
    );
    assert!(err.contains("at least 4 risers"), "{err}");
    let err = run_err(
        &r,
        &mut reopened,
        "stair_update",
        json!({ "id": id, "color": "brown" }),
    );
    assert!(!err.is_empty());
    let roof = run(
        &r,
        &mut reopened,
        "roof_add",
        json!({ "points": [[0, 0], [300, 0], [300, 200], [0, 200]] }),
    );
    let err = run_err(
        &r,
        &mut reopened,
        "stair_update",
        json!({ "id": roof["id"] }),
    );
    assert!(err.contains("not a stair"), "{err}");
}

#[test]
fn exported_plans_show_stairs_and_openings_as_symbols() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(&r, &mut doc, "stair_add", json!({ "x": 0, "y": 0 }));
    run(
        &r,
        &mut doc,
        "opening_add",
        json!({ "points": [[200, 0], [400, 0], [400, 300], [200, 300]] }),
    );
    let path = common::out_dir("stair_export").join("plan.svg");
    run(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": path, "furniture_icons": "catalog" }),
    );
    let svg = std::fs::read_to_string(&path).unwrap();
    // The walking line starts at a dot and ends in an arrow; the opening is dashed and crossed
    assert_eq!(svg.matches("<circle").count(), 1);
    assert_eq!(svg.matches("<polyline").count(), 1);
    assert_eq!(svg.matches("stroke-dasharray").count(), 1);
    assert!(svg.matches("<line").count() >= 15 + 28 + 2);
    assert!(!svg.contains("<image"), "drawn as a picture");
}
