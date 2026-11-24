//! Dimension chains, the dimension style, typed lengths and elevation marks.

mod common;

use common::{check_undo_redo, close, new_doc, out_dir, run, run_err, save_and_reopen, snapshot};
use msh_core::{Document, Registry};
use msh_model::DimensionLine;
use serde_json::{Value, json};

/// A house of 1000 × 800 cm (axes), its walls and an inner wall at x = 400, with a window of
/// 120 cm in the lower wall. Returns the IDs of the lower and the inner wall.
fn house(r: &Registry) -> (Document, String, String) {
    let mut doc = new_doc(r);
    let outer = run(
        r,
        &mut doc,
        "wall_add_path",
        json!({
            "points": [[0, 0], [1000, 0], [1000, 800], [0, 800]],
            "closed": true, "thickness": 30,
        }),
    );
    let inner = run(
        r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 400, "y_start": 800, "x_end": 400, "y_end": 0, "thickness": 10 }),
    );
    doc.home_mut()
        .furniture
        .push(msh_model::Furniture::Piece(Box::new(msh_model::Piece {
            kind: msh_model::PieceKind::DoorOrWindow,
            attrs: msh_model::PieceAttrs {
                id: Some("window".into()),
                name: "Window".into(),
                x: 700.0,
                y: 800.0,
                width: 120.0,
                depth: 30.0,
                height: 100.0,
                ..Default::default()
            },
            ..Default::default()
        })));
    let bottom = outer["ids"][2].as_str().unwrap().to_owned();
    (doc, bottom, inner["id"].as_str().unwrap().to_owned())
}

fn lines(doc: &Document, ids: &Value) -> Vec<DimensionLine> {
    ids.as_array()
        .unwrap()
        .iter()
        .map(|id| {
            doc.home()
                .dimension_lines
                .iter()
                .find(|d| d.attrs.id.as_deref() == id.as_str())
                .unwrap_or_else(|| panic!("no dimension line {id}"))
                .clone()
        })
        .collect()
}

/// Offset and measured lengths of each row of a chain.
fn rows(doc: &Document, ids: &Value) -> Vec<(f32, Vec<f32>)> {
    let mut out: Vec<(f32, Vec<f32>)> = Vec::new();
    for d in lines(doc, ids) {
        let a = &d.attrs;
        let len = (a.x_end - a.x_start).hypot(a.y_end - a.y_start);
        match out.last_mut() {
            Some((offset, lens)) if close(*offset, a.offset) => lens.push(len),
            _ => out.push((a.offset, vec![len])),
        }
    }
    out
}

#[test]
fn chain_along_a_wall_has_three_rows_outside_the_house() {
    let r = Registry::standard();
    let (mut doc, bottom, _) = house(&r);
    let before = snapshot(&doc);
    let added = run(
        &r,
        &mut doc,
        "dimension_chain_add",
        json!({ "wall": bottom }),
    );
    let after = snapshot(&doc);
    assert_eq!(
        rows(&doc, &added["ids"]),
        vec![
            (60.0, vec![655.0, 120.0, 255.0]),
            (105.0, vec![30.0, 380.0, 10.0, 580.0, 30.0]),
            (150.0, vec![1030.0]),
        ]
    );
    let first = &lines(&doc, &added["ids"])[0].attrs;
    assert!(close(first.x_start, -15.0) && close(first.y_start, 815.0));
    check_undo_redo(&r, &mut doc, &before, &after);

    // Nothing is added by working it out
    let before = snapshot(&doc);
    let calc = run(
        &r,
        &mut doc,
        "dimension_chain_calc",
        json!({ "wall": bottom }),
    );
    assert_eq!(snapshot(&doc), before);
    let outside = calc["outside"].as_str().unwrap().to_owned();
    assert_eq!(calc[&outside]["sign"], 1);
    assert_eq!(calc[&outside]["rows"].as_array().unwrap().len(), 3);
    let inside = if outside == "left" { "right" } else { "left" };
    assert_eq!(calc[inside]["sign"], -1);
    assert_eq!(
        calc[inside]["rows"][2]["points"],
        json!([[15.0, 785.0], [985.0, 785.0]])
    );
}

