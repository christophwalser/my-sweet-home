//! Room commands.

use super::wall::texture_for;
use super::{new_id, parse_color, resolve_level};
use crate::registry::{CommandError, Registry};
use msh_model::{Point, Room, RoomAttrs};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize, JsonSchema)]
struct AddParams {
    /// Corner points of the floor as [[x, y], ...] in cm (at least 3). Usually the inner
    /// outline of the surrounding walls.
    points: Vec<[f32; 2]>,
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
    id: String,
    name: Option<String>,
    points: Option<Vec<[f32; 2]>>,
    area_visible: Option<bool>,
    floor_visible: Option<bool>,
    ceiling_visible: Option<bool>,
    floor_color: Option<String>,
    floor_texture: Option<String>,
    ceiling_color: Option<String>,
    ceiling_texture: Option<String>,
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "room_add",
        "Adds a room (floor and ceiling) with the given corner points, optional name, colors and \
         floor texture.",
        true,
        |doc, p: AddParams| {
            if p.points.len() < 3 {
                return Err(CommandError::failed("a room needs at least 3 points"));
            }
            let level = resolve_level(doc.home(), p.level)?;
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
                points: to_points(&p.points),
                ..Default::default()
            };
            doc.home_mut().rooms.push(room);
            Ok(json!({ "id": id }))
        },
    );
    r.add(
        "room_update",
        "Changes name, outline, visibility, colors or textures of a room.",
        true,
        |doc, p: UpdateParams| {
            let floor_tex = texture_for(doc, p.floor_texture.as_deref(), "floorTexture")?;
            let ceiling_tex = texture_for(doc, p.ceiling_texture.as_deref(), "ceilingTexture")?;
            let room = doc
                .home_mut()
                .rooms
                .iter_mut()
                .find(|r| r.attrs.id.as_deref() == Some(p.id.as_str()))
                .ok_or_else(|| CommandError::failed(format!("unknown room '{}'", p.id)))?;
            let a = &mut room.attrs;
            if let Some(v) = p.name {
                a.name = Some(v);
            }
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
                a.floor_color = Some(parse_color(c)?);
            }
            if let Some(c) = &p.ceiling_color {
                a.ceiling_color = Some(parse_color(c)?);
            }
            if let Some(points) = &p.points {
                if points.len() < 3 {
                    return Err(CommandError::failed("a room needs at least 3 points"));
                }
                room.points = to_points(points);
            }
            for tex in [floor_tex, ceiling_tex].into_iter().flatten() {
                room.textures.retain(|t| t.role != tex.role);
                room.textures.push(tex);
            }
            Ok(json!({ "id": p.id }))
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
