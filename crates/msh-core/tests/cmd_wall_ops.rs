//! Tests of joining, detaching, splitting and angling walls (wall_join, wall_detach,
//! wall_split, wall_set_angle).

mod common;

use common::*;
use msh_core::{Document, Registry};
use msh_model::WallAttrs;
use serde_json::json;

fn wall(doc: &Document, id: &str) -> WallAttrs {
    doc.home()
        .walls
        .iter()
        .find(|w| w.attrs.id == id)
        .unwrap_or_else(|| panic!("no wall {id}"))
        .attrs
        .clone()
}

fn add_wall(r: &Registry, doc: &mut Document, from: [f32; 2], to: [f32; 2]) -> String {
    let v = run(
        r,
        doc,
        "wall_add",
        json!({ "x_start": from[0], "y_start": from[1], "x_end": to[0], "y_end": to[1] }),
    );
    v["id"].as_str().unwrap().to_owned()
}

fn path(r: &Registry, doc: &mut Document, points: serde_json::Value) -> Vec<String> {
    ids(
        &run(r, doc, "wall_add_path", json!({ "points": points })),
        "ids",
    )
}

// ---------------------------------------------------------------- wall_set_angle

#[test]
fn set_angle_rotates_around_the_corner_and_drags_the_next_wall() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let w = path(
        &r,
        &mut doc,
        json!([[0, 0], [300, 0], [400, 200], [600, 200]]),
    );
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "wall_set_angle",
        json!({ "id": w[1], "at": "start", "angle_deg": 90 }),
    );
    assert_eq!(res["id"], json!(w[1]));
    let moved: [f32; 2] = serde_json::from_value(res["moved_end"].clone()).unwrap();
    assert!(
        close(moved[0], 300.0) && close(moved[1], 223.61),
        "{moved:?}"
    );
    let b = wall(&doc, &w[1]);
    assert_eq!((b.x_start, b.y_start), (300.0, 0.0), "corner stays");
    assert!(close(b.x_end, 300.0) && close(b.y_end, 223.61), "{b:?}");
    let c = wall(&doc, &w[2]);
    assert_eq!(
        (c.x_start, c.y_start),
        (b.x_end, b.y_end),
        "next wall follows"
    );
    assert_eq!((c.x_end, c.y_end), (600.0, 200.0));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn set_angle_at_the_end_keeps_the_side_of_the_wall() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    // The first wall is rotated around its end, where the reference wall is joined
    let w = path(&r, &mut doc, json!([[0, -100], [200, 0], [500, 0]]));
    run(
        &r,
        &mut doc,
        "wall_set_angle",
        json!({ "id": w[0], "at": "end", "angle_deg": 45 }),
    );
    let a = wall(&doc, &w[0]);
    assert_eq!((a.x_end, a.y_end), (200.0, 0.0), "corner stays");
    let len = 100f32.hypot(200.0);
    let expected = (
        200.0 + len * 45f32.to_radians().cos(),
        -len * 45f32.to_radians().sin(),
    );
    assert!(
        (a.x_start - expected.0).abs() < 0.02 && (a.y_start - expected.1).abs() < 0.02,
        "stays above the reference wall: {a:?}"
    );
}

#[test]
fn set_angle_rejects_invalid_input() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let w = path(&r, &mut doc, json!([[0, 0], [300, 0], [300, 300]]));
    for angle in [0.0, 360.0, -10.0, 400.0] {
        let err = run_err(
            &r,
            &mut doc,
            "wall_set_angle",
            json!({ "id": w[1], "at": "start", "angle_deg": angle }),
        );
        assert!(err.contains("between 0 and 360"), "{err}");
    }
    run_err(
        &r,
        &mut doc,
        "wall_set_angle",
        json!({ "id": "wall-nope", "at": "start", "angle_deg": 90 }),
    );
    let err = run_err(
        &r,
        &mut doc,
        "wall_set_angle",
        json!({ "id": w[0], "at": "start", "angle_deg": 90 }),
    );
    assert!(err.contains("not joined"), "{err}");
    run_err(
        &r,
        &mut doc,
        "wall_set_angle",
        json!({ "id": w[1], "at": "middle", "angle_deg": 90 }),
    );
    let arc = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 300, "y_start": 300, "x_end": 0, "y_end": 300,
                "arc_extent_deg": 60, "join_at_start": w[1] }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let err = run_err(
        &r,
        &mut doc,
        "wall_set_angle",
        json!({ "id": arc, "at": "start", "angle_deg": 90 }),
    );
    assert!(err.contains("arc"), "{err}");
}

