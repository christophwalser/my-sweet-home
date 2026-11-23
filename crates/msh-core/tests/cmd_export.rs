//! Exports: plan as SVG / PNG / PDF, printed document, furniture list as CSV. Parts that the
//! existing `export.rs` checks thoroughly (multi-level files, scales, columns) are not
//! repeated here.

mod common;

use base64::Engine;
use common::{new_doc, out_dir, run, run_err, snapshot};
use msh_core::{Document, Registry};
use serde_json::json;

/// A home without levels: one room, one piece.
fn flat(r: &Registry) -> Document {
    let mut doc = new_doc(r);
    run(
        r,
        &mut doc,
        "room_add",
        json!({ "name": "Office", "points": [[0, 0], [400, 0], [400, 300], [0, 300]] }),
    );
    doc.home_mut()
        .furniture
        .push(msh_model::Furniture::Piece(Box::new(msh_model::Piece {
            attrs: msh_model::PieceAttrs {
                id: Some("desk".into()),
                name: "Desk; oak".into(),
                x: 100.0,
                y: 100.0,
                width: 140.0,
                depth: 70.0,
                height: 75.0,
                ..Default::default()
            },
            ..Default::default()
        })));
    doc
}

fn png_base64() -> String {
    base64::engine::general_purpose::STANDARD.encode(common::png_bytes(8, 6))
}

/// Runs an export and checks that it leaves the home and the undo stack alone.
fn export(
    r: &Registry,
    doc: &mut Document,
    name: &str,
    params: serde_json::Value,
) -> serde_json::Value {
    let before = snapshot(doc);
    let could_undo = doc.can_undo();
    let result = run(r, doc, name, params);
    assert_eq!(snapshot(doc), before, "{name} changed the home");
    assert_eq!(doc.can_undo(), could_undo, "{name} created an undo step");
    result
}

#[test]
fn plan_of_a_home_without_levels_is_one_file() {
    let r = Registry::standard();
    let mut doc = flat(&r);
    let dir = out_dir("cmd-export-flat");
    // "all" on a home without levels is still one plan, written to the given name
    let svg = dir.join("plan.svg");
    let result = export(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": svg, "level": "all" }),
    );
    assert_eq!(result["paths"], json!([svg]));
    let text = std::fs::read_to_string(&svg).unwrap();
    assert!(text.contains("Office"));
    // Without views from above the catalog icons are used, with a note
    assert_eq!(result["notes"].as_array().unwrap().len(), 1);
    let catalog = export(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": svg, "furniture_icons": "catalog" }),
    );
    assert!(catalog["notes"].as_array().unwrap().is_empty());
}

#[test]
fn explicit_format_wins_over_the_file_extension() {
    let r = Registry::standard();
    let mut doc = flat(&r);
    let dir = out_dir("cmd-export-format");
    let file = dir.join("plan.out");
    export(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": file, "format": "png", "width": 300 }),
    );
    assert!(std::fs::read(&file).unwrap().starts_with(b"\x89PNG"));
    let pdf = dir.join("plan.svg");
    let result = export(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": pdf, "format": "pdf", "paper": "letter", "landscape": true }),
    );
    assert_eq!(result["pages"], json!(1));
    assert!(std::fs::read(&pdf).unwrap().starts_with(b"%PDF"));
    // Upper-case extensions are recognized
    let upper = dir.join("PLAN.SVG");
    export(&r, &mut doc, "export_plan", json!({ "path": upper }));
    assert!(std::fs::read_to_string(&upper).unwrap().contains("<svg"));
}

#[test]
fn plan_export_refuses_unknown_levels_bad_top_views_and_unwritable_paths() {
    let r = Registry::standard();
    let mut doc = flat(&r);
    run(&r, &mut doc, "level_add", json!({ "name": "Upper" }));
    let dir = out_dir("cmd-export-errors");
    let err = run_err(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": dir.join("a.svg"), "level": "level-x" }),
    );
    assert!(err.contains("unknown level"), "{err}");
    let err = run_err(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": dir.join("b.svg"),
                "top_views": { "images": { "k": "not base64!" }, "pieces": {} } }),
    );
    assert!(err.contains("invalid top view"), "{err}");
    let err = run_err(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": dir.join("missing-folder").join("c.svg") }),
    );
    assert!(err.contains("cannot write"), "{err}");
    run_err(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": dir.join("d.svg"), "format": "eps" }),
    );
    // Nothing was written by the failed exports
    assert!(!dir.join("a.svg").exists());
    assert!(!dir.join("b.svg").exists());
}

