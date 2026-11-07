//! File exports through the command registry: plan as SVG, PNG and PDF, furniture list as CSV.

use msh_core::{Document, Registry};
use serde_json::{Value, json};
use std::path::PathBuf;

fn run(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    r.execute(doc, name, params)
        .unwrap_or_else(|e| panic!("{name} failed: {e}"))
}

fn out_dir(test: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("msh-export-{test}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Two levels with walls, a room, a dimension, a label and furniture with prices.
fn small_house(r: &Registry) -> Document {
    let mut doc = Document::default();
    run(
        r,
        &mut doc,
        "home_new",
        json!({ "name": "Export test.sh3d" }),
    );
    run(r, &mut doc, "level_add", json!({ "name": "Ground floor" }));
    run(
        r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0], [600, 0], [600, 400], [0, 400]], "closed": true }),
    );
    run(
        r,
        &mut doc,
        "room_add",
        json!({ "points": [[0, 0], [600, 0], [600, 400], [0, 400]], "name": "Living, dining" }),
    );
    run(
        r,
        &mut doc,
        "dimension_add",
        json!({ "x_start": 0, "y_start": 0, "x_end": 600, "y_end": 0, "offset": -40 }),
    );
    run(
        r,
        &mut doc,
        "label_add",
        json!({ "x": 300, "y": 200, "text": "Plan & export" }),
    );
    let piece = run(
        r,
        &mut doc,
        "furniture_add",
        json!({ "catalog_id": "eTeks#bed140x190", "x": 300, "y": 200 }),
    );
    run(
        r,
        &mut doc,
        "furniture_update",
        json!({ "id": piece["id"], "name": "Table \"Oslo\"", "width": 160 }),
    );
    run(r, &mut doc, "level_add", json!({ "name": "Upper floor" }));
    run(
        r,
        &mut doc,
        "wall_add_path",
        json!({ "points": [[0, 0], [600, 0]] }),
    );
    doc
}