#[test]
fn set_angle_of_a_wall_without_length_fails() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let a = add_wall(&r, &mut doc, [0.0, 0.0], [300.0, 0.0]);
    let b = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 300, "y_start": 0, "x_end": 300, "y_end": 0, "join_at_start": a }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let err = run_err(
        &r,
        &mut doc,
        "wall_set_angle",
        json!({ "id": b, "at": "start", "angle_deg": 90 }),
    );
    assert!(err.contains("no length"), "{err}");
}

// ---------------------------------------------------------------- wall_join

#[test]
fn join_makes_a_t_junction_when_the_point_lies_inside_a_wall() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let a = add_wall(&r, &mut doc, [0.0, 0.0], [400.0, 0.0]);
    let b = add_wall(&r, &mut doc, [200.0, 50.0], [200.0, 300.0]);
    let before = snapshot(&doc);
    let res = run(&r, &mut doc, "wall_join", json!({ "ids": [a, b] }));
    assert_eq!(res, json!({ "joined": "t", "point": [200.0, 0.0] }));
    let (wa, wb) = (wall(&doc, &a), wall(&doc, &b));
    assert_eq!(
        (wa.x_start, wa.x_end),
        (0.0, 400.0),
        "the through wall stays"
    );
    assert_eq!(
        (wb.x_start, wb.y_start),
        (200.0, 0.0),
        "the other ends on its axis"
    );
    assert_eq!((wb.wall_at_start, wa.wall_at_end), (None, None));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn join_adds_a_third_wall_to_two_joined_walls() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    // a and b form a corner at (300, 0); c starts near the free end of b
    let w = path(&r, &mut doc, json!([[0, 0], [300, 0], [300, 200]]));
    let (a, b) = (w[0].clone(), w[1].clone());
    let c = add_wall(&r, &mut doc, [310.0, 210.0], [500.0, 210.0]);
    let before = snapshot(&doc);
    let res = run(&r, &mut doc, "wall_join", json!({ "ids": [a, b, c] }));
    assert_eq!(res["joined"].as_array().map(Vec::len), Some(1), "{res}");
    let (wa, wb, wc) = (wall(&doc, &a), wall(&doc, &b), wall(&doc, &c));
    assert_eq!(
        wa.wall_at_end.as_deref(),
        Some(b.as_str()),
        "the corner a-b stays"
    );
    assert_eq!(wb.wall_at_start.as_deref(), Some(a.as_str()));
    assert_eq!(wb.wall_at_end.as_deref(), Some(c.as_str()));
    assert_eq!(wc.wall_at_start.as_deref(), Some(b.as_str()));
    assert_eq!((wb.x_end, wb.y_end), (300.0, 210.0));
    assert_eq!((wc.x_start, wc.y_start), (300.0, 210.0));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    // Nothing left to join
    let err = run_err(&r, &mut doc, "wall_join", json!({ "ids": [a, b, c] }));
    assert!(err.contains("joined already"), "{err}");
}

#[test]
fn join_connects_collinear_walls_in_the_middle_of_the_gap() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let a = add_wall(&r, &mut doc, [0.0, 0.0], [100.0, 0.0]);
    let b = add_wall(&r, &mut doc, [110.0, 0.0], [200.0, 0.0]);
    let res = run(&r, &mut doc, "wall_join", json!({ "ids": [a, b] }));
    assert_eq!(res, json!({ "joined": "corner", "point": [105.0, 0.0] }));
    let (wa, wb) = (wall(&doc, &a), wall(&doc, &b));
    assert_eq!((wa.x_end, wb.x_start), (105.0, 105.0));
    assert_eq!(wa.wall_at_end.as_deref(), Some(b.as_str()));
    assert_eq!(wb.wall_at_start.as_deref(), Some(a.as_str()));

    let reopened = save_and_reopen(&r, &mut doc, "wall_join_collinear");
    assert_eq!(wall(&reopened, &a).wall_at_end.as_deref(), Some(b.as_str()));
    assert_eq!(
        wall(&reopened, &b).wall_at_start.as_deref(),
        Some(a.as_str())
    );
    assert_eq!(wall(&reopened, &a).x_end, 105.0);
}

