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

    // A door in a moved wall moves with it
    if let Some(door) = doc.home().furniture.iter().find_map(|f| match f {
        msh_model::Furniture::Piece(p) if p.kind == msh_model::PieceKind::DoorOrWindow => {
            Some((p.attrs.id.clone().unwrap(), p.attrs.y))
        }
        _ => None,
    }) {
        run(
            &r,
            &mut doc,
            "edit_move",
            json!({ "ids": [outer_ids[0]], "dx": 0, "dy": 5 }),
        );
        let y = doc
            .home()
            .furniture
            .iter()
            .find_map(|f| match f {
                msh_model::Furniture::Piece(p) if p.attrs.id.as_deref() == Some(&door.0) => {
                    Some(p.attrs.y)
                }
                _ => None,
            })
            .unwrap();
        assert_eq!(y, door.1 + 5.0);
        run(&r, &mut doc, "edit_undo", json!({}));
    }

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

    // A path drawn from the free end of a wall is joined to it
    let a = run(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 600], [300, 600]] }),
    );
    let b = run(
        &r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[300, 600], [300, 800]] }),
    );
    let (a, b) = (a["ids"][0].as_str().unwrap(), b["ids"][0].as_str().unwrap());
    let find = |id: &str| {
        doc.home()
            .walls
            .iter()
            .find(|w| w.attrs.id == id)
            .unwrap()
            .attrs
            .clone()
    };
    assert_eq!(find(a).wall_at_end.as_deref(), Some(b));
    assert_eq!(find(b).wall_at_start.as_deref(), Some(a));
    run(&r, &mut doc, "edit_undo", json!({}));
    run(&r, &mut doc, "edit_undo", json!({}));

    // Several walls get the same thickness and height in one undo step
    let res = run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "ids": walls, "thickness": 25, "height": 260, "pattern": "crossHatch" }),
    );
    assert_eq!(res["ids"].as_array().unwrap().len(), 4);
    for id in &walls {
        let w = doc.home().walls.iter().find(|w| &w.attrs.id == id).unwrap();
        assert_eq!((w.attrs.thickness, w.attrs.height), (25.0, Some(260.0)));
    }
    assert!(
        r.execute(
            &mut doc,
            "wall_update",
            json!({ "ids": walls, "x_start": 0 })
        )
        .is_err(),
        "coordinates only for one wall"
    );
    run(&r, &mut doc, "edit_undo", json!({}));
    assert_eq!(doc.home().walls[0].attrs.thickness, 20.0);

    // The length keeps the start and moves the end along the wall; the wall joined at the
    // end moves in parallel (same length and direction)
    let w0 = doc.home().walls[0].attrs.clone();
    let next_before = w0.wall_at_end.as_ref().map(|n| {
        let a = &doc
            .home()
            .walls
            .iter()
            .find(|x| &x.attrs.id == n)
            .unwrap()
            .attrs;
        (a.x_end - a.x_start, a.y_end - a.y_start)
    });
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": w0.id, "length": 500 }),
    );
    let w = doc.home().walls[0].attrs.clone();
    let (dx, dy) = (w0.x_end - w0.x_start, w0.y_end - w0.y_start);
    let k = 500.0 / dx.hypot(dy);
    assert_eq!((w.x_start, w.y_start), (w0.x_start, w0.y_start));
    assert!((w.x_end - (w0.x_start + dx * k)).abs() < 1e-3);
    assert!((w.y_end - (w0.y_start + dy * k)).abs() < 1e-3);
    if let Some(next) = &w.wall_at_end {
        let n = doc
            .home()
            .walls
            .iter()
            .find(|x| &x.attrs.id == next)
            .unwrap();
        let touches = |x: f32, y: f32| (x - w.x_end).abs() < 1e-3 && (y - w.y_end).abs() < 1e-3;
        assert!(touches(n.attrs.x_start, n.attrs.y_start) || touches(n.attrs.x_end, n.attrs.y_end));
        let (bx, by) = next_before.unwrap();
        let (ax, ay) = (
            n.attrs.x_end - n.attrs.x_start,
            n.attrs.y_end - n.attrs.y_start,
        );
        assert!(
            (ax - bx).abs() < 1e-3 && (ay - by).abs() < 1e-3,
            "moved in parallel"
        );
    }
    assert!(
        r.execute(&mut doc, "wall_update", json!({ "id": w0.id, "length": 0 }))
            .is_err()
    );
    run(&r, &mut doc, "edit_undo", json!({}));

    // Flipping the closed outline horizontally keeps it in place (symmetric) and keeps the
    // joins; a second flip restores the original coordinates
    let before: Vec<_> = doc.home().walls.iter().map(|w| w.attrs.clone()).collect();
    run(
        &r,
        &mut doc,
        "edit_flip",
        json!({ "ids": walls, "axis": "horizontal" }),
    );
    let w0 = doc
        .home()
        .walls
        .iter()
        .find(|w| w.attrs.id == walls[0])
        .unwrap();
    assert_eq!(
        (w0.attrs.x_start, w0.attrs.x_end),
        (0.0, 600.0),
        "symmetric outline: mirrored and reversed gives the same wall"
    );
    run(
        &r,
        &mut doc,
        "edit_flip",
        json!({ "ids": walls, "axis": "horizontal" }),
    );
    let after: Vec<_> = doc.home().walls.iter().map(|w| w.attrs.clone()).collect();
    assert_eq!(before, after);
    run(&r, &mut doc, "edit_undo", json!({}));
    run(&r, &mut doc, "edit_undo", json!({}));

    // Two separate walls are joined at the intersection of their axes (mitered corner)
    let h = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 1000, "y_start": 0, "x_end": 1290, "y_end": 0, "thickness": 20 }),
    );
    let v = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 1300, "y_start": -10, "x_end": 1300, "y_end": 300 }),
    );
    let (h, v) = (
        h["id"].as_str().unwrap().to_owned(),
        v["id"].as_str().unwrap().to_owned(),
    );
    let joined = run(&r, &mut doc, "wall_join", json!({ "ids": [h, v] }));
    assert_eq!(joined["joined"], "corner");
    let get = |doc: &Document, id: &str| {
        doc.home()
            .walls
            .iter()
            .find(|w| w.attrs.id == id)
            .unwrap()
            .attrs
            .clone()
    };
    let (ha, va) = (get(&doc, &h), get(&doc, &v));
    assert_eq!((ha.x_end, ha.y_end), (1300.0, 0.0));
    assert_eq!((va.x_start, va.y_start), (1300.0, 0.0));
    assert_eq!(ha.wall_at_end.as_deref(), Some(v.as_str()));
    assert_eq!(va.wall_at_start.as_deref(), Some(h.as_str()));
    // Set the corner to 60° and back to exactly 90°; the length stays
    run(
        &r,
        &mut doc,
        "wall_set_angle",
        json!({ "id": v, "at": "start", "angle_deg": 60 }),
    );
    let va = get(&doc, &v);
    let len = (va.x_end - va.x_start).hypot(va.y_end - va.y_start);
    assert!((len - 300.0).abs() < 0.05, "length {len}");
    run(
        &r,
        &mut doc,
        "wall_set_angle",
        json!({ "id": v, "at": "start", "angle_deg": 90 }),
    );
    let va = get(&doc, &v);
    assert!(
        (va.x_end - 1300.0).abs() < 0.02 && (va.y_end - 300.0).abs() < 0.02,
        "{va:?}"
    );
    run(&r, &mut doc, "edit_undo", json!({}));
    run(&r, &mut doc, "edit_undo", json!({}));

    // Split the vertical wall, then detach everything
    let split = run(&r, &mut doc, "wall_split", json!({ "id": v }));
    let parts: Vec<String> = serde_json::from_value(split["ids"].clone()).unwrap();
    let (p1, p2) = (get(&doc, &parts[0]), get(&doc, &parts[1]));
    assert_eq!((p1.y_end, p2.y_start, p2.y_end), (150.0, 150.0, 300.0));
    assert_eq!(p1.wall_at_end.as_deref(), Some(parts[1].as_str()));
    run(&r, &mut doc, "wall_detach", json!({ "ids": [parts[0]] }));
    assert!(get(&doc, &h).wall_at_end.is_none());
    assert!(get(&doc, &parts[1]).wall_at_start.is_none());
    // T junction: a wall ending near the middle of another one is extended to its axis
    let t = run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 1100, "y_start": 50, "x_end": 1100, "y_end": 200 }),
    );
    let t_id = t["id"].as_str().unwrap().to_owned();
    assert_eq!(
        run(&r, &mut doc, "wall_join", json!({ "ids": [t_id, h] }))["joined"],
        "t"
    );
    assert_eq!(get(&doc, &t_id).y_start, 0.0);
    // Dragging a free end onto a free end of another wall joins them
    run(
        &r,
        &mut doc,
        "wall_update",
        json!({ "id": parts[1], "x_end": 1100, "y_end": 200 }),
    );
    assert_eq!(
        get(&doc, &parts[1]).wall_at_end.as_deref(),
        Some(t_id.as_str())
    );
    for _ in 0..8 {
        run(&r, &mut doc, "edit_undo", json!({}));
    }

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
    // Label offsets: set (Sweet Home 3D convention: from the bounding box center), reset one
    let room_id = room["id"].as_str().unwrap().to_owned();
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": room_id, "name_x_offset": 30, "name_y_offset": -60, "area_y_offset": 20 }),
    );
    let ra = doc.home().rooms[0].attrs.clone();
    assert_eq!(
        (ra.name_x_offset, ra.name_y_offset, ra.area_y_offset),
        (Some(30.0), Some(-60.0), Some(20.0))
    );
    let (name_at, _) = msh_geometry::room_label_positions(&doc.home().rooms[0]);
    assert_eq!(name_at, [152.5 + 30.0, 200.0 - 60.0]);
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": room_id, "reset_name_position": true }),
    );
    let ra = doc.home().rooms[0].attrs.clone();
    assert_eq!((ra.name_x_offset, ra.area_y_offset), (None, Some(20.0)));
    run(
        &r,
        &mut doc,
        "room_update",
        json!({ "id": room_id, "reset_label_positions": true }),
    );
    assert_eq!(doc.home().rooms[0].attrs.area_y_offset, None);

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
fn group_and_ungroup_furniture() {
    let catalog = msh_core::catalog::CatalogIndex::get();
    if catalog.furniture_by_id("eTeks#bed140x190").is_none() {
        return; // Sweet Home 3D is not installed
    }
    let r = Registry::standard();
    let mut doc = Document::default();
    run(&r, &mut doc, "home_new", json!({}));
    let a = run(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": "eTeks#bed140x190", "x": 100, "y": 100 }),
    );
    let b = run(
        &r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": "eTeks#bed140x190", "x": 400, "y": 100 }),
    );
    let g = run(
        &r,
        &mut doc,
        "furniture_group",
        json!({ "ids": [a["id"], b["id"]], "name": "Beds" }),
    );
    assert_eq!(doc.home().furniture.len(), 1);
    assert_eq!(doc.home().piece_count(), 2);
    let msh_model::Furniture::Group(group) = &doc.home().furniture[0] else {
        panic!("group expected");
    };
    assert_eq!(group.attrs.name, "Beds");
    assert_eq!(group.attrs.x, Some(250.0));
    // Moving the group moves its pieces
    run(
        &r,
        &mut doc,
        "edit_move",
        json!({ "ids": [g["id"]], "dx": 10, "dy": 0 }),
    );
    let ungrouped = run(
        &r,
        &mut doc,
        "furniture_ungroup",
        json!({ "ids": [g["id"]] }),
    );
    assert_eq!(ungrouped["ids"].as_array().unwrap().len(), 2);
    assert_eq!(doc.home().furniture.len(), 2);
    let msh_model::Furniture::Piece(p) = &doc.home().furniture[0] else {
        panic!("piece expected");
    };
    assert_eq!(p.attrs.x, 110.0);

    // Material changes: color one material, give another a shininess, then reset
    let bed = p.attrs.id.clone().unwrap();
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": bed, "materials": [
            { "name": "wood", "color": "#804020" },
            { "name": "sheet", "shininess": 0.5 }
        ] }),
    );
    let piece = |doc: &Document| match &doc.home().furniture[0] {
        msh_model::Furniture::Piece(p) => p.clone(),
        _ => panic!("piece expected"),
    };
    let mats = piece(&doc).materials;
    assert_eq!(mats.len(), 2);
    assert_eq!(mats[0].attrs.color, Some(msh_model::Color(0xFF80_4020)));
    assert_eq!(mats[1].attrs.shininess, Some(0.5));
    // "" removes the color; a material without changes disappears
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": bed, "materials": [{ "name": "wood", "color": "" }] }),
    );
    assert_eq!(piece(&doc).materials.len(), 1);
    run(
        &r,
        &mut doc,
        "furniture_update",
        json!({ "id": bed, "reset_materials": true }),
    );
    assert!(piece(&doc).materials.is_empty());
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