#[test]
fn plan_exports_to_svg_png_and_pdf() {
    let r = Registry::standard();
    let mut doc = small_house(&r);
    let dir = out_dir("plan");

    let svg = dir.join("plan.svg");
    let result = run(&r, &mut doc, "export_plan", json!({ "path": svg }));
    assert_eq!(result["paths"].as_array().unwrap().len(), 1);
    let text = std::fs::read_to_string(&svg).unwrap();
    // Upper floor is selected (added last): one wall, no room of the ground floor
    assert!(text.contains("<pattern"), "walls use the hatch pattern");
    assert!(!text.contains("Living"));

    // All levels as separate files named after the levels
    let result = run(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": svg, "level": "all" }),
    );
    let paths: Vec<String> = serde_json::from_value(result["paths"].clone()).unwrap();
    // The first level_add also creates the level of the existing elements, like Sweet Home 3D
    assert_eq!(paths.len(), 3);
    let ground = paths
        .iter()
        .find(|p| p.ends_with("plan - Ground floor.svg"))
        .unwrap_or_else(|| panic!("{paths:?}"));
    let ground = std::fs::read_to_string(ground).unwrap();
    // Text is escaped; dimension lengths are formatted like the app
    assert!(ground.contains("Living, dining"));
    assert!(ground.contains("Plan &amp; export"));
    assert!(ground.contains("6.00 m"));

    let png = dir.join("plan.png");
    run(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": png, "width": 800 }),
    );
    assert!(
        std::fs::read(&png)
            .unwrap()
            .starts_with(&[0x89, b'P', b'N', b'G'])
    );

    let pdf = dir.join("plan.pdf");
    let result = run(
        &r,
        &mut doc,
        "export_plan",
        json!({ "path": pdf, "level": "all", "scale": 50, "paper": "a3" }),
    );
    assert_eq!(result["pages"], 3);
    assert_eq!(result["scales"], json!([50.0, 50.0, 50.0]));
    assert!(std::fs::read(&pdf).unwrap().starts_with(b"%PDF"));

    // Unknown formats and papers are reported
    assert!(
        r.execute(
            &mut doc,
            "export_plan",
            json!({ "path": dir.join("plan.gif") })
        )
        .is_err()
    );
    assert!(
        r.execute(
            &mut doc,
            "export_plan",
            json!({ "path": pdf, "paper": "a0" })
        )
        .is_err()
    );
    // Exports do not change the home
    assert!(!doc.can_redo());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn furniture_list_exports_to_csv() {
    let r = Registry::standard();
    let mut doc = small_house(&r);
    let dir = out_dir("csv");
    let csv = dir.join("furniture.csv");

    let result = run(
        &r,
        &mut doc,
        "export_furniture_csv",
        json!({ "path": csv, "columns": ["name", "WIDTH", "LEVEL"], "separator": ";" }),
    );
    assert_eq!(result["rows"], 1);
    let bytes = std::fs::read(&csv).unwrap();
    // UTF-8 BOM for spreadsheet programs
    assert!(bytes.starts_with(b"\xEF\xBB\xBF"));
    let text = String::from_utf8(bytes[3..].to_vec()).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines[0], "Name;Width (cm);Level");
    // Quotes inside values are doubled
    assert_eq!(lines[1], "\"Table \"\"Oslo\"\"\";160;Ground floor");

    // Default columns of Sweet Home 3D's furniture table
    run(&r, &mut doc, "export_furniture_csv", json!({ "path": csv }));
    let text = std::fs::read_to_string(&csv).unwrap();
    assert!(text.contains("Name,Width (cm),Depth (cm),Height (cm),Visible"));

    let err = r
        .execute(
            &mut doc,
            "export_furniture_csv",
            json!({ "path": csv, "columns": ["COLOUR"] }),
        )
        .unwrap_err();
    assert!(err.to_string().contains("unknown column"));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn printed_home_has_furniture_plan_and_3d_pages() {
    use base64::Engine;
    let r = Registry::standard();
    let mut doc = small_house(&r);
    let dir = out_dir("document");

    // Pages for printing: furniture list, three levels and the 3D view
    let image = msh_export::svg_to_png(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="red"/></svg>"#,
        40,
    )
    .unwrap();
    let image = base64::engine::general_purpose::STANDARD.encode(image);
    let result = run(
        &r,
        &mut doc,
        "export_document",
        json!({ "view_3d_image": image, "columns": ["NAME", "PRICE"] }),
    );
    let pages = result["pages"].as_array().unwrap();
    assert_eq!(pages.len(), 5);
    let first = pages[0].as_str().unwrap();
    assert!(
        first.contains("Export test - Furniture"),
        "title without .sh3d"
    );
    assert!(first.contains("Page 1 of 5"));
    assert!(first.contains("Table &quot;Oslo&quot;"));
    // No prices in the home: no total row
    assert!(!first.contains("Total"));
    assert!(
        pages[4]
            .as_str()
            .unwrap()
            .contains("data:image/png;base64,")
    );
    assert_eq!(result["landscape"].as_array().unwrap().len(), 5);
    assert_eq!(result["paper_mm"], json!([210.0, 297.0]));

    // PDF without the 3D image: the 3D page is left out with a note
    let pdf = dir.join("home.pdf");
    let result = run(
        &r,
        &mut doc,
        "export_document",
        json!({ "path": pdf, "furniture": false, "scale": 100 }),
    );
    assert_eq!(result["pages"], 3);
    assert_eq!(result["notes"].as_array().unwrap().len(), 1);
    assert!(std::fs::read(&pdf).unwrap().starts_with(b"%PDF"));

    assert!(
        r.execute(
            &mut doc,
            "export_document",
            json!({ "furniture": false, "plan": false, "view_3d": false })
        )
        .is_err()
    );
    let _ = std::fs::remove_dir_all(dir);
}