#[test]
fn join_replaces_a_previous_join_at_that_end() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let w = path(&r, &mut doc, json!([[0, 0], [100, 0], [100, 100]]));
    let c = add_wall(&r, &mut doc, [100.0, -10.0], [100.0, -200.0]);
    run(&r, &mut doc, "wall_join", json!({ "ids": [w[0], c] }));
    let a = wall(&doc, &w[0]);
    assert_eq!(a.wall_at_end.as_deref(), Some(c.as_str()));
    assert_eq!(
        wall(&doc, &w[1]).wall_at_start,
        None,
        "the old partner forgets the join"
    );
    let wc = wall(&doc, &c);
    assert_eq!((wc.x_start, wc.y_start), (100.0, 0.0));
    assert_eq!(wc.wall_at_start.as_deref(), Some(w[0].as_str()));
}

#[test]
fn join_rejects_invalid_pairs() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let a = add_wall(&r, &mut doc, [0.0, 0.0], [400.0, 0.0]);
    let parallel = add_wall(&r, &mut doc, [0.0, 50.0], [400.0, 50.0]);
    let crossing = add_wall(&r, &mut doc, [200.0, -100.0], [200.0, 100.0]);
    let point = add_wall(&r, &mut doc, [600.0, 0.0], [600.0, 0.0]);
    let arc = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 300, "x_end": 300, "y_end": 300, "arc_extent_deg": 90 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let cases = [
        (json!([a]), "at least two"),
        (json!([a, a]), "itself"),
        (json!([a, "wall-nope"]), "unknown wall"),
        (json!([a, parallel]), "parallel"),
        (json!([a, crossing]), "cross"),
        (json!([a, point]), "no length"),
        (json!([a, arc]), "arc"),
    ];
    for (ids, msg) in cases {
        let err = run_err(&r, &mut doc, "wall_join", json!({ "ids": ids }));
        assert!(err.contains(msg), "{ids}: {err}");
    }
}

#[test]
fn join_rejects_walls_on_different_levels() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let l0 = run(&r, &mut doc, "level_add", json!({ "name": "Ground" }))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    run(&r, &mut doc, "level_add", json!({ "name": "Upper" }));
    let lower = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 300, "y_end": 0, "level": l0 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let upper = add_wall(&r, &mut doc, [310.0, 10.0], [310.0, 300.0]);
    let err = run_err(&r, &mut doc, "wall_join", json!({ "ids": [lower, upper] }));
    assert!(err.contains("different levels"), "{err}");
}

// ---------------------------------------------------------------- wall_detach

#[test]
fn detach_removes_the_joins_on_both_sides() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let w = ids(
        &run(
            &r,
            &mut doc,
            "wall_add_path",
            json!({ "points": [[0, 0], [300, 0], [150, 200]], "closed": true }),
        ),
        "ids",
    );
    let before = snapshot(&doc);
    let res = run(&r, &mut doc, "wall_detach", json!({ "ids": [w[0]] }));
    assert_eq!(res, json!({ "detached": [w[0]] }));
    let a = wall(&doc, &w[0]);
    assert_eq!((a.wall_at_start, a.wall_at_end), (None, None));
    assert_eq!(wall(&doc, &w[1]).wall_at_start, None);
    assert_eq!(wall(&doc, &w[2]).wall_at_end, None);
    assert_eq!(
        wall(&doc, &w[1]).wall_at_end.as_deref(),
        Some(w[2].as_str()),
        "other joins stay"
    );
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "wall_detach");
    assert_eq!(wall(&reopened, &w[1]).wall_at_start, None);
    assert_eq!(wall(&reopened, &w[0]).wall_at_end, None);
}

#[test]
fn detach_with_an_unknown_wall_changes_nothing() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let w = path(&r, &mut doc, json!([[0, 0], [300, 0], [300, 300]]));
    // The first wall would be detached before the unknown ID is found: rolled back
    run_err(
        &r,
        &mut doc,
        "wall_detach",
        json!({ "ids": [w[0], "wall-nope"] }),
    );
}

