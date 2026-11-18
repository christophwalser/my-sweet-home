//! Reverse walls, align and distribute furniture, paste style.

use msh_core::{Document, Registry};
use msh_model::{Color, Furniture, Piece, PieceAttrs};
use serde_json::{Value, json};

fn run(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    r.execute(doc, name, params)
        .unwrap_or_else(|e| panic!("{name} failed: {e}"))
}

fn add_piece(doc: &mut Document, id: &str, x: f32, y: f32, w: f32, d: f32, angle_deg: f32) {
    doc.home_mut()
        .furniture
        .push(Furniture::Piece(Box::new(Piece {
            attrs: PieceAttrs {
                id: Some(id.into()),
                name: id.into(),
                x,
                y,
                width: w,
                depth: d,
                height: 80.0,
                angle: Some(angle_deg.to_radians()),
                ..Default::default()
            },
            ..Default::default()
        })));
}

fn piece(doc: &Document, id: &str) -> PieceAttrs {
    let mut found = None;
    doc.home().for_each_piece(|p| {
        if p.attrs.id.as_deref() == Some(id) {
            found = Some(p.attrs.clone());
        }
    });
    found.unwrap()
}

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() < 0.01
}

#[test]
fn reversed_walls_keep_their_look() {
    let r = Registry::standard();
    let mut doc = Document::default();
    let added = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 400, "y_end": 0, "height": 250 }),
    );
    let id = added["id"].as_str().unwrap().to_string();
    {
        let w = &mut doc.home_mut().walls[0];
        w.attrs.height_at_end = Some(300.0);
        w.attrs.arc_extent = Some(0.5);
        w.attrs.left_side_color = Some(Color(0xFFFF0000));
        w.attrs.right_side_color = Some(Color(0xFF0000FF));
    }
    let before = doc.home().walls[0].clone();
    run(&r, &mut doc, "wall_reverse", json!({ "ids": [id] }));
    let a = &doc.home().walls[0].attrs;
    assert_eq!((a.x_start, a.x_end), (400.0, 0.0));
    assert_eq!((a.height, a.height_at_end), (Some(300.0), Some(250.0)));
    assert_eq!(a.arc_extent, Some(-0.5));
    assert_eq!(a.left_side_color, Some(Color(0xFF0000FF)));
    // Twice is the original wall
    run(&r, &mut doc, "wall_reverse", json!({ "ids": [id] }));
    assert_eq!(doc.home().walls[0], before);
}

#[test]
fn furniture_aligns_to_the_leading_piece() {
    let r = Registry::standard();
    let mut doc = Document::default();
    add_piece(&mut doc, "lead", 100.0, 100.0, 100.0, 50.0, 0.0);
    add_piece(&mut doc, "a", 300.0, 220.0, 60.0, 40.0, 0.0);

    run(
        &r,
        &mut doc,
        "furniture_align",
        json!({ "ids": ["a", "lead"], "how": "left" }),
    );
    assert!(close(piece(&doc, "a").x, 80.0)); // left side at 50
    run(
        &r,
        &mut doc,
        "furniture_align",
        json!({ "ids": ["a", "lead"], "how": "back" }),
    );
    assert!(close(piece(&doc, "a").y, 95.0)); // back side at 75
    run(
        &r,
        &mut doc,
        "furniture_align",
        json!({ "ids": ["a", "lead"], "how": "right" }),
    );
    assert!(close(piece(&doc, "a").x, 120.0)); // right side at 150

    // Elevation: top heights or bottoms match
    if let Furniture::Piece(p) = &mut doc.home_mut().furniture[0] {
        p.attrs.elevation = Some(40.0);
        p.attrs.height = 100.0;
    }
    run(
        &r,
        &mut doc,
        "furniture_align",
        json!({ "ids": ["a", "lead"], "how": "top" }),
    );
    assert!(close(piece(&doc, "a").elevation.unwrap(), 60.0));
    run(
        &r,
        &mut doc,
        "furniture_align",
        json!({ "ids": ["a", "lead"], "how": "bottom" }),
    );
    assert!(close(piece(&doc, "a").elevation.unwrap(), 40.0));

    // A leading piece turned by 90°: its front faces -x
    add_piece(&mut doc, "turned", 0.0, 0.0, 100.0, 50.0, 90.0);
    run(
        &r,
        &mut doc,
        "furniture_align",
        json!({ "ids": ["a", "turned"], "how": "front" }),
    );
    // Front of "turned" at x = -25; "a" (60 x 40, not turned) has its extent -30 .. 30 along -x
    assert!(close(piece(&doc, "a").x, 5.0), "{}", piece(&doc, "a").x);
}