#[test]
fn chain_update_measures_again_and_changes_the_chain() {
    let r = Registry::standard();
    let (mut doc, bottom, inner) = house(&r);
    let added = run(
        &r,
        &mut doc,
        "dimension_chain_add",
        json!({ "wall": bottom, "rows": ["walls", "total"], "distance": 80, "spacing": 30 }),
    );
    let id = added["ids"][0].as_str().unwrap().to_owned();
    assert_eq!(rows(&doc, &added["ids"]).len(), 2);
    run(
        &r,
        &mut doc,
        "dimension_update",
        json!({ "id": id, "font_size": 12 }),
    );
    run(
        &r,
        &mut doc,
        "edit_move",
        json!({ "ids": [inner], "dx": 100, "dy": 0 }),
    );
    let before = snapshot(&doc);
    let updated = run(&r, &mut doc, "dimension_chain_update", json!({ "id": id }));
    let after = snapshot(&doc);
    assert_eq!(
        rows(&doc, &updated["ids"]),
        vec![
            (80.0, vec![30.0, 480.0, 10.0, 480.0, 30.0]),
            (110.0, vec![1030.0]),
        ]
    );
    // The old dimension lines are replaced, the text style stays
    assert_eq!(doc.home().dimension_lines.len(), 6);
    assert_eq!(updated["chain"], added["chain"]);
    let style = lines(&doc, &updated["ids"])[0].text_style.clone().unwrap();
    assert!(close(style.font_size, 12.0));
    check_undo_redo(&r, &mut doc, &before, &after);

    // One side is outside the house (1030 cm), the other inside (970 cm)
    let mut id = updated["ids"][0].clone();
    let mut totals = Vec::new();
    for side in ["left", "right"] {
        let on_side = run(
            &r,
            &mut doc,
            "dimension_chain_update",
            json!({ "id": id, "side": side, "rows": ["total"] }),
        );
        id = on_side["ids"][0].clone();
        totals.push(rows(&doc, &on_side["ids"])[0].1[0]);
    }
    totals.sort_by(f32::total_cmp);
    assert_eq!(totals, [970.0, 1030.0]);
    assert_eq!(doc.home().dimension_lines.len(), 1);
}

#[test]
fn copies_of_a_chain_stand_alone_and_files_keep_it() {
    let r = Registry::standard();
    let (mut doc, bottom, inner) = house(&r);
    let added = run(
        &r,
        &mut doc,
        "dimension_chain_add",
        json!({ "wall": bottom, "rows": ["total"] }),
    );
    let id = added["ids"][0].as_str().unwrap().to_owned();
    let copy = run(&r, &mut doc, "edit_duplicate", json!({ "ids": [id] }));
    let copy_id = copy["ids"][0].as_str().unwrap().to_owned();
    let err = run_err(
        &r,
        &mut doc,
        "dimension_chain_update",
        json!({ "id": copy_id }),
    );
    assert!(err.contains("does not belong to a chain"), "{err}");

    let mut reopened = save_and_reopen(&r, &mut doc, "dimension_chain");
    let again = run(
        &r,
        &mut reopened,
        "dimension_chain_update",
        json!({ "id": id, "rows": ["openings", "walls", "total"] }),
    );
    assert_eq!(rows(&reopened, &again["ids"]).len(), 3);
    // Three rows and the copy
    assert_eq!(reopened.home().dimension_lines.len(), 10);

    // Without its wall a chain cannot be measured again; it stays as it is
    run(&r, &mut reopened, "edit_delete", json!({ "ids": [bottom] }));
    let err = run_err(
        &r,
        &mut reopened,
        "dimension_chain_update",
        json!({ "id": again["ids"][0] }),
    );
    assert!(err.contains("does not exist"), "{err}");
    let err = run_err(
        &r,
        &mut reopened,
        "dimension_chain_add",
        json!({ "wall": inner, "rows": ["openings"] }),
    );
    assert!(err.contains("none of the rows"), "{err}");
}

