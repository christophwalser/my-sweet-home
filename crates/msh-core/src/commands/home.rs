//! Home commands: new, open, save, describe, settings.

use super::{color_hex, deg, round2};
use crate::document::{DEFAULT_WALL_HEIGHT, Document};
use crate::registry::{CommandError, CommandResult, Registry};
use msh_model::{Furniture, PieceKind};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::PathBuf;

#[derive(Deserialize, JsonSchema)]
struct NewParams {
    /// Name of the home
    name: Option<String>,
    /// Default wall height in cm (default 250)
    wall_height: Option<f32>,
}

#[derive(Deserialize, JsonSchema)]
struct OpenParams {
    /// Path of a .sh3d file (or a standalone Home.xml)
    path: PathBuf,
}

#[derive(Deserialize, JsonSchema)]
struct SaveParams {
    /// Target path (.sh3d); defaults to the path the home was opened from
    path: Option<PathBuf>,
}

#[derive(Deserialize, JsonSchema)]
struct DescribeParams {
    /// Only describe elements on this level
    level: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct SetParams {
    name: Option<String>,
    /// Default height of new walls in cm
    wall_height: Option<f32>,
    /// Lock the base plan (walls, rooms, dimensions, labels, polylines, doors, windows and
    /// fixed furniture) so that only movable furniture can be selected in the plan
    base_plan_locked: Option<bool>,
    /// Columns of the furniture list, in order (Sweet Home 3D's names: NAME, WIDTH, DEPTH,
    /// HEIGHT, X, Y, ELEVATION, ANGLE, LEVEL, CATALOG_ID, CREATOR, DESCRIPTION, LICENSE,
    /// MODEL_SIZE, COLOR, TEXTURE, MOVABLE, DOOR_OR_WINDOW, VISIBLE, PRICE,
    /// VALUE_ADDED_TAX_PERCENTAGE, VALUE_ADDED_TAX, PRICE_VALUE_ADDED_TAX_INCLUDED); stored
    /// in the home like Sweet Home 3D does. An empty list restores the default columns
    furniture_columns: Option<Vec<String>>,
}

#[derive(Deserialize, JsonSchema)]
struct CompassParams {
    /// Center of the compass in the plan (cm)
    x: Option<f32>,
    y: Option<f32>,
    /// Diameter in cm
    diameter: Option<f32>,
    /// Direction of north in degrees, clockwise from the top of the plan
    north_direction_deg: Option<f32>,
    /// Geographic position (degrees, north and east positive), used for the sun position
    latitude_deg: Option<f32>,
    longitude_deg: Option<f32>,
    /// Show the compass in the plan
    visible: Option<bool>,
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "compass_update",
        "Changes position, size, north direction, geographic position or visibility of the \
         compass (created if the home has none).",
        true,
        |doc, p: CompassParams| {
            let home = doc.home_mut();
            let compass = home.compass.get_or_insert_with(|| msh_model::Compass {
                attrs: msh_model::CompassAttrs {
                    x: -100.0,
                    y: 50.0,
                    diameter: 100.0,
                    north_direction: Some(0.0),
                    visible: Some(true),
                    ..Default::default()
                },
                properties: Vec::new(),
                extra_children: Vec::new(),
            });
            let a = &mut compass.attrs;
            if let Some(v) = p.x {
                a.x = v;
            }
            if let Some(v) = p.y {
                a.y = v;
            }
            if let Some(v) = p.diameter {
                if v <= 0.0 {
                    return Err(CommandError::failed("diameter must be positive"));
                }
                a.diameter = v;
            }
            if let Some(v) = p.north_direction_deg {
                a.north_direction = Some(v.rem_euclid(360.0).to_radians());
            }
            if let Some(v) = p.latitude_deg {
                a.latitude = Some(v.clamp(-90.0, 90.0).to_radians());
            }
            if let Some(v) = p.longitude_deg {
                a.longitude = Some(v.clamp(-180.0, 180.0).to_radians());
            }
            if let Some(v) = p.visible {
                a.visible = Some(v);
            }
            Ok(json!({ "updated": true }))
        },
    );
    r.add(
        "home_new",
        "Creates a new, empty home and discards the current one (unsaved changes are lost).",
        false,
        |doc, p: NewParams| {
            let clipboard = doc.clipboard.take();
            *doc = Document::new_home(p.name, p.wall_height.unwrap_or(DEFAULT_WALL_HEIGHT));
            doc.clipboard = clipboard;
            Ok(json!({ "created": true }))
        },
    );
    r.add(
        "home_open",
        "Opens a Sweet Home 3D file (.sh3d) and replaces the current home.",
        false,
        |doc, p: OpenParams| {
            let opened =
                Document::open(&p.path).map_err(|e| CommandError::failed(e.to_string()))?;
            let clipboard = doc.clipboard.take();
            *doc = opened;
            doc.clipboard = clipboard;
            describe(doc, None)
        },
    );
    r.add(
        "home_save",
        "Saves the home as .sh3d file, compatible with Sweet Home 3D.",
        false,
        |doc, p: SaveParams| {
            let path = doc
                .save(p.path.as_deref())
                .map_err(|e| CommandError::failed(e.to_string()))?;
            Ok(json!({ "saved": path }))
        },
    );
    r.add(
        "home_describe",
        "Returns a structured description of the home: levels, walls, rooms, furniture, labels \
         with IDs, coordinates (cm) and angles (degrees). Use it to inspect the current state.",
        false,
        |doc, p: DescribeParams| describe(doc, p.level.as_deref()),
    );
    r.add(
        "home_set",
        "Changes home settings such as name, default wall height and the lock of the base plan.",
        true,
        |doc, p: SetParams| {
            if let Some(columns) = p.furniture_columns {
                let mut list: Vec<String> = Vec::new();
                for c in columns {
                    let c = c.to_ascii_uppercase();
                    if !msh_export::FURNITURE_COLUMNS.contains(&c.as_str()) {
                        return Err(CommandError::failed(format!(
                            "unknown furniture column '{c}'; known columns: {}",
                            msh_export::FURNITURE_COLUMNS.join(", ")
                        )));
                    }
                    if !list.contains(&c) {
                        list.push(c);
                    }
                }
                doc.home_mut().furniture_visible_properties = list;
            }
            let a = &mut doc.home_mut().attrs;
            if let Some(n) = p.name {
                a.name = Some(n);
            }
            if let Some(h) = p.wall_height {
                if h <= 0.0 {
                    return Err(CommandError::failed("wall_height must be positive"));
                }
                a.wall_height = Some(h);
            }
            if let Some(l) = p.base_plan_locked {
                // Sweet Home 3D writes the attribute only when the plan is locked
                a.base_plan_locked = l.then_some(true);
            }
            Ok(json!({ "updated": true }))
        },
    );
}