#[test]
fn join_merges_the_parts_of_a_split_wall() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let w = path(&r, &mut doc, json!([[0, 0], [400, 0], [400, 300]]));
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "ids": [w[0]], "height": 300, "height_at_end": 200 }),
    );
    let parts = ids(
        &run(
            &r,
            &mut doc,
            "wall_split",
            json!({ "id": w[0], "at": [100, 0] }),
        ),
        "ids",
    );
    let before = snapshot(&doc);
    // Selected in reverse order: the second part stays and reaches the start of the first
    let res = run(
        &r,
        &mut doc,
        "wall_join",
        json!({ "ids": [parts[1], parts[0]] }),
    );
    assert_eq!(res["joined"], "merged");
    assert_eq!(res["removed"], json!(parts[0]));
    assert_eq!(doc.home().walls.len(), 2);
    let m = wall(&doc, &parts[1]);
    assert_eq!(
        (m.x_start, m.y_start, m.x_end, m.y_end),
        (0.0, 0.0, 400.0, 0.0)
    );
    assert_eq!((m.height, m.height_at_end), (Some(300.0), Some(200.0)));
    assert_eq!(m.wall_at_start, None);
    assert_eq!(m.wall_at_end.as_deref(), Some(w[1].as_str()));
    assert_eq!(
        wall(&doc, &w[1]).wall_at_start.as_deref(),
        Some(parts[1].as_str())
    );
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    // Collinear walls with a gap or of different thickness are joined, not merged
    let a = add_wall(&r, &mut doc, [0.0, 500.0], [100.0, 500.0]);
    let b = add_wall(&r, &mut doc, [150.0, 500.0], [300.0, 500.0]);
    let res = run(&r, &mut doc, "wall_join", json!({ "ids": [a, b] }));
    assert_eq!(res["joined"], "corner");
    assert_eq!(doc.home().walls.len(), 4);
}

// ---------------------------------------------------------------- wall_split

#[test]
fn split_at_a_projected_point_keeps_the_joins() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let w = path(&r, &mut doc, json!([[0, 0], [400, 0], [400, 300]]));
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "wall_split",
        json!({ "id": w[0], "at": [100, 50] }),
    );
    let parts = ids(&res, "ids");
    assert_eq!(parts[0], w[0], "the first part keeps the ID");
    let (p1, p2) = (wall(&doc, &parts[0]), wall(&doc, &parts[1]));
    assert_eq!(
        (p1.x_end, p1.y_end),
        (100.0, 0.0),
        "projected onto the axis"
    );
    assert_eq!((p2.x_start, p2.y_start, p2.x_end), (100.0, 0.0, 400.0));
    assert_eq!(p1.wall_at_end.as_deref(), Some(parts[1].as_str()));
    assert_eq!(p2.wall_at_start.as_deref(), Some(parts[0].as_str()));
    assert_eq!(p2.wall_at_end.as_deref(), Some(w[1].as_str()));
    assert_eq!(
        wall(&doc, &w[1]).wall_at_start.as_deref(),
        Some(parts[1].as_str()),
        "the wall joined at the old end now joins the second part"
    );
    // The second part comes right after the first
    assert_eq!(doc.home().walls[1].attrs.id, parts[1]);
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "wall_split");
    assert_eq!(reopened.home().walls.len(), 3);
    assert_eq!(
        wall(&reopened, &w[1]).wall_at_start.as_deref(),
        Some(parts[1].as_str())
    );
}

#[test]
fn split_interpolates_the_height_of_sloping_walls() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 400, "y_end": 0,
                "height": 300, "height_at_end": 200 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let parts = ids(
        &run(
            &r,
            &mut doc,
            "wall_split",
            json!({ "id": id, "at": [100, 0] }),
        ),
        "ids",
    );
    let (p1, p2) = (wall(&doc, &parts[0]), wall(&doc, &parts[1]));
    assert_eq!((p1.height, p1.height_at_end), (Some(300.0), Some(275.0)));
    assert_eq!((p2.height, p2.height_at_end), (Some(275.0), Some(200.0)));
}

#[test]
fn split_rejects_points_at_the_ends_arcs_and_unknown_walls() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = add_wall(&r, &mut doc, [0.0, 0.0], [400.0, 0.0]);
    for at in [
        json!([0, 0]),
        json!([399.5, 0]),
        json!([500, 0]),
        json!([-50, 0]),
    ] {
        let err = run_err(&r, &mut doc, "wall_split", json!({ "id": id, "at": at }));
        assert!(err.contains("inside the wall"), "{at}: {err}");
    }
    run_err(&r, &mut doc, "wall_split", json!({ "id": "wall-nope" }));
    let arc = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 300, "x_end": 300, "y_end": 300, "arc_extent_deg": 90 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let err = run_err(&r, &mut doc, "wall_split", json!({ "id": arc }));
    assert!(err.contains("arc"), "{err}");
}