#[test]
fn chain_between_points() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let added = run(
        &r,
        &mut doc,
        "dimension_chain_add",
        // The second point lies beside the line: it counts where it projects to
        json!({ "points": [[0, 0], [120, 30], [300, 0]], "distance": -40 }),
    );
    assert_eq!(rows(&doc, &added["ids"]), vec![(-40.0, vec![120.0, 180.0])]);
    for bad in [
        json!({ "points": [[0, 0]] }),
        json!({ "points": [[5, 5], [5, 5]] }),
        json!({}),
        json!({ "wall": "x", "points": [[0, 0], [1, 1]] }),
        json!({ "wall": "nope" }),
        json!({ "points": [[0, 0], [100, 0]], "spacing": 0 }),
    ] {
        run_err(&r, &mut doc, "dimension_chain_add", bad);
    }
    assert_eq!(doc.home().dimension_lines.len(), 2);
}

#[test]
fn dimension_update_takes_a_length() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let id = run(
        &r,
        &mut doc,
        "dimension_add",
        json!({ "x_start": 100, "y_start": 0, "x_end": 100, "y_end": -50 }),
    )["id"]
        .clone();
    run(
        &r,
        &mut doc,
        "dimension_update",
        json!({ "id": id, "length": 200 }),
    );
    let a = &doc.home().dimension_lines[0].attrs;
    assert!(close(a.x_end, 100.0) && close(a.y_end, -200.0));
    let height = run(
        &r,
        &mut doc,
        "dimension_add_height",
        json!({ "x": 0, "y": 0, "elevation_start": 20, "elevation_end": 100 }),
    )["id"]
        .clone();
    run(
        &r,
        &mut doc,
        "dimension_update",
        json!({ "id": height, "length": 240 }),
    );
    assert_eq!(
        doc.home().dimension_lines[1].attrs.elevation_end,
        Some(260.0)
    );
    let err = run_err(
        &r,
        &mut doc,
        "dimension_update",
        json!({ "id": id, "length": 0 }),
    );
    assert!(err.contains("at least 0.1"), "{err}");
}

fn exported(r: &Registry, doc: &mut Document, name: &str) -> (String, String) {
    let dir = out_dir(name);
    let (svg, dxf) = (dir.join("plan.svg"), dir.join("plan.dxf"));
    run(
        r,
        doc,
        "export_plan",
        json!({ "path": svg, "furniture_icons": "catalog" }),
    );
    run(r, doc, "export_plan", json!({ "path": dxf }));
    (
        std::fs::read_to_string(svg).unwrap(),
        std::fs::read_to_string(dxf).unwrap(),
    )
}

