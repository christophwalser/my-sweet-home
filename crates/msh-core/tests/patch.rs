//! The changes sent to a window after a command: applied to the state before, they must give
//! exactly the state after.

mod common;

use common::*;
use msh_core::patch::{HomeChanges, ListPatch, home_changes};
use msh_core::{Document, Registry};
use msh_geometry::wall_shapes;
use msh_model::Home;
use serde_json::{Value, json};

/// ID of an element of a list: `attrs.id`, or `id` for wall outlines.
fn id_of(v: &Value) -> Option<&str> {
    v["attrs"]["id"].as_str().or_else(|| v["id"].as_str())
}

/// Applies the patch of a list like the window does.
fn patch_list(prev: &Value, patch: &ListPatch) -> Value {
    let prev = prev.as_array().cloned().unwrap_or_default();
    let changed = |id: &str| patch.changed.iter().find(|e| id_of(e) == Some(id)).cloned();
    match &patch.order {
        None => prev
            .iter()
            .map(|e| changed(id_of(e).unwrap()).unwrap_or_else(|| e.clone()))
            .collect(),
        Some(order) => order
            .iter()
            .map(|id| {
                changed(id).unwrap_or_else(|| {
                    prev.iter()
                        .find(|e| id_of(e) == Some(id.as_str()))
                        .unwrap_or_else(|| panic!("element {id} is neither old nor sent"))
                        .clone()
                })
            })
            .collect(),
    }
}

fn state(home: &Home) -> (Value, Value) {
    (
        serde_json::to_value(home).unwrap(),
        serde_json::to_value(wall_shapes(home)).unwrap(),
    )
}

/// The state `prev` with the changes applied.
fn applied(prev: &Home, changes: &HomeChanges) -> (Value, Value) {
    let (mut home, mut shapes) = state(prev);
    for (name, v) in &changes.fields {
        home[name] = v.clone();
    }
    for (name, patch) in &changes.lists {
        home[*name] = patch_list(&home[*name], patch);
    }
    if let Some(patch) = &changes.wall_shapes {
        shapes = patch_list(&shapes, patch);
    }
    (home, shapes)
}

/// Runs a command and checks that its changes turn the state before into the state after.
fn step(r: &Registry, doc: &mut Document, name: &str, params: Value) -> (Value, HomeChanges) {
    let before = doc.home().clone();
    let result = run(r, doc, name, params);
    let changes = home_changes(
        &before,
        doc.home(),
        &wall_shapes(&before),
        &wall_shapes(doc.home()),
    );
    let (mut expected_home, expected_shapes) = state(doc.home());
    let (mut home, shapes) = applied(&before, &changes);
    // An empty list of unknown children is left out when a home is written as a whole
    for h in [&mut expected_home, &mut home] {
        if h["extra_children"].as_array().is_some_and(Vec::is_empty) {
            h.as_object_mut().unwrap().remove("extra_children");
        }
    }
    assert_eq!(home, expected_home, "home after {name}");
    assert_eq!(shapes, expected_shapes, "wall outlines after {name}");
    (result, changes)
}

#[test]
fn changes_carry_only_what_a_command_changed() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let (walls, _) = step(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0], [400, 0], [400, 300], [0, 300]], "closed": true }),
    );
    let wall = walls["ids"][0].as_str().unwrap().to_owned();
    let (room, _) = step(
        &r,
        &mut doc,
        "room_add",
        json!({ "points": [[5, 5], [395, 5], [395, 295], [5, 295]] }),
    );
    let room = room["id"].as_str().unwrap().to_owned();
    step(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "a", "x": 0, "y": 0 }),
    );

    // A color: one wall, no outline, nothing else
    let (_, c) = step(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": wall, "left_side_color": "#336699" }),
    );
    assert!(c.fields.is_empty(), "{:?}", c.fields.keys());
    assert_eq!(c.lists.keys().copied().collect::<Vec<_>>(), ["walls"]);
    assert_eq!(c.lists["walls"].changed.len(), 1);
    assert_eq!(c.lists["walls"].order, None);
    assert_eq!(c.wall_shapes, None);

    // A move: the wall and the two joined to it, with their outlines
    let (_, c) = step(
        &r,
        &mut doc,
        "edit_move",
        json!({ "ids": [wall], "dx": 10, "dy": 0 }),
    );
    assert_eq!(c.lists.keys().copied().collect::<Vec<_>>(), ["walls"]);
    assert!(c.lists["walls"].changed.len() <= 3);
    assert!(c.wall_shapes.as_ref().is_some_and(|s| s.order.is_none()));

    // A room: only the room
    let (_, c) = step(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": room, "floor_color": "#AABBCC" }),
    );
    assert_eq!(c.lists.keys().copied().collect::<Vec<_>>(), ["rooms"]);
    assert_eq!(c.wall_shapes, None);

    // Added and deleted elements change the order of the IDs
    let (label, c) = step(
        &r,
        &mut doc,
        "label_add",
        json!({ "text": "b", "x": 9, "y": 9 }),
    );
    assert_eq!(c.lists["labels"].changed.len(), 1);
    assert_eq!(c.lists["labels"].order.as_ref().map(Vec::len), Some(2));
    let (_, c) = step(
        &r,
        &mut doc,
        "edit_delete",
        json!({ "ids": [label["id"], wall] }),
    );
    assert!(c.lists["labels"].changed.is_empty());
    assert_eq!(c.lists["labels"].order.as_ref().map(Vec::len), Some(1));
    assert_eq!(c.lists["walls"].order.as_ref().map(Vec::len), Some(3));

    // Undo and redo go through the same check
    step(&r, &mut doc, "edit_undo", json!({}));
    step(&r, &mut doc, "edit_redo", json!({}));
    step(&r, &mut doc, "level_add", json!({ "name": "First" }));
    let (_, c) = step(&r, &mut doc, "home_set", json!({ "wall_height": 270 }));
    assert_eq!(c.fields.keys().collect::<Vec<_>>(), ["attrs"]);
    assert!(c.lists.is_empty());
}

#[test]
fn equal_states_have_no_changes() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 100, "y_end": 0 }),
    );
    let shapes = wall_shapes(doc.home());
    assert!(home_changes(doc.home(), doc.home(), &shapes, &shapes).is_empty());
}
