//! Builds a small house through the command registry, like an AI agent would.

use msh_core::{Document, Registry};
use serde_json::{Value, json};

fn run(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    r.execute(doc, name, params)
        .unwrap_or_else(|e| panic!("{name} failed: {e}"))
}

#[test]
fn every_command_has_an_object_schema_and_description() {
    let r = Registry::standard();
    assert!(r.list().len() >= 20);
    for c in r.list() {
        assert_eq!(c.params_schema["type"], "object", "{}", c.name);
        assert!(!c.description.is_empty(), "{}", c.name);
        assert!(c.name.contains('_'), "{} must be group_action", c.name);
    }
}

#[test]
fn build_house_undo_redo_and_save() {
    let r = Registry::standard();
    let mut doc = Document::default();
    run(&r, &mut doc, "home_new", json!({ "name": "Test house" }));

    // Exterior walls 10 m x 8 m and one interior wall
    let outer = run(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0], [1000, 0], [1000, 800], [0, 800]], "closed": true, "thickness": 30 }),
    );
    let outer_ids: Vec<String> = serde_json::from_value(outer["ids"].clone()).unwrap();
    assert_eq!(outer_ids.len(), 4);
    run(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[600, 15], [600, 785]], "thickness": 10 }),
    );

    // The closed outline is joined all around
    let home = doc.home();
    for w in home.walls.iter().take(4) {
        assert!(w.attrs.wall_at_start.is_some() && w.attrs.wall_at_end.is_some());
    }

    run(
        &r,
        &mut doc,
        "room_add",
        json!({ "name": "Living room", "points": [[15, 15], [595, 15], [595, 785], [15, 785]] }),
    );
    run(
        &r,
        &mut doc,
        "room_add",
        json!({ "name": "Bedroom", "points": [[605, 15], [985, 15], [985, 785], [605, 785]], "floor_color": "#c8b89a" }),
    );
    assert_eq!(doc.home().rooms.len(), 2);

    // Undo removes the bedroom, redo brings it back
    run(&r, &mut doc, "edit_undo", json!({}));
    assert_eq!(doc.home().rooms.len(), 1);
    run(&r, &mut doc, "edit_redo", json!({}));
    assert_eq!(doc.home().rooms.len(), 2);

    // A failing command leaves the home unchanged and creates no undo step
    let walls_before = doc.home().walls.len();
    assert!(
        r.execute(&mut doc, "wall_add_path", json!({ "points": [[0, 0]] }))
            .is_err()
    );
    assert_eq!(doc.home().walls.len(), walls_before);

    // Furniture from the installed catalog (skipped if Sweet Home 3D is not installed)
    let catalog = msh_core::catalog::CatalogIndex::get();
    if catalog.furniture_by_id("eTeks#door").is_some() {
        let door = run(
            &r,
            &mut doc,
            "furniture_add_in_wall",
            json!({ "catalog_id": "eTeks#door", "wall_id": outer_ids[0], "offset": 300 }),
        );
        assert!(door["id"].as_str().unwrap().starts_with("doorOrWindow-"));
        run(
            &r,
            &mut doc,
            "furniture_add",
            json!({ "catalog_id": "eTeks#bed140x190", "x": 800, "y": 300, "angle_deg": 90 }),
        );
        let search = run(
            &r,
            &mut doc,
            "catalog_search",
            json!({ "query": "window", "limit": 5 }),
        );
        assert!(!search["results"].as_array().unwrap().is_empty());
        assert!(
            doc.file.contents.len() >= 4,
            "models and icons are embedded"
        );
    }

    // Moving the interior wall also moves the touching ends of joined walls; here the
    // interior wall is not joined, so only it moves
    let interior = doc.home().walls[4].attrs.id.clone();
    run(
        &r,
        &mut doc,
        "edit_move",
        json!({ "ids": [interior], "dx": 10, "dy": 0 }),
    );
    assert_eq!(doc.home().walls[4].attrs.x_start, 610.0);
    // Moving one exterior wall drags the ends of its two neighbors along
    run(
        &r,
        &mut doc,
        "edit_move",
        json!({ "ids": [outer_ids[1]], "dx": 50, "dy": 0 }),
    );
    let w = &doc.home().walls;
    assert_eq!(w[1].attrs.x_start, 1050.0);
    assert_eq!(w[0].attrs.x_end, 1050.0, "end of the previous wall follows");
    assert_eq!(w[2].attrs.x_start, 1050.0, "start of the next wall follows");
    assert_eq!(w[0].attrs.x_start, 0.0, "far end stays");

    // Describe and plan image
    let d = run(&r, &mut doc, "home_describe", json!({}));
    assert_eq!(d["walls"].as_array().unwrap().len(), 5);
    let img = run(&r, &mut doc, "view_plan_image", json!({ "width": 600 }));
    assert_eq!(img["mime_type"], "image/png");
    assert!(img["image_base64"].as_str().unwrap().len() > 1000);

    // Save and read back with the file format crate
    let dir = std::env::temp_dir().join(format!("msh-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("house.sh3d");
    run(&r, &mut doc, "home_save", json!({ "path": path }));
    let reopened = msh_format::Sh3dDocument::open(&path).unwrap();
    assert_eq!(reopened.home.walls.len(), 5);
    assert_eq!(reopened.home.rooms.len(), 2);
    assert_eq!(reopened.home.piece_count(), doc.home().piece_count());
    // Every referenced resource is present in the saved file
    for name in msh_core::document::referenced_contents(&reopened.home) {
        assert!(
            reopened.contents.iter().any(|c| c.name == name),
            "missing resource {name}"
        );
    }
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn copy_paste_duplicate_and_room_detection() {
    let r = Registry::standard();
    let mut doc = Document::default();
    run(&r, &mut doc, "home_new", json!({ "name": "Copy test" }));
    let outer = run(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0], [600, 0], [600, 400], [0, 400]], "closed": true, "thickness": 20 }),
    );
    let walls: Vec<String> = serde_json::from_value(outer["ids"].clone()).unwrap();
    run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 300, "y_start": 0, "x_end": 300, "y_end": 400, "thickness": 10 }),
    );

    // Room from a point inside the walls: inner outline of the left half
    let room = run(
        &r,
        &mut doc,
        "room_add",
        json!({ "inside_point": [100, 200], "name": "Left" }),
    );
    let mut pts: Vec<[f32; 2]> = serde_json::from_value(room["points"].clone()).unwrap();
    pts.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    assert_eq!(
        pts,
        vec![[10.0, 10.0], [10.0, 390.0], [295.0, 10.0], [295.0, 390.0]]
    );
    assert!(
        r.execute(&mut doc, "room_add", json!({ "inside_point": [900, 200] }))
            .is_err(),
        "outside of the walls"
    );

    // Moving a wall end with wall_update drags the joined wall along
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": walls[0], "x_end": 650 }),
    );
    let w = &doc.home().walls;
    assert_eq!((w[1].attrs.x_start, w[1].attrs.y_start), (650.0, 0.0));
    assert_eq!(w[1].attrs.x_end, 600.0, "far end stays");

    // Baseboard: add, change, remove
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": walls[0], "left_side_baseboard": { "height": 10 } }),
    );
    let bb = &doc.home().walls[0].baseboards;
    assert_eq!(bb.len(), 1);
    assert_eq!(
        (
            bb[0].attrs.role.as_str(),
            bb[0].attrs.height,
            bb[0].attrs.thickness
        ),
        ("leftSideBaseboard", 10.0, 1.0)
    );
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": walls[0], "left_side_baseboard": { "height": 0 } }),
    );
    assert!(doc.home().walls[0].baseboards.is_empty());

    // Polyline and dimension line
    let pl = run(
        &r,
        &mut doc,
        "polyline_add",
        json!({ "points": [[0, 500], [200, 500], [200, 600]], "end_arrow": "DELTA", "dash_style": "DASH" }),
    );
    let pl_id = pl["id"].as_str().unwrap().to_owned();
    run(
        &r,
        &mut doc,
        "polyline_update",
        json!({ "id": pl_id, "thickness": 5 }),
    );
    assert_eq!(doc.home().polylines[0].attrs.thickness, Some(5.0));
    assert_eq!(
        doc.home().polylines[0].attrs.end_arrow_style.as_deref(),
        Some("DELTA")
    );
    let dim = run(
        &r,
        &mut doc,
        "dimension_add",
        json!({ "x_start": 0, "y_start": -50, "x_end": 600, "y_end": -50 }),
    );
    run(
        &r,
        &mut doc,
        "dimension_update",
        json!({ "id": dim["id"], "x_end": 650, "offset": 30 }),
    );
    assert_eq!(doc.home().dimension_lines[0].attrs.x_end, 650.0);

    // Duplicating the closed outline keeps the joins between the copies
    let dup = run(
        &r,
        &mut doc,
        "edit_duplicate",
        json!({ "ids": walls, "dx": 1000, "dy": 0 }),
    );
    let copies: Vec<String> = serde_json::from_value(dup["ids"].clone()).unwrap();
    assert_eq!(copies.len(), 4);
    let home = doc.home();
    for id in &copies {
        let w = home.walls.iter().find(|w| &w.attrs.id == id).unwrap();
        assert!(copies.contains(w.attrs.wall_at_start.as_ref().unwrap()));
        assert!(copies.contains(w.attrs.wall_at_end.as_ref().unwrap()));
        assert!(w.attrs.x_start >= 1000.0);
    }
    assert_eq!(home.walls.len(), 9);

    // Copy the room and the polyline, paste into a new home: same position there
    let room_id = room["id"].as_str().unwrap().to_owned();
    run(
        &r,
        &mut doc,
        "edit_copy",
        json!({ "ids": [room_id, pl_id] }),
    );
    let pasted = run(&r, &mut doc, "edit_paste", json!({}));
    assert_eq!(pasted["ids"].as_array().unwrap().len(), 2);
    assert_eq!(
        doc.home().rooms[1].points[0].x,
        doc.home().rooms[0].points[0].x + 20.0,
        "offset in the same home"
    );
    run(&r, &mut doc, "home_new", json!({}));
    run(&r, &mut doc, "edit_paste", json!({}));
    assert_eq!(doc.home().rooms.len(), 1);
    assert_eq!(doc.home().polylines.len(), 1);
    assert_eq!(doc.home().rooms[0].attrs.name.as_deref(), Some("Left"));
    let xs: Vec<f32> = doc.home().rooms[0].points.iter().map(|p| p.x).collect();
    assert!(
        xs.contains(&10.0),
        "original position in another home: {xs:?}"
    );
}

