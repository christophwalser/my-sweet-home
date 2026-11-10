//! Tests of furniture groups: furniture_group and furniture_ungroup.

mod common;

use common::*;
use msh_core::{Document, Registry};
use msh_model::{Furniture, FurnitureGroup, Piece, PieceAttrs};
use serde_json::json;

fn piece(id: &str, x: f32, y: f32, size: [f32; 3]) -> Piece {
    Piece {
        attrs: PieceAttrs {
            id: Some(id.into()),
            name: id.into(),
            x,
            y,
            width: size[0],
            depth: size[1],
            height: size[2],
            ..Default::default()
        },
        ..Default::default()
    }
}

fn push(doc: &mut Document, p: Piece) {
    doc.home_mut().furniture.push(Furniture::Piece(Box::new(p)));
}

fn top_ids(doc: &Document) -> Vec<String> {
    doc.home()
        .furniture
        .iter()
        .map(|f| match f {
            Furniture::Piece(p) => p.attrs.id.clone().unwrap(),
            Furniture::Group(g) => g.attrs.id.clone().unwrap(),
        })
        .collect()
}

fn group(doc: &Document, id: &str) -> FurnitureGroup {
    doc.home()
        .furniture
        .iter()
        .find_map(|f| match f {
            Furniture::Group(g) if g.attrs.id.as_deref() == Some(id) => Some((**g).clone()),
            _ => None,
        })
        .unwrap_or_else(|| panic!("no group {id}"))
}

/// Home with the pieces c, a and b (in this order).
fn three_pieces(r: &Registry) -> Document {
    let mut doc = new_doc(r);
    push(&mut doc, piece("c", 1000.0, 1000.0, [10.0, 10.0, 10.0]));
    push(&mut doc, piece("a", 100.0, 100.0, [50.0, 40.0, 80.0]));
    let mut b = piece("b", 300.0, 200.0, [100.0, 60.0, 30.0]);
    b.attrs.elevation = Some(50.0);
    push(&mut doc, b);
    doc
}

// ---------------------------------------------------------------- furniture_group

#[test]
fn group_takes_the_bounding_box_of_its_pieces() {
    let r = Registry::standard();
    let mut doc = three_pieces(&r);
    let before = snapshot(&doc);
    let res = run(
        &r,
        &mut doc,
        "furniture_group",
        json!({ "ids": ["b", "a"] }),
    );
    let id = res["id"].as_str().unwrap().to_owned();
    assert!(id.starts_with("furnitureGroup-"), "{id}");
    assert_eq!(
        top_ids(&doc),
        ["c", id.as_str()],
        "at the place of the first member"
    );
    let g = group(&doc, &id);
    let members: Vec<_> = g
        .items
        .iter()
        .map(|f| match f {
            Furniture::Piece(p) => p.attrs.id.clone().unwrap(),
            Furniture::Group(_) => panic!("piece expected"),
        })
        .collect();
    assert_eq!(members, ["a", "b"], "order of the home is kept");
    let a = &g.attrs;
    assert_eq!(a.name, "Group");
    assert_eq!((a.x, a.y), (Some(212.5), Some(155.0)));
    assert_eq!((a.width, a.depth), (Some(275.0), Some(150.0)));
    assert_eq!((a.elevation, a.height), (Some(0.0), Some(80.0)));
    assert_eq!((a.angle, a.level.clone()), (Some(0.0), None));
    assert_eq!(doc.home().piece_count(), 3);
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);
}