#[test]
fn wall_path_with_arc_extent_gives_round_walls() {
    let r = Registry::standard();
    let mut doc = Document::default();
    r.execute(&mut doc, "home_new", json!({})).unwrap();
    r.execute(
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0], [400, 0], [400, 300]], "arc_extent_deg": 90 }),
    )
    .unwrap();
    let walls = &doc.home().walls;
    assert_eq!(walls.len(), 2);
    for w in walls {
        let arc = w.attrs.arc_extent.expect("round wall");
        assert!((arc - std::f32::consts::FRAC_PI_2).abs() < 1e-5);
    }
    // One undo step removes the whole path
    r.execute(&mut doc, "edit_undo", json!({})).unwrap();
    assert!(doc.home().walls.is_empty());
}

#[test]
fn wall_path_takes_pattern_and_side_colors() {
    let r = Registry::standard();
    let mut doc = Document::default();
    r.execute(&mut doc, "home_new", json!({})).unwrap();
    r.execute(
        &mut doc,
        "wall_add_path",
        json!({
            "points": [[0, 0], [400, 0]],
            "pattern": "crossHatch",
            "left_side_color": "#FF0000",
            "right_side_color": ""
        }),
    )
    .unwrap();
    let w = &doc.home().walls[0].attrs;
    assert_eq!(w.pattern.as_deref(), Some("crossHatch"));
    assert_eq!(w.left_side_color.map(|c| c.0 & 0xFF_FFFF), Some(0xFF_0000));
    assert_eq!(w.right_side_color, None);
}