#[test]
fn pasting_furniture_into_another_home_copies_its_resources() {
    let catalog = msh_core::catalog::CatalogIndex::get();
    if catalog.furniture_by_id("eTeks#bed140x190").is_none() {
        return; // Sweet Home 3D is not installed
    }
    let r = Registry::standard();
    let mut doc = Document::default();
    run(&r, &mut doc, "home_new", json!({}));
    let bed = run(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": "eTeks#bed140x190", "x": 100, "y": 100 }),
    );
    run(&r, &mut doc, "edit_copy", json!({ "ids": [bed["id"]] }));
    // Paste into the same home: resources are reused
    let contents = doc.file.contents.len();
    run(&r, &mut doc, "edit_paste", json!({}));
    assert_eq!(doc.file.contents.len(), contents);
    assert_eq!(doc.home().piece_count(), 2);

    // Another home that already uses the same resource names for other data
    run(&r, &mut doc, "home_new", json!({}));
    run(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": "eTeks#door", "x": 0, "y": 0 }),
    );
    run(&r, &mut doc, "edit_paste", json!({}));
    assert_eq!(doc.home().piece_count(), 2);
    let refs = msh_core::document::referenced_contents(doc.home());
    for name in &refs {
        assert!(
            doc.file.contents.iter().any(|c| &c.name == name),
            "missing resource {name}"
        );
    }
    // The pasted bed got its own resources instead of the door's with the same names
    let tops: std::collections::HashSet<&str> =
        refs.iter().map(|n| n.split('/').next().unwrap()).collect();
    assert!(
        tops.len() >= 4,
        "door and bed use separate resources: {refs:?}"
    );
}