#[test]
fn the_style_shows_in_exported_plans_and_is_saved() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(
        &r,
        &mut doc,
        "dimension_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 201.5, "y_end": 0, "offset": 40 }),
    );
    let (svg, _) = exported(&r, &mut doc, "dimension_style_default");
    assert!(
        svg.contains("2.02 m") && svg.contains(r#"font-size="18""#),
        "{svg}"
    );

    let before = snapshot(&doc);
    let set = run(
        &r,
        &mut doc,
        "dimension_style_set",
        json!({ "mark": "dot", "unit": "din", "comma": true, "font_size": 14 }),
    );
    let after = snapshot(&doc);
    assert_eq!(set["unit"], "din");
    check_undo_redo(&r, &mut doc, &before, &after);
    let (svg, dxf) = exported(&r, &mut doc, "dimension_style_din");
    assert!(svg.contains("2,01⁵") && svg.contains(r#"font-size="14""#));
    assert_eq!(svg.matches("<circle").count(), 2);
    assert!(dxf.contains("2,01\\U+2075"));
    assert_eq!(dxf.matches("0\nCIRCLE\n8\nDIMENSIONS").count(), 2);

    let mut reopened = save_and_reopen(&r, &mut doc, "dimension_style_saved");
    let arrows = run(
        &r,
        &mut reopened,
        "dimension_style_set",
        json!({ "mark": "arrow", "unit": "cm", "decimals": 0, "show_unit": false }),
    );
    // What is not given stays
    assert_eq!(arrows["fontSize"], 14.0);
    let (svg, _) = exported(&r, &mut reopened, "dimension_style_cm");
    assert!(svg.contains(">202</text>"), "{svg}");

    // The default style leaves nothing behind
    run(
        &r,
        &mut reopened,
        "dimension_style_set",
        json!({ "reset": true }),
    );
    assert!(
        !reopened
            .home()
            .properties
            .iter()
            .any(|p| p.name == "mySweetHome.dimensionStyle")
    );
    for bad in [json!({ "decimals": 9 }), json!({ "font_size": -1 })] {
        run_err(&r, &mut reopened, "dimension_style_set", bad);
    }
}

fn text(doc: &Document, id: &Value) -> String {
    doc.home()
        .labels
        .iter()
        .find(|l| l.attrs.id.as_deref() == id.as_str())
        .unwrap()
        .text
        .clone()
}

#[test]
fn elevation_marks_follow_their_level_and_the_style() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    run(&r, &mut doc, "level_add", json!({ "name": "Upper" }));
    let ground = doc.home().levels[0].attrs.id.clone();
    let upper = doc.home().levels[1].attrs.id.clone();
    let low = run(
        &r,
        &mut doc,
        "elevation_mark_add",
        json!({ "x": 10, "y": 20, "level": ground }),
    );
    assert_eq!(low["text"], "▽ ±0.00");
    let high = run(
        &r,
        &mut doc,
        "elevation_mark_add",
        json!({ "x": 10, "y": 20, "level": upper, "height": -12, "kind": "raw" }),
    );
    assert_eq!(high["text"], "▼ +2.50");

    let before = snapshot(&doc);
    run(
        &r,
        &mut doc,
        "level_update",
        json!({ "id": upper, "elevation": 300 }),
    );
    let after = snapshot(&doc);
    assert_eq!(text(&doc, &high["id"]), "▼ +2.88");
    check_undo_redo(&r, &mut doc, &before, &after);
    run(
        &r,
        &mut doc,
        "dimension_style_set",
        json!({ "comma": true }),
    );
    assert_eq!(text(&doc, &low["id"]), "▽ ±0,00");
    run(
        &r,
        &mut doc,
        "elevation_mark_update",
        json!({ "id": high["id"], "height": 0, "kind": "finished" }),
    );
    assert_eq!(text(&doc, &high["id"]), "▽ +3,00");

    // The mark is saved, and shown in exported plans
    let mut reopened = save_and_reopen(&r, &mut doc, "elevation_mark");
    run(
        &r,
        &mut reopened,
        "level_update",
        json!({ "id": upper, "elevation": 280 }),
    );
    assert_eq!(text(&reopened, &high["id"]), "▽ +2,80");
    let (svg, dxf) = exported(&r, &mut reopened, "elevation_mark_plan");
    assert!(svg.contains("▽ +2,80") && dxf.contains("\\U+25BD +2,80"));

    // A text of its own makes it an ordinary label
    run(
        &r,
        &mut reopened,
        "label_update",
        json!({ "id": high["id"], "text": "OK FFB" }),
    );
    run(
        &r,
        &mut reopened,
        "level_update",
        json!({ "id": upper, "elevation": 260 }),
    );
    assert_eq!(text(&reopened, &high["id"]), "OK FFB");
    let err = run_err(
        &r,
        &mut reopened,
        "elevation_mark_update",
        json!({ "id": high["id"], "height": 5 }),
    );
    assert!(err.contains("no elevation mark"), "{err}");
}