#[test]
fn furniture_side_by_side_and_distributed() {
    let r = Registry::standard();
    let mut doc = Document::default();
    add_piece(&mut doc, "p1", 0.0, 0.0, 20.0, 20.0, 0.0);
    add_piece(&mut doc, "p2", 50.0, 10.0, 20.0, 20.0, 0.0);
    add_piece(&mut doc, "p3", 200.0, 0.0, 20.0, 20.0, 0.0);

    let result = run(
        &r,
        &mut doc,
        "furniture_distribute",
        json!({ "ids": ["p1", "p2", "p3"], "axis": "horizontal" }),
    );
    assert_eq!(result["gap"], json!(80.0));
    assert!(close(piece(&doc, "p2").x, 100.0));
    assert!(close(piece(&doc, "p2").y, 10.0), "only x changes");

    run(
        &r,
        &mut doc,
        "furniture_align",
        json!({ "ids": ["p1", "p2", "p3"], "how": "side_by_side", "leader": "p1" }),
    );
    assert!(close(piece(&doc, "p2").x, 20.0));
    assert!(close(piece(&doc, "p3").x, 40.0));
    assert!(
        r.execute(
            &mut doc,
            "furniture_distribute",
            json!({ "ids": ["p1", "p2"], "axis": "vertical" })
        )
        .is_err()
    );
}

#[test]
fn style_of_the_copied_element_is_pasted() {
    let r = Registry::standard();
    let mut doc = Document::default();
    let w1 = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 400, "y_end": 0, "thickness": 30 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_string();
    let w2 = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 300, "x_end": 400, "y_end": 300, "thickness": 10 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_string();
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": w1, "left_side_color": "#AA3300", "pattern": "crossHatch" }),
    );
    add_piece(&mut doc, "chair", 100.0, 100.0, 40.0, 40.0, 0.0);
    run(&r, &mut doc, "edit_copy", json!({ "ids": [w1] }));
    // Only elements of the copied kind change
    let styled = run(
        &r,
        &mut doc,
        "edit_paste_style",
        json!({ "ids": [w2, "chair"] }),
    );
    assert_eq!(styled["styled"], json!(1));
    let a = &doc.home().walls[1].attrs;
    assert_eq!(a.left_side_color, Some(Color(0xFFAA3300)));
    assert_eq!(a.pattern.as_deref(), Some("crossHatch"));
    // Geometry stays, the thickness too
    assert_eq!(a.thickness, 10.0);
    assert_eq!((a.y_start, a.y_end), (300.0, 300.0));
    assert!(
        r.execute(&mut doc, "edit_paste_style", json!({ "ids": ["chair"] }))
            .is_err()
    );
}

#[test]
fn doors_and_windows_follow_the_wall_thickness() {
    use msh_model::PieceKind;
    let r = Registry::standard();
    let mut doc = Document::default();
    let wall = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 400, "y_end": 0, "thickness": 20 }),
    )["id"]
        .as_str()
        .unwrap()
        .to_string();
    // A window whose back half is the wall part (wallThickness 0.5, wallDistance 0)
    doc.home_mut()
        .furniture
        .push(Furniture::Piece(Box::new(Piece {
            kind: PieceKind::DoorOrWindow,
            attrs: PieceAttrs {
                id: Some("window".into()),
                name: "Window".into(),
                x: 150.0,
                y: 10.0,
                width: 100.0,
                depth: 40.0,
                height: 120.0,
                wall_thickness: Some(0.5),
                wall_distance: Some(0.0),
                ..Default::default()
            },
            ..Default::default()
        })));
    // A piece in another wall direction is not touched
    add_piece(&mut doc, "table", 300.0, 0.0, 80.0, 80.0, 0.0);

    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": wall, "thickness": 30 }),
    );
    // Thicker than the wall part (20 cm): the window keeps its depth instead of stretching
    // frame and handle, sits flush with the side it opens to (front, +y) and cuts the whole wall
    let w = piece(&doc, "window");
    assert!(close(w.depth, 40.0), "depth {}", w.depth);
    // Wall part from y 5 to 15 (flush with the wall side at 15), so the center is at 15
    assert!(close(w.y, 15.0), "y {}", w.y);
    assert!(close(w.x, 150.0));
    assert_eq!(w.wall_cut_out_on_both_sides, Some(true));
    assert!(close(piece(&doc, "table").depth, 80.0));

    // Thinner than the wall part: the depth follows the wall, the wall part centered on it
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": wall, "thickness": 10 }),
    );
    let w = piece(&doc, "window");
    assert!(close(w.depth, 20.0), "depth {}", w.depth);
    assert!(close(w.y, 5.0), "y {}", w.y);
}
