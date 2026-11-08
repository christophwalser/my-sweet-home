//! Level commands.

use super::{new_id, ok_id};
use crate::document::DEFAULT_WALL_HEIGHT;
use crate::registry::{CommandError, Registry};
use msh_model::{Furniture, Home, Level, LevelAttrs};
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
            let top = home
                .levels
                .iter()
                .map(|l| l.attrs.elevation + l.attrs.height)
                .fold(0.0f32, f32::max);
            let floor = p.floor_thickness.unwrap_or(DEFAULT_FLOOR_THICKNESS);
            // Like Sweet Home 3D: the floor of the new level lies on top of the highest
            // level, so its elevation (top of the floor) is that top plus the floor thickness
            let elevation = p.elevation.unwrap_or(top + floor);
            let index = home
                .levels
                .iter()
                .filter(|l| l.attrs.elevation == elevation)
                .count() as i64;
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
        "Changes name, elevation, height, floor thickness or 3D visibility of a level.",
        true,
        |doc, p: UpdateParams| {
            let l = doc
                .home_mut()
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
            Ok(ok_id(&p.id))
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
