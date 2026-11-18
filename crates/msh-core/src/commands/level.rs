//! Level commands.

use super::{new_id, ok_id};
use crate::clipboard::Clipboard;
use crate::document::DEFAULT_WALL_HEIGHT;
use crate::registry::{CommandError, Registry};
use msh_model::{Furniture, Home, Level, LevelAttrs, PieceKind};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;

/// Floor thickness of new levels in cm (as in Sweet Home 3D).
const DEFAULT_FLOOR_THICKNESS: f32 = 12.0;

#[derive(Deserialize, JsonSchema)]
struct AddParams {
    /// Name, e.g. "Upper floor"
    name: String,
    /// Elevation of the top of the floor in cm; defaults to the top of the highest level
    /// plus the floor thickness (as in Sweet Home 3D)
    elevation: Option<f32>,
    /// Height of the level in cm; defaults to the home's wall height
    height: Option<f32>,
    /// Floor thickness in cm (default 12)
    floor_thickness: Option<f32>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateParams {
    id: String,
    name: Option<String>,
    elevation: Option<f32>,
    height: Option<f32>,
    floor_thickness: Option<f32>,
    /// Show the level in the 3D view
    viewable: Option<bool>,
    /// Position among the levels at the same elevation (0 = first); the others are renumbered
    elevation_index: Option<i64>,
    /// Move the levels above by the same amount when the top of this level (elevation +
    /// height) changes, so the storeys stay stacked (default false)
    shift_above: Option<bool>,
    /// Give the walls of this level that had the old level height the new height
    /// (default false)
    adjust_walls: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
struct DuplicateParams {
    /// Level to copy
    id: String,
    /// Name of the new level (default: the name of the copied level with " (2)")
    name: Option<String>,
    /// Elevation of the top of the floor in cm; defaults to the top of the highest level
    /// plus the floor thickness
    elevation: Option<f32>,
    /// Copy the rooms too (default false)
    rooms: Option<bool>,
    /// Copy the doors and windows too (default false)
    openings: Option<bool>,
    /// Copy the other furniture too (default false)
    furniture: Option<bool>,
    /// Copy texts, dimension lines and polylines too (default false)
    annotations: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
struct SelectParams {
    /// Level ID; new elements without explicit level are placed on the selected level
    id: String,
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "level_add",
        "Adds a level (storey). If the home has no levels yet, a 'Level 0' is created first for \
         the existing elements. The new level becomes the selected level.",
        true,
        |doc, p: AddParams| {
            let home = doc.home_mut();
            let wall_height = home.attrs.wall_height.unwrap_or(DEFAULT_WALL_HEIGHT);
            if home.levels.is_empty() {
                let id = new_id("level");
                home.levels.push(level(
                    &id,
                    "Level 0",
                    0.0,
                    wall_height,
                    DEFAULT_FLOOR_THICKNESS,
                    0,
                ));
                assign_level(home, &id);
                // The home's background image becomes the one of the first level, as in
                // Sweet Home 3D, so it stays visible under the elements it was drawn on
                let background = home.background_image.take();
                if let Some(first) = home.levels.last_mut() {
                    first.background_image = background;
                }
            }
            let floor = p.floor_thickness.unwrap_or(DEFAULT_FLOOR_THICKNESS);
            // Like Sweet Home 3D: the floor of the new level lies on top of the highest
            // level, so its elevation (top of the floor) is that top plus the floor thickness
            let elevation = p.elevation.unwrap_or(top_of(home) + floor);
            let index = next_index(home, elevation);
            let id = new_id("level");
            home.levels.push(level(
                &id,
                &p.name,
                elevation,
                p.height.unwrap_or(wall_height),
                floor,
                index,
            ));
            home.attrs.selected_level = Some(id.clone());
            Ok(ok_id(&id))
        },
    );
    r.add(
        "level_update",
        "Changes name, elevation, height, floor thickness, 3D visibility or the order of a level. \
         With shift_above the levels above keep their distance to this level, with adjust_walls \
         the walls of full height follow a new level height.",
        true,
        |doc, p: UpdateParams| {
            for v in [p.elevation, p.height, p.floor_thickness]
                .into_iter()
                .flatten()
            {
                if !v.is_finite() {
                    return Err(CommandError::failed(
                        "elevation, height and floor_thickness must be numbers",
                    ));
                }
            }
            let home = doc.home_mut();
            let old = home
                .levels
                .iter()
                .find(|l| l.attrs.id == p.id)
                .map(|l| (l.attrs.elevation, l.attrs.height));
            let old_height = old.map(|o| o.1);
            if let (Some(old), Some(new)) = (old_height, p.height) {
                follow_ceiling(home, &p.id, old, new);
                if p.adjust_walls == Some(true) {
                    adjust_walls(home, &p.id, old, new);
                }
            }
            let l = home
                .levels
                .iter_mut()
                .find(|l| l.attrs.id == p.id)
                .ok_or_else(|| CommandError::failed(format!("unknown level '{}'", p.id)))?;
            let a = &mut l.attrs;
            if let Some(v) = p.name {
                a.name = v;
            }
            if let Some(v) = p.elevation {
                a.elevation = v;
            }
            if let Some(v) = p.height {
                a.height = v;
            }
            if let Some(v) = p.floor_thickness {
                a.floor_thickness = v;
            }
            if let Some(v) = p.viewable {
                a.viewable = Some(v);
            }
            let (elevation, height) = (a.elevation, a.height);
            if let (Some(true), Some((old_elevation, old_height))) = (p.shift_above, old) {
                let delta = elevation + height - (old_elevation + old_height);
                if delta.abs() > 0.0001 {
                    for l in &mut home.levels {
                        if l.attrs.id != p.id && l.attrs.elevation > old_elevation + 0.001 {
                            l.attrs.elevation += delta;
                        }
                    }
                }
            }
            if let Some(index) = p.elevation_index {
                reorder(home, &p.id, index);
            }
            Ok(ok_id(&p.id))
        },
    );
    r.add(
        "level_duplicate",
        "Adds a level with copies of the walls of another level at the same place, on top of \
         the highest level: the usual way to start the next storey. Rooms, doors and windows, \
         furniture and annotations are copied on request. The new level becomes the selected \
         level. Returns its ID and the number of copied elements.",
        true,
        |doc, p: DuplicateParams| {
            let home = doc.home();
            let source = home
                .levels
                .iter()
                .find(|l| l.attrs.id == p.id)
                .ok_or_else(|| CommandError::failed(format!("unknown level '{}'", p.id)))?
                .attrs
                .clone();
            if p.elevation.is_some_and(|v| !v.is_finite()) {
                return Err(CommandError::failed("elevation must be a number"));
            }
            let on = |l: &Option<String>| l.as_deref() == Some(p.id.as_str());
            let mut ids: Vec<String> = home
                .walls
                .iter()
                .filter(|w| on(&w.attrs.level))
                .map(|w| w.attrs.id.clone())
                .collect();
            if p.rooms == Some(true) {
                ids.extend(
                    home.rooms
                        .iter()
                        .filter(|r| on(&r.attrs.level))
                        .filter_map(|r| r.attrs.id.clone()),
                );
            }
            let (openings, furniture) = (p.openings == Some(true), p.furniture == Some(true));
            for item in &home.furniture {
                match item {
                    Furniture::Piece(piece) if on(&piece.attrs.level) => {
                        let opening = piece.kind == PieceKind::DoorOrWindow;
                        if (opening && openings) || (!opening && furniture) {
                            ids.extend(piece.attrs.id.clone());
                        }
                    }
                    Furniture::Group(g) if on(&g.attrs.level) && furniture => {
                        ids.extend(g.attrs.id.clone());
                    }
                    _ => {}
                }
            }
            if p.annotations == Some(true) {
                ids.extend(
                    home.labels
                        .iter()
                        .filter(|l| on(&l.attrs.level))
                        .filter_map(|l| l.attrs.id.clone()),
                );
                ids.extend(
                    home.dimension_lines
                        .iter()
                        .filter(|d| on(&d.attrs.level))
                        .filter_map(|d| d.attrs.id.clone()),
                );
                ids.extend(
                    home.polylines
                        .iter()
                        .filter(|l| on(&l.attrs.level))
                        .filter_map(|l| l.attrs.id.clone()),
                );
            }
            let clip = Clipboard::copy(doc, &ids);

            let home = doc.home_mut();
            let elevation = p.elevation.unwrap_or(top_of(home) + source.floor_thickness);
            let index = next_index(home, elevation);
            let id = new_id("level");
            let name = p.name.unwrap_or_else(|| format!("{} (2)", source.name));
            home.levels.push(level(
                &id,
                &name,
                elevation,
                source.height,
                source.floor_thickness,
                index,
            ));
            home.attrs.selected_level = Some(id.clone());
            // At the same place: the copies lie exactly above their originals
            let copied = clip.paste(doc, Some(id.clone()), Some((0.0, 0.0)));
            Ok(json!({ "id": id, "elements": copied.len() }))
        },
    );
    r.add(
        "level_select",
        "Selects the level on which new elements are placed by default.",
        true,
        |doc, p: SelectParams| {
            let home = doc.home_mut();
            if !home.levels.iter().any(|l| l.attrs.id == p.id) {
                return Err(CommandError::failed(format!("unknown level '{}'", p.id)));
            }
            home.attrs.selected_level = Some(p.id.clone());
            Ok(json!({ "selected_level": p.id }))
        },
    );
}

fn level(id: &str, name: &str, elevation: f32, height: f32, floor: f32, index: i64) -> Level {
    Level {
        attrs: LevelAttrs {
            id: id.to_owned(),
            name: name.to_owned(),
            elevation,
            floor_thickness: floor,
            height,
            elevation_index: Some(index),
            ..Default::default()
        },
        ..Default::default()
    }
}

/// Top of the highest level (0 without levels).
fn top_of(home: &Home) -> f32 {
    home.levels
        .iter()
        .map(|l| l.attrs.elevation + l.attrs.height)
        .fold(0.0f32, f32::max)
}

/// Index of a new level among the levels at `elevation`: after the existing ones.
fn next_index(home: &Home, elevation: f32) -> i64 {
    home.levels
        .iter()
        .filter(|l| l.attrs.elevation == elevation)
        .count() as i64
}

/// Moves the level to `index` among the levels at its elevation and renumbers them.
fn reorder(home: &mut Home, id: &str, index: i64) {
    let Some(elevation) = home
        .levels
        .iter()
        .find(|l| l.attrs.id == id)
        .map(|l| l.attrs.elevation)
    else {
        return;
    };
    let mut same: Vec<(i64, String)> = home
        .levels
        .iter()
        .filter(|l| l.attrs.elevation == elevation && l.attrs.id != id)
        .map(|l| (l.attrs.elevation_index.unwrap_or(0), l.attrs.id.clone()))
        .collect();
    same.sort_by_key(|(i, _)| *i);
    let mut order: Vec<String> = same.into_iter().map(|(_, id)| id).collect();
    let at = index.clamp(0, order.len() as i64) as usize;
    order.insert(at, id.to_owned());
    for l in &mut home.levels {
        if let Some(i) = order.iter().position(|o| *o == l.attrs.id) {
            l.attrs.elevation_index = Some(i as i64);
        }
    }
}

/// Gives the walls of the level that were as high as the level (`old`) the height `new`.
/// Lower walls (parapets, half-height walls) and sloped ends keep their height.
fn adjust_walls(home: &mut Home, level: &str, old: f32, new: f32) {
    let default = home.attrs.wall_height.unwrap_or(DEFAULT_WALL_HEIGHT);
    for w in &mut home.walls {
        let a = &mut w.attrs;
        if a.level.as_deref() != Some(level) {
            continue;
        }
        if (a.height.unwrap_or(default) - old).abs() < 0.01 {
            a.height = Some(new);
        }
        if a.height_at_end.is_some_and(|h| (h - old).abs() < 0.01) {
            a.height_at_end = Some(new);
        }
    }
}

/// Keeps ceiling-mounted pieces (top at the old ceiling) at the ceiling when the height of
/// their level changes, so they do not end up inside the floor of the level above.
fn follow_ceiling(home: &mut Home, level: &str, old: f32, new: f32) {
    if (old - new).abs() < 0.001 {
        return;
    }
    for item in &mut home.furniture {
        let Furniture::Piece(piece) = item else {
            continue;
        };
        if piece.kind == PieceKind::DoorOrWindow {
            continue;
        }
        let a = &mut piece.attrs;
        let elevation = a.elevation.unwrap_or(0.0);
        let height = a.height_in_plan.unwrap_or(a.height);
        if a.level.as_deref() == Some(level)
            && elevation > 0.0
            && (elevation + height - old).abs() < 0.5
        {
            a.elevation = Some((new - height).max(0.0)).filter(|e| *e > 0.0);
        }
    }
}

/// Puts all elements without level on `id` (used when the first level is created).
fn assign_level(home: &mut Home, id: &str) {
    let set = |l: &mut Option<String>| {
        if l.is_none() {
            *l = Some(id.to_owned());
        }
    };
    fn walk(items: &mut [Furniture], set: &dyn Fn(&mut Option<String>)) {
        for item in items {
            match item {
                Furniture::Piece(p) => set(&mut p.attrs.level),
                Furniture::Group(g) => {
                    set(&mut g.attrs.level);
                    walk(&mut g.items, set);
                }
            }
        }
    }
    walk(&mut home.furniture, &set);
    home.walls.iter_mut().for_each(|w| set(&mut w.attrs.level));
    home.rooms.iter_mut().for_each(|r| set(&mut r.attrs.level));
    home.polylines
        .iter_mut()
        .for_each(|p| set(&mut p.attrs.level));
    home.dimension_lines
        .iter_mut()
        .for_each(|d| set(&mut d.attrs.level));
    home.labels.iter_mut().for_each(|l| set(&mut l.attrs.level));
}
