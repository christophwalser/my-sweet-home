//! The furniture list as CSV, with the columns of Sweet Home 3D's furniture table.

use crate::plan::collect_pieces;
use msh_model::{Home, Piece, PieceKind};

/// Columns shown by Sweet Home 3D when a home stores none.
pub const DEFAULT_COLUMNS: &[&str] = &["NAME", "WIDTH", "DEPTH", "HEIGHT", "VISIBLE"];

/// All columns understood by [`furniture_csv`] (Sweet Home 3D's sortable properties).
pub const COLUMNS: &[&str] = &[
    "CATALOG_ID",
    "NAME",
    "DESCRIPTION",
    "CREATOR",
    "LICENSE",
    "WIDTH",
    "DEPTH",
    "HEIGHT",
    "X",
    "Y",
    "ELEVATION",
    "ANGLE",
    "LEVEL",
    "MODEL_SIZE",
    "COLOR",
    "TEXTURE",
    "MOVABLE",
    "DOOR_OR_WINDOW",
    "VISIBLE",
    "PRICE",
    "VALUE_ADDED_TAX_PERCENTAGE",
    "VALUE_ADDED_TAX",
    "PRICE_VALUE_ADDED_TAX_INCLUDED",
];

/// Header text of a column.
pub(crate) fn header(column: &str) -> &str {
    match column {
        "CATALOG_ID" => "Catalog ID",
        "NAME" => "Name",
        "DESCRIPTION" => "Description",
        "CREATOR" => "Creator",
        "LICENSE" => "License",
        "WIDTH" => "Width (cm)",
        "DEPTH" => "Depth (cm)",
        "HEIGHT" => "Height (cm)",
        "X" => "X (cm)",
        "Y" => "Y (cm)",
        "ELEVATION" => "Elevation (cm)",
        "ANGLE" => "Angle (°)",
        "LEVEL" => "Level",
        "MODEL_SIZE" => "Model size (bytes)",
        "COLOR" => "Color",
        "TEXTURE" => "Texture",
        "MOVABLE" => "Movable",
        "DOOR_OR_WINDOW" => "Door/window",
        "VISIBLE" => "Visible",
        "PRICE" => "Price",
        "VALUE_ADDED_TAX_PERCENTAGE" => "VAT %",
        "VALUE_ADDED_TAX" => "VAT",
        "PRICE_VALUE_ADDED_TAX_INCLUDED" => "Price incl. VAT",
        other => other,
    }
}

/// Columns to export: the given ones, else the home's visible furniture columns,
/// else Sweet Home 3D's defaults. Unknown names are reported as error.
pub fn resolve_columns(home: &Home, columns: Option<&[String]>) -> Result<Vec<String>, String> {
    let list: Vec<String> = match columns {
        Some(c) if !c.is_empty() => c.iter().map(|s| s.to_ascii_uppercase()).collect(),
        _ if !home.furniture_visible_properties.is_empty() => {
            home.furniture_visible_properties.clone()
        }
        _ => DEFAULT_COLUMNS.iter().map(|s| s.to_string()).collect(),
    };
    if let Some(bad) = list.iter().find(|c| !COLUMNS.contains(&c.as_str())) {
        return Err(format!(
            "unknown column '{bad}'; known columns: {}",
            COLUMNS.join(", ")
        ));
    }
    Ok(list)
}

/// The furniture of a home (all levels, pieces of groups included) as CSV with a header row.
pub fn furniture_csv(home: &Home, columns: &[String], separator: char) -> String {
    let mut pieces = Vec::new();
    collect_pieces(&home.furniture, &mut pieces);
    let mut out = String::new();
    let row = |cells: Vec<String>| {
        cells
            .iter()
            .map(|c| quote(c, separator))
            .collect::<Vec<_>>()
            .join(&separator.to_string())
    };
    out.push_str(&row(columns
        .iter()
        .map(|c| header(c).to_string())
        .collect()));
    out.push_str("\r\n");
    for p in pieces {
        out.push_str(&row(columns.iter().map(|c| cell(home, p, c)).collect()));
        out.push_str("\r\n");
    }
    out
}

pub(crate) fn cell(home: &Home, p: &Piece, column: &str) -> String {
    let a = &p.attrs;
    let flag = |b: bool| if b { "true" } else { "false" }.to_string();
    let price = a.price.as_deref().and_then(|v| v.parse::<f64>().ok());
    let vat_pct = a
        .value_added_tax_percentage
        .as_deref()
        .and_then(|v| v.parse::<f64>().ok());
    let vat = price.zip(vat_pct).map(|(p, v)| p * v);
    match column {
        "CATALOG_ID" => a.catalog_id.clone().unwrap_or_default(),
        "NAME" => a.name.clone(),
        "DESCRIPTION" => a.description.clone().unwrap_or_default(),
        "CREATOR" => a.creator.clone().unwrap_or_default(),
        "LICENSE" => a.license.clone().unwrap_or_default(),
        "WIDTH" => number(a.width),
        "DEPTH" => number(a.depth),
        "HEIGHT" => number(a.height),
        "X" => number(a.x),
        "Y" => number(a.y),
        "ELEVATION" => number(a.elevation_or_default()),
        "ANGLE" => number(a.angle_or_default().to_degrees().rem_euclid(360.0)),
        "LEVEL" => a
            .level
            .as_ref()
            .and_then(|id| home.levels.iter().find(|l| &l.attrs.id == id))
            .map(|l| l.attrs.name.clone())
            .unwrap_or_default(),
        "MODEL_SIZE" => a.model_size.map(|v| v.to_string()).unwrap_or_default(),
        "COLOR" => a
            .color
            .map(|c| format!("#{:06X}", c.0 & 0xFF_FFFF))
            .unwrap_or_default(),
        "TEXTURE" => p
            .texture
            .as_ref()
            .map(|t| t.name.clone())
            .unwrap_or_default(),
        "MOVABLE" => flag(a.movable != Some(false)),
        "DOOR_OR_WINDOW" => flag(p.kind == PieceKind::DoorOrWindow),
        "VISIBLE" => flag(a.is_visible()),
        "PRICE" => price.map(money).unwrap_or_default(),
        // Sweet Home 3D stores the VAT as a fraction (0.2 = 20 %)
        "VALUE_ADDED_TAX_PERCENTAGE" => vat_pct
            .map(|v| number((v * 100.0) as f32))
            .unwrap_or_default(),
        "VALUE_ADDED_TAX" => vat.map(money).unwrap_or_default(),
        "PRICE_VALUE_ADDED_TAX_INCLUDED" => price
            .map(|p| money(p + vat.unwrap_or(0.0)))
            .unwrap_or_default(),
        _ => String::new(),
    }
}

/// Number with at most one decimal, without trailing zeros.
fn number(v: f32) -> String {
    let r = (v * 10.0).round() / 10.0;
    if r.fract() == 0.0 {
        format!("{r:.0}")
    } else {
        format!("{r:.1}")
    }
}

fn money(v: f64) -> String {
    format!("{v:.2}")
}

fn quote(value: &str, separator: char) -> String {
    if value.contains(separator) || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}