#[test]
fn document_without_path_returns_svg_pages() {
    let r = Registry::standard();
    let mut doc = flat(&r);
    let result = export(
        &r,
        &mut doc,
        "export_document",
        json!({ "paper": "a3", "view_3d_image": png_base64(), "furniture_icons": "catalog" }),
    );
    // Furniture list, plan of the home without levels, 3D view
    let pages = result["pages"].as_array().unwrap();
    assert_eq!(pages.len(), 3);
    assert_eq!(result["paper_mm"], json!([297.0, 420.0]));
    assert!(result["notes"].as_array().unwrap().is_empty());
    assert!(pages[0].as_str().unwrap().contains("Desk; oak"));
    assert!(pages[1].as_str().unwrap().contains("Test - Plan"));
    assert!(pages[2].as_str().unwrap().contains("Test - 3D view"));
}

#[test]
fn document_parts_can_be_left_out() {
    let r = Registry::standard();
    let mut doc = flat(&r);
    let only_list = export(
        &r,
        &mut doc,
        "export_document",
        json!({ "plan": false, "view_3d": false, "columns": ["NAME", "WIDTH"] }),
    );
    assert_eq!(only_list["pages"].as_array().unwrap().len(), 1);
    let page = only_list["pages"][0].as_str().unwrap();
    assert!(page.contains("Width"));
    assert!(!page.contains("Height"));
    let only_3d = export(
        &r,
        &mut doc,
        "export_document",
        json!({ "plan": false, "furniture": false, "view_3d_image": format!("data:image/png;base64,{}", png_base64()) }),
    );
    assert_eq!(only_3d["pages"].as_array().unwrap().len(), 1);
}

#[test]
fn document_refuses_invalid_parts() {
    let r = Registry::standard();
    let mut doc = flat(&r);
    let err = run_err(
        &r,
        &mut doc,
        "export_document",
        json!({ "view_3d_image": "%%%" }),
    );
    assert!(err.contains("invalid view_3d_image"), "{err}");
    let jpeg_like = base64::engine::general_purpose::STANDARD.encode([0xFF, 0xD8, 0xFF, 0, 0]);
    let err = run_err(
        &r,
        &mut doc,
        "export_document",
        json!({ "view_3d_image": jpeg_like }),
    );
    assert!(err.contains("PNG"), "{err}");
    run_err(&r, &mut doc, "export_document", json!({ "paper": "b5" }));
    run_err(
        &r,
        &mut doc,
        "export_document",
        json!({ "columns": ["NO_SUCH_COLUMN"] }),
    );
    // Level IDs are checked once the home has levels
    run(&r, &mut doc, "level_add", json!({ "name": "Upper" }));
    let err = run_err(
        &r,
        &mut doc,
        "export_document",
        json!({ "level": "level-x", "furniture": false }),
    );
    assert!(err.contains("unknown level"), "{err}");
}

#[test]
fn csv_quotes_the_separator_and_counts_rows() {
    let r = Registry::standard();
    let mut doc = flat(&r);
    let csv = out_dir("cmd-export-csv").join("list.csv");
    let result = export(
        &r,
        &mut doc,
        "export_furniture_csv",
        json!({ "path": csv, "columns": ["NAME", "HEIGHT"], "separator": ";" }),
    );
    assert_eq!(result["rows"], json!(1));
    assert_eq!(result["columns"], json!(["NAME", "HEIGHT"]));
    let text = String::from_utf8(std::fs::read(&csv).unwrap()).unwrap();
    let text = text.trim_start_matches('\u{FEFF}');
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines[1], "\"Desk; oak\";75");
}

#[test]
fn csv_of_an_empty_home_has_only_the_header() {
    let r = Registry::standard();
    let mut doc = new_doc(&r);
    let csv = out_dir("cmd-export-csv-empty").join("list.csv");
    let result = export(&r, &mut doc, "export_furniture_csv", json!({ "path": csv }));
    assert_eq!(result["rows"], json!(0));
    let err = run_err(
        &r,
        &mut doc,
        "export_furniture_csv",
        json!({ "path": out_dir("cmd-export-csv-empty").join("no").join("list.csv") }),
    );
    assert!(err.contains("cannot write"), "{err}");
    run_err(
        &r,
        &mut doc,
        "export_furniture_csv",
        json!({ "path": csv, "separator": ";;" }),
    );
}

