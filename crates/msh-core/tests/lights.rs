//! Tilting furniture, light power and light cones, photo settings.

use msh_core::{Document, Registry};
use msh_model::{Furniture, Piece, PieceAttrs, PieceKind};
use serde_json::{Value, json};

fn run(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    r.execute(doc, name, params)
        .unwrap_or_else(|e| panic!("{name} failed: {e}"))
}

fn add(doc: &mut Document, id: &str, kind: PieceKind) {
    doc.home_mut()
        .furniture
        .push(Furniture::Piece(Box::new(Piece {
            kind,
            attrs: PieceAttrs {
                id: Some(id.into()),
                name: id.into(),
                width: 12.0,
                depth: 29.5,
                height: 49.3,
                ..Default::default()
            },
            ..Default::default()
        })));
}

fn piece<'a>(doc: &'a Document, id: &str) -> &'a Piece {
    doc.home()
        .furniture
        .iter()
        .find_map(|f| match f {
            Furniture::Piece(p) if p.attrs.id.as_deref() == Some(id) => Some(p.as_ref()),
            _ => None,
        })
        .unwrap()
}

#[test]
fn tilted_pieces_get_their_size_in_plan() {
    let r = Registry::standard();
    let mut doc = Document::default();
    add(&mut doc, "lamp", PieceKind::Light);
    add(&mut doc, "door", PieceKind::DoorOrWindow);
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "lamp", "pitch_deg": 30, "roll_deg": 10 }),
    );
    let a = &piece(&doc, "lamp").attrs;
    // Same values as Sweet Home 3D computes for this lamp
    assert_eq!(
        (a.width_in_plan, a.depth_in_plan, a.height_in_plan),
        (Some(21.79), Some(50.2), Some(58.66))
    );
    // Back to straight: no size in plan any more
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "lamp", "pitch_deg": 0, "roll_deg": 0 }),
    );
    let a = &piece(&doc, "lamp").attrs;
    assert_eq!((a.pitch, a.roll, a.width_in_plan), (None, None, None));
    assert!(
        r.execute(
            &mut doc,
            "furniture_update",
            json!({ "id": "door", "pitch_deg": 5 })
        )
        .is_err()
    );
}

#[test]
fn light_power_and_cone() {
    let r = Registry::standard();
    let mut doc = Document::default();
    add(&mut doc, "lamp", PieceKind::Light);
    add(&mut doc, "chair", PieceKind::Piece);
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "lamp", "power": 80, "spot_angle_deg": 40 }),
    );
    let p = piece(&doc, "lamp");
    assert_eq!(p.attrs.power, Some(0.8));
    assert!(
        p.properties
            .iter()
            .any(|pr| pr.name == "mySweetHome.spotAngle" && pr.value == "40")
    );
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": "lamp", "spot_angle_deg": 0 }),
    );
    assert!(piece(&doc, "lamp").properties.is_empty());
    assert!(
        r.execute(
            &mut doc,
            "furniture_update",
            json!({ "id": "chair", "power": 50 })
        )
        .is_err()
    );
}

#[test]
fn photo_settings() {
    let r = Registry::standard();
    let mut doc = Document::default();
    let s = run(
        &r,
        &mut doc,
        "render_settings_update",
        json!({ "lens": "fisheye", "ceiling_lights": true, "width": 1200, "height": 1200 }),
    );
    assert_eq!(s["lens"], json!("fisheye"));
    assert_eq!(s["ceiling_lights"], json!(true));
    assert_eq!(s["width"], json!(1200));
    let lenses: Vec<_> = doc
        .home()
        .cameras
        .iter()
        .map(|c| c.attrs.lens.clone())
        .collect();
    assert!(lenses.iter().all(|l| l.as_deref() == Some("FISHEYE")));
    let s = run(
        &r,
        &mut doc,
        "render_settings_update",
        json!({ "ceiling_lights": false }),
    );
    assert_eq!(s["ceiling_lights"], json!(false));
}