/// Structured description of the home for AI agents and scripts.
pub(crate) fn describe(doc: &Document, level: Option<&str>) -> CommandResult {
    let home = doc.home();
    let on_level = |l: &Option<String>| level.is_none() || l.as_deref() == level;
    let mut furniture = Vec::new();
    fn walk(items: &[Furniture], out: &mut Vec<Value>, filter: &dyn Fn(&Option<String>) -> bool) {
        for item in items {
            match item {
                Furniture::Piece(p) => {
                    let a = &p.attrs;
                    if !filter(&a.level) {
                        continue;
                    }
                    out.push(json!({
                        "id": a.id,
                        "name": a.name,
                        "kind": match p.kind {
                            PieceKind::Piece => "furniture",
                            PieceKind::DoorOrWindow => "door_or_window",
                            PieceKind::Light => "light",
                            PieceKind::ShelfUnit => "shelf_unit",
                        },
                        "catalog_id": a.catalog_id,
                        "level": a.level,
                        "x": round2(a.x),
                        "y": round2(a.y),
                        "angle_deg": deg(a.angle_or_default()),
                        "elevation": round2(a.elevation_or_default()),
                        "width": round2(a.width),
                        "depth": round2(a.depth),
                        "height": round2(a.height),
                        "visible": a.is_visible(),
                    }));
                }
                Furniture::Group(g) => walk(&g.items, out, filter),
            }
        }
    }
    walk(&home.furniture, &mut furniture, &on_level);

    let default_height = home.attrs.wall_height.unwrap_or(DEFAULT_WALL_HEIGHT);
    let walls: Vec<Value> = home
        .walls
        .iter()
        .filter(|w| on_level(&w.attrs.level))
        .map(|w| {
            let a = &w.attrs;
            json!({
                "id": a.id,
                "level": a.level,
                "start": [round2(a.x_start), round2(a.y_start)],
                "end": [round2(a.x_end), round2(a.y_end)],
                "length": round2(w.chord_length()),
                "thickness": round2(a.thickness),
                "height": round2(a.height.unwrap_or(default_height)),
                "height_at_end": a.height_at_end.map(round2),
                "arc_extent_deg": a.arc_extent.map(deg),
                "wall_at_start": a.wall_at_start,
                "wall_at_end": a.wall_at_end,
                "left_side_color": color_hex(a.left_side_color),
                "right_side_color": color_hex(a.right_side_color),
            })
        })
        .collect();

    let rooms: Vec<Value> = home
        .rooms
        .iter()
        .filter(|r| on_level(&r.attrs.level))
        .map(|r| {
            json!({
                "id": r.attrs.id,
                "name": r.attrs.name,
                "level": r.attrs.level,
                "area_m2": round2(r.area() / 10_000.0),
                "points": r.points.iter().map(|p| [round2(p.x), round2(p.y)]).collect::<Vec<_>>(),
                "floor_color": color_hex(r.attrs.floor_color),
                "floor_texture": r.textures.iter().find(|t| t.role.as_deref() == Some("floorTexture")).map(|t| &t.name),
            })
        })
        .collect();

    let labels: Vec<Value> = home
        .labels
        .iter()
        .filter(|l| on_level(&l.attrs.level))
        .map(|l| json!({ "id": l.attrs.id, "text": l.text, "x": round2(l.attrs.x), "y": round2(l.attrs.y), "level": l.attrs.level }))
        .collect();

    let dimension_lines: Vec<Value> = home
        .dimension_lines
        .iter()
        .filter(|d| on_level(&d.attrs.level))
        .map(|d| {
            let a = &d.attrs;
            json!({
                "id": a.id,
                "start": [round2(a.x_start), round2(a.y_start)],
                "end": [round2(a.x_end), round2(a.y_end)],
                "length": round2((a.x_end - a.x_start).hypot(a.y_end - a.y_start)),
                "level": a.level,
            })
        })
        .collect();

    Ok(json!({
        "name": home.attrs.name,
        "path": doc.path,
        "modified": doc.modified,
        "wall_height": default_height,
        "selected_level": home.attrs.selected_level,
        "levels": home.levels.iter().map(|l| json!({
            "id": l.attrs.id,
            "name": l.attrs.name,
            "elevation": round2(l.attrs.elevation),
            "height": round2(l.attrs.height),
            "floor_thickness": round2(l.attrs.floor_thickness),
        })).collect::<Vec<_>>(),
        "walls": walls,
        "rooms": rooms,
        "furniture": furniture,
        "labels": labels,
        "dimension_lines": dimension_lines,
        "can_undo": doc.can_undo(),
        "can_redo": doc.can_redo(),
    }))
}
