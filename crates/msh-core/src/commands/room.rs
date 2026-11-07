//! Room commands.

use super::wall::texture_for;
use super::{new_id, non_empty, optional_color, parse_color, resolve_level, target_ids, updated};
use crate::registry::{CommandError, Registry};
use msh_model::{Point, Room, RoomAttrs};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize, JsonSchema)]
struct AddParams {
    /// Corner points of the floor as [[x, y], ...] in cm (at least 3). Usually the inner
    /// outline of the surrounding walls. Give either `points` or `inside_point`.
    points: Option<Vec<[f32; 2]>>,
    /// A point [x, y] inside closed walls: the room gets the outline of the area enclosed
    /// by the walls around it (like a double-click with the room tool)
    inside_point: Option<[f32; 2]>,
    /// Name shown in the plan, e.g. "Kitchen"
    name: Option<String>,
    level: Option<String>,
    /// Show the area in the plan (default true)
    area_visible: Option<bool>,
    /// Floor color as #RRGGBB
    floor_color: Option<String>,
    /// Catalog ID of a floor texture (see catalog_search with kind "textures")
    floor_texture: Option<String>,
    ceiling_color: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateParams {
    /// Room to change (or use `ids`)
    id: Option<String>,
    /// Several rooms that get the same values (one undo step)
    ids: Option<Vec<String>>,
    name: Option<String>,
    points: Option<Vec<[f32; 2]>>,
    area_visible: Option<bool>,
    floor_visible: Option<bool>,
    ceiling_visible: Option<bool>,
    /// Floor color as #RRGGBB, "" for the default
    floor_color: Option<String>,
    /// Catalog ID of a floor texture, "" to remove it
    floor_texture: Option<String>,
    ceiling_color: Option<String>,
    ceiling_texture: Option<String>,
    /// Offset of the name label in cm from the center of the room's bounding box
    /// (Sweet Home 3D convention)
    name_x_offset: Option<f32>,
    name_y_offset: Option<f32>,
    /// Offset of the area label in cm from the center of the room's bounding box
    area_x_offset: Option<f32>,
    area_y_offset: Option<f32>,
    /// Font size of the room name in cm
    name_font_size: Option<f32>,
    /// Font size of the area in cm
    area_font_size: Option<f32>,
    /// Remove the label offsets: name and area are placed automatically again
    reset_label_positions: Option<bool>,
    /// Remove only the offset of the name label
    reset_name_position: Option<bool>,
    /// Remove only the offset of the area label
    reset_area_position: Option<bool>,
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "room_add",
        "Adds a room (floor and ceiling) with the given corner points, optional name, colors and \
         floor texture.",
        true,
        |doc, p: AddParams| {
            let level = resolve_level(doc.home(), p.level)?;
            let points = match (p.points, p.inside_point) {
                (Some(points), None) => points,
                (None, Some(at)) => msh_geometry::enclosed_area(doc.home(), level.as_deref(), at)
                    .ok_or_else(|| {
                    CommandError::failed(format!(
                        "the point ({}, {}) is not enclosed by walls",
                        at[0], at[1]
                    ))
                })?,
                _ => {
                    return Err(CommandError::failed("give either points or inside_point"));
                }
            };
            if points.len() < 3 {
                return Err(CommandError::failed("a room needs at least 3 points"));
            }
            let floor_tex = texture_for(doc, p.floor_texture.as_deref(), "floorTexture")?;
            let id = new_id("room");
            let room = Room {
                attrs: RoomAttrs {
                    id: Some(id.clone()),
                    level,
                    name: p.name,
                    area_visible: Some(p.area_visible.unwrap_or(true)),
                    floor_color: p.floor_color.as_deref().map(parse_color).transpose()?,
                    ceiling_color: p.ceiling_color.as_deref().map(parse_color).transpose()?,
                    ..Default::default()
                },
                textures: floor_tex.into_iter().collect(),
                points: to_points(&points),
                ..Default::default()
            };
            doc.home_mut().rooms.push(room);
            Ok(json!({ "id": id, "points": points }))
        },
    );
    r.add(
        "room_update",
        "Changes name, outline, label positions, visibility, colors or textures of a room (or of several rooms \
         with ids; the outline only for one room).",
        true,
        |doc, p: UpdateParams| {
            let floor_tex = texture_for(doc, non_empty(&p.floor_texture), "floorTexture")?;
            let ceiling_tex = texture_for(doc, non_empty(&p.ceiling_texture), "ceilingTexture")?;
            let targets = target_ids(p.id.clone(), p.ids.clone())?;
            if targets.len() > 1 && p.points.is_some() {
                return Err(CommandError::failed(
                    "the outline can only be changed for one room at a time",
                ));
            }
            for target in &targets {
                let room = doc
                    .home_mut()
                    .rooms
                    .iter_mut()
                    .find(|r| r.attrs.id.as_deref() == Some(target.as_str()))
                    .ok_or_else(|| CommandError::failed(format!("unknown room '{target}'")))?;
                let a = &mut room.attrs;
                if let Some(v) = &p.name {
                    a.name = Some(v.clone());
                }
                for (role, size) in [("nameStyle", p.name_font_size), ("areaStyle", p.area_font_size)] {
                    let Some(size) = size else { continue };
                    if size <= 0.0 {
                        return Err(CommandError::failed("font size must be positive"));
                    }
                    match room.text_styles.iter_mut().find(|t| t.role.as_deref() == Some(role)) {
                        Some(style) => style.font_size = size,
                        None => room.text_styles.push(msh_model::TextStyle {
                            role: Some(role.to_owned()),
                            font_size: size,
                            ..Default::default()
                        }),
                    }
                }
                let a = &mut room.attrs;
                let reset_all = p.reset_label_positions == Some(true);
                if reset_all || p.reset_name_position == Some(true) {
                    a.name_x_offset = None;
                    a.name_y_offset = None;
                }
                if reset_all || p.reset_area_position == Some(true) {
                    a.area_x_offset = None;
                    a.area_y_offset = None;
                }
                macro_rules! offset {
                    ($($f:ident),*) => { $( if let Some(v) = p.$f { a.$f = Some(v); } )* };
                }
                offset!(name_x_offset, name_y_offset, area_x_offset, area_y_offset);
                if let Some(v) = p.area_visible {
                    a.area_visible = Some(v);
                }
                if let Some(v) = p.floor_visible {
                    a.floor_visible = Some(v);
                }
                if let Some(v) = p.ceiling_visible {
                    a.ceiling_visible = Some(v);
                }
                if let Some(c) = &p.floor_color {
                    a.floor_color = optional_color(c)?;
                }
                if let Some(c) = &p.ceiling_color {
                    a.ceiling_color = optional_color(c)?;
                }
                if let Some(points) = &p.points {
                    if points.len() < 3 {
                        return Err(CommandError::failed("a room needs at least 3 points"));
                    }
                    room.points = to_points(points);
                }
                for (role, tex, param) in [
                    ("floorTexture", floor_tex.clone(), &p.floor_texture),
                    ("ceilingTexture", ceiling_tex.clone(), &p.ceiling_texture),
                ] {
                    if param.is_some() {
                        room.textures.retain(|t| t.role.as_deref() != Some(role));
                    }
                    room.textures.extend(tex);
                }
            }
            Ok(updated(&targets))
        },
    );
}

fn to_points(points: &[[f32; 2]]) -> Vec<Point> {
    points
        .iter()
        .map(|p| Point {
            x: p[0],
            y: p[1],
            ..Default::default()
        })
        .collect()
}