#[test]
fn group_extent_follows_rotated_pieces() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let mut a = piece("a", 0.0, 0.0, [100.0, 20.0, 10.0]);
    a.attrs.angle = Some(90f32.to_radians());
    push(&mut doc, a);
    push(&mut doc, piece("b", 100.0, 0.0, [20.0, 20.0, 10.0]));
    let id = run(
        &r,
        &mut doc,
        "furniture_group",
        json!({ "ids": ["a", "b"], "name": "Rotated" }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let g = group(&doc, &id).attrs;
    assert_eq!(g.name, "Rotated");
    assert!(close(g.width.unwrap(), 120.0), "{g:?}");
    assert!(close(g.depth.unwrap(), 100.0), "{g:?}");
    assert!(
        close(g.x.unwrap(), 50.0) && close(g.y.unwrap(), 0.0),
        "{g:?}"
    );
}

#[test]
fn group_is_saved_with_its_pieces() {
    let r = Registry::standard();
    let mut doc = three_pieces(&r);
    let id = run(
        &r,
        &mut doc,
        "furniture_group",
        json!({ "ids": ["a", "b"], "name": "Set" }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let reopened = save_and_reopen(&r, &mut doc, "furniture_group");
    let g = group(&reopened, &id);
    assert_eq!(g.attrs.name, "Set");
    assert_eq!(g.items.len(), 2);
    assert_eq!((g.attrs.x, g.attrs.width), (Some(212.5), Some(275.0)));
    assert_eq!(reopened.home().piece_count(), 3);
}

#[test]
fn group_rejects_invalid_members() {
    let r = Registry::standard();
    let mut doc = three_pieces(&r);
    run(
        &r,
        &mut doc,
        "furniture_group",
        json!({ "ids": ["a", "b"] }),
    );
    if let Furniture::Piece(p) = &mut doc.home_mut().furniture[0] {
        p.attrs.level = Some("other-level".into());
    }
    push(&mut doc, piece("d", 0.0, 0.0, [10.0, 10.0, 10.0]));
    let cases = [
        (json!({ "ids": [] }), "at least two"),
        (json!({ "ids": ["d"] }), "at least two"),
        (
            json!({ "ids": ["d", "nope"] }),
            "not a piece or group on the top level",
        ),
        (
            json!({ "ids": ["d", "a"] }),
            "not a piece or group on the top level",
        ),
        (json!({ "ids": ["d", "c"] }), "different levels"),
    ];
    for (p, msg) in cases {
        let err = run_err(&r, &mut doc, "furniture_group", p.clone());
        assert!(err.contains(msg), "{p}: {err}");
    }
}

#[test]
fn group_rejects_the_same_piece_twice() {
    let r = Registry::standard();
    let mut doc = three_pieces(&r);
    run_err(
        &r,
        &mut doc,
        "furniture_group",
        json!({ "ids": ["a", "a"] }),
    );
}

#[test]
fn group_of_a_group_and_a_piece_nests() {
    let r = Registry::standard();
    let mut doc = three_pieces(&r);
    let inner = run(
        &r,
        &mut doc,
        "furniture_group",
        json!({ "ids": ["a", "b"] }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let outer = run(
        &r,
        &mut doc,
        "furniture_group",
        json!({ "ids": ["c", inner] }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(top_ids(&doc), [outer.as_str()]);
    assert_eq!(doc.home().piece_count(), 3);
    // Dissolving the outer group keeps the inner one
    let res = run(&r, &mut doc, "furniture_ungroup", json!({ "ids": [outer] }));
    assert_eq!(res["ids"], json!(["c", inner]));
    assert_eq!(top_ids(&doc), ["c", inner.as_str()]);
    assert_eq!(group(&doc, &inner).items.len(), 2);
}

// ---------------------------------------------------------------- furniture_ungroup

#[test]
fn ungroup_releases_pieces_in_place_with_the_group_level() {
    let r = Registry::standard();
    let mut doc = three_pieces(&r);
    let id = run(
        &r,
        &mut doc,
        "furniture_group",
        json!({ "ids": ["a", "b"] }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    // The group was moved to another level: its pieces follow when it is dissolved
    if let Furniture::Group(g) = &mut doc.home_mut().furniture[1] {
        g.attrs.level = Some("level-up".into());
    }
    let before = snapshot(&doc);
    let res = run(&r, &mut doc, "furniture_ungroup", json!({ "ids": [id] }));
    assert_eq!(res, json!({ "ids": ["a", "b"] }));
    assert_eq!(top_ids(&doc), ["c", "a", "b"], "at the place of the group");
    let mut found = Vec::new();
    doc.home().for_each_piece(|p| {
        found.push((
            p.attrs.id.clone().unwrap(),
            p.attrs.x,
            p.attrs.level.clone(),
        ))
    });
    assert_eq!(found[1], ("a".into(), 100.0, Some("level-up".into())));
    assert_eq!(found[2], ("b".into(), 300.0, Some("level-up".into())));
    let after = snapshot(&doc);
    check_undo_redo(&r, &mut doc, &before, &after);

    let reopened = save_and_reopen(&r, &mut doc, "furniture_ungroup");
    assert_eq!(reopened.home().furniture.len(), 3);
    assert!(
        reopened
            .home()
            .furniture
            .iter()
            .all(|f| matches!(f, Furniture::Piece(_)))
    );
}

#[test]
fn ungroup_rejects_pieces_and_unknown_ids() {
    let r = Registry::standard();
    let mut doc = three_pieces(&r);
    let id = run(
        &r,
        &mut doc,
        "furniture_group",
        json!({ "ids": ["a", "b"] }),
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    for ids in [json!(["c"]), json!(["nope"]), json!([id, "nope"])] {
        let err = run_err(&r, &mut doc, "furniture_ungroup", json!({ "ids": ids }));
        assert!(err.contains("not a group on the top level"), "{ids}: {err}");
    }
    run_err(&r, &mut doc, "furniture_ungroup", json!({}));
}