#[test]
fn document_pages_get_the_header_and_footer_of_the_page_setup() {
    let r = Registry::standard();
    let mut doc = flat(&r);
    let result = export(
        &r,
        &mut doc,
        "export_document",
        json!({ "view_3d": false, "furniture_icons": "catalog", "scale": 50,
                "header": "Project $name", "footer": "Page $pageNumber/$pageCount, $planScale, 5$$" }),
    );
    let pages: Vec<&str> = result["pages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap())
        .collect();
    assert_eq!(pages.len(), 2);
    assert!(pages[0].contains("Project Test"));
    assert!(pages[0].contains("Page 1/2, , 5$"));
    assert!(pages[1].contains("Page 2/2, 1:50, 5$"), "{}", pages[1]);
    // The default footer is replaced
    assert!(!pages[1].contains("Page 2 of 2"));
}

#[test]
fn plan_pdf_without_path_is_a_preview_split_when_too_large() {
    let r = Registry::standard();
    let mut doc = flat(&r);
    // The room of 4 × 3 m at 1:20 is 200 × 150 mm with the margin around it: more than one
    // A5 page, one A3 page
    let preview = export(
        &r,
        &mut doc,
        "export_plan",
        json!({ "paper": "a5", "scale": 20, "furniture_icons": "catalog" }),
    );
    let pages = preview["pages"].as_array().unwrap();
    assert!(pages.len() > 1, "{}", pages.len());
    assert_eq!(preview["landscape"].as_array().unwrap().len(), pages.len());
    let note = preview["notes"][0].as_str().unwrap();
    assert!(note.contains("split into") && note.contains("A5"), "{note}");
    assert!(pages[1].as_str().unwrap().contains("part 2 of"));
    let a3 = export(
        &r,
        &mut doc,
        "export_plan",
        json!({ "paper": "a3", "scale": 20, "furniture_icons": "catalog" }),
    );
    assert_eq!(a3["pages"].as_array().unwrap().len(), 1);
    assert!(a3["notes"].as_array().unwrap().is_empty());
    // Any paper size and any scale
    let custom = export(
        &r,
        &mut doc,
        "export_plan",
        json!({ "paper": "1000x700", "scale": 75, "furniture_icons": "catalog" }),
    );
    assert_eq!(custom["paper_mm"], json!([700.0, 1000.0]));
    assert!(custom["pages"][0].as_str().unwrap().contains("1:75"));
    let err = run_err(&r, &mut doc, "export_plan", json!({ "paper": "b5" }));
    assert!(err.contains("a0 to a5"), "{err}");
    // SVG and PNG need a path
    let err = run_err(&r, &mut doc, "export_plan", json!({ "format": "svg" }));
    assert!(err.contains("path"), "{err}");
}

#[test]
fn title_blocks_number_the_sheets_of_all_levels() {
    let r = Registry::standard();
    let mut doc = flat(&r);
    run(&r, &mut doc, "level_add", json!({ "name": "Upper" }));
    let result = export(
        &r,
        &mut doc,
        "export_document",
        json!({
            "furniture": false, "view_3d": false, "furniture_icons": "catalog",
            "title_block": { "author": "C. W." },
        }),
    );
    let pages: Vec<&str> = result["pages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap())
        .collect();
    assert_eq!(pages.len(), 2);
    assert!(pages[0].contains(">Test<") && pages[0].contains("Plan - Level 0"));
    assert!(pages[1].contains("Plan - Upper") && pages[1].contains("C. W."));
    assert!(pages[0].contains(">1 / 2<") && pages[1].contains(">2 / 2<"));
    // A given project name replaces the name of the home
    let named = export(
        &r,
        &mut doc,
        "export_plan",
        json!({ "level": "all", "title_block": { "project": "Villa" }, "furniture_icons": "catalog" }),
    );
    assert!(named["pages"][0].as_str().unwrap().contains(">Villa<"));
}

#[test]
fn plan_as_dxf_with_layers_and_units() {
    let r = Registry::standard();
    let mut doc = flat(&r);
    run(
        &r,
        &mut doc,
        "wall_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 400, "y_end": 0 }),
    );
    run(&r, &mut doc, "stair_add", json!({ "x": 300, "y": 280 }));
    let dir = out_dir("cmd-export-dxf");
    let path = dir.join("plan.dxf");
    let result = export(&r, &mut doc, "export_plan", json!({ "path": path }));
    assert_eq!(result["paths"][0], json!(path));
    assert!(
        result["layers"]
            .as_array()
            .unwrap()
            .contains(&json!("STAIRS"))
    );
    let dxf = std::fs::read_to_string(&path).unwrap();
    assert!(dxf.is_ascii() && dxf.ends_with("0\nEOF\n"));
    for layer in ["WALLS", "ROOMS", "ROOM_NAMES", "FURNITURE", "STAIRS"] {
        assert!(dxf.contains(&format!("8\n{layer}\n")), "{layer}");
    }
    assert!(dxf.contains("1\nOffice\n"));
    // The room corner (400, 300) cm in mm, y up
    assert!(dxf.contains("10\n4000\n20\n-3000\n"));
    // In meters
    let meters = dir.join("plan-m.dxf");
    export(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": meters, "unit": "m" }),
    );
    let dxf = std::fs::read_to_string(&meters).unwrap();
    assert!(dxf.contains("10\n4\n20\n-3\n"));
    let err = run_err(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": meters, "unit": "ft" }),
    );
    assert!(err.contains("mm, cm or m"), "{err}");
    // One file per level
    run(&r, &mut doc, "level_add", json!({ "name": "Upper" }));
    let all = export(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": path, "level": "all" }),
    );
    assert_eq!(all["paths"].as_array().unwrap().len(), 2);
}
