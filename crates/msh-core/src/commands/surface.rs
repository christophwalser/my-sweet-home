//! Commands on the look of surfaces: the floor and ceiling of rooms, the sides and the top of
//! walls and whole pieces of furniture. A look is a color, a texture and a shininess.

use super::wall::{BaseboardParams, TOP_TEXTURE, texture_for, update_baseboard};
use super::{non_empty, optional_color, optional_shininess, rad, target_ids, updated};
use crate::document::Document;
use crate::registry::{CommandError, Registry};
use msh_geometry::Pt;
use msh_model::{Color, Home, Texture};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
enum Surface {
    /// Floor of a room
    Floor,
    /// Ceiling of a room
    Ceiling,
    /// Left side of a wall (left when walking from its start to its end)
    LeftSide,
    /// Right side of a wall
    RightSide,
    /// Top of a wall
    Top,
    /// A whole piece of furniture
    Piece,
}

impl Surface {
    fn name(self) -> &'static str {
        match self {
            Surface::Floor => "floor",
            Surface::Ceiling => "ceiling",
            Surface::LeftSide => "left_side",
            Surface::RightSide => "right_side",
            Surface::Top => "top",
            Surface::Piece => "piece",
        }
    }

    /// Role of the texture of this surface in a wall or room.
    fn role(self) -> &'static str {
        match self {
            Surface::Floor => "floorTexture",
            Surface::Ceiling => "ceilingTexture",
            Surface::LeftSide => "leftSideTexture",
            Surface::RightSide => "rightSideTexture",
            Surface::Top => TOP_TEXTURE,
            Surface::Piece => "",
        }
    }
}

/// Color, texture and shininess of one surface.
#[derive(Clone, Default)]
struct Look {
    color: Option<Color>,
    texture: Option<Texture>,
    shininess: Option<f32>,
}

fn no_surface(id: &str, surface: Surface) -> CommandError {
    CommandError::failed(format!("'{id}' has no surface '{}'", surface.name()))
}

fn unknown(id: &str) -> CommandError {
    CommandError::failed(format!("unknown room, wall or piece of furniture '{id}'"))
}

fn is_room(home: &Home, id: &str) -> bool {
    home.rooms.iter().any(|r| r.attrs.id.as_deref() == Some(id))
}

fn is_wall(home: &Home, id: &str) -> bool {
    home.walls.iter().any(|w| w.attrs.id == id)
}

/// Surfaces a look is given to when none is named: the floor of a room, both sides of a wall,
/// the whole piece.
fn default_surfaces(home: &Home, id: &str) -> Result<Vec<Surface>, CommandError> {
    if is_room(home, id) {
        return Ok(vec![Surface::Floor]);
    }
    if is_wall(home, id) {
        return Ok(vec![Surface::LeftSide, Surface::RightSide]);
    }
    let mut piece = false;
    home.for_each_piece(|p| piece |= p.attrs.id.as_deref() == Some(id));
    if piece {
        Ok(vec![Surface::Piece])
    } else {
        Err(unknown(id))
    }
}

fn get_look(home: &Home, id: &str, surface: Surface) -> Result<Look, CommandError> {
    let role = surface.role();
    let texture = |textures: &[Texture]| {
        textures
            .iter()
            .find(|t| t.role.as_deref() == Some(role))
            .cloned()
    };
    if let Some(r) = home
        .rooms
        .iter()
        .find(|r| r.attrs.id.as_deref() == Some(id))
    {
        let a = &r.attrs;
        let (color, shininess) = match surface {
            Surface::Floor => (a.floor_color, a.floor_shininess),
            Surface::Ceiling => (a.ceiling_color, a.ceiling_shininess),
            _ => return Err(no_surface(id, surface)),
        };
        return Ok(Look {
            color,
            texture: texture(&r.textures),
            shininess,
        });
    }
    if let Some(w) = home.walls.iter().find(|w| w.attrs.id == id) {
        let a = &w.attrs;
        let (color, shininess) = match surface {
            Surface::LeftSide => (a.left_side_color, a.left_side_shininess),
            Surface::RightSide => (a.right_side_color, a.right_side_shininess),
            Surface::Top => (a.top_color, None),
            _ => return Err(no_surface(id, surface)),
        };
        return Ok(Look {
            color,
            texture: texture(&w.textures),
            shininess,
        });
    }
    let mut look = None;
    home.for_each_piece(|p| {
        if p.attrs.id.as_deref() == Some(id) {
            look = Some(Look {
                color: p.attrs.color,
                texture: p.texture.clone(),
                shininess: p.attrs.shininess,
            });
        }
    });
    match look {
        Some(look) if surface == Surface::Piece => Ok(look),
        Some(_) => Err(no_surface(id, surface)),
        None => Err(unknown(id)),
    }
}

fn put_texture(textures: &mut Vec<Texture>, role: &str, texture: &Option<Texture>) {
    textures.retain(|t| t.role.as_deref() != Some(role));
    if let Some(t) = texture {
        textures.push(Texture {
            role: Some(role.to_owned()),
            ..t.clone()
        });
    }
}

fn set_look(
    doc: &mut Document,
    id: &str,
    surface: Surface,
    look: &Look,
) -> Result<(), CommandError> {
    let home = doc.home_mut();
    if let Some(r) = home
        .rooms
        .iter_mut()
        .find(|r| r.attrs.id.as_deref() == Some(id))
    {
        let a = &mut r.attrs;
        match surface {
            Surface::Floor => {
                a.floor_color = look.color;
                a.floor_shininess = look.shininess;
            }
            Surface::Ceiling => {
                a.ceiling_color = look.color;
                a.ceiling_shininess = look.shininess;
            }
            _ => return Err(no_surface(id, surface)),
        }
        put_texture(&mut r.textures, surface.role(), &look.texture);
        return Ok(());
    }
    if let Some(w) = home.walls.iter_mut().find(|w| w.attrs.id == id) {
        let a = &mut w.attrs;
        match surface {
            Surface::LeftSide => {
                a.left_side_color = look.color;
                a.left_side_shininess = look.shininess;
            }
            Surface::RightSide => {
                a.right_side_color = look.color;
                a.right_side_shininess = look.shininess;
            }
            Surface::Top => a.top_color = look.color,
            _ => return Err(no_surface(id, surface)),
        }
        put_texture(&mut w.textures, surface.role(), &look.texture);
        return Ok(());
    }
    let piece = super::furniture::find_piece_mut(doc, id).map_err(|_| unknown(id))?;
    if surface != Surface::Piece {
        return Err(no_surface(id, surface));
    }
    // Sweet Home 3D writes the texture of a piece without a role; color and texture of the
    // whole piece exclude each other
    piece.texture = look.texture.clone().map(|t| Texture { role: None, ..t });
    piece.attrs.color = if piece.texture.is_some() {
        None
    } else {
        look.color
    };
    piece.attrs.shininess = look.shininess;
    Ok(())
}

#[derive(Deserialize, JsonSchema)]
struct CopyParams {
    /// Room, wall or piece of furniture the look is taken from
    from_id: String,
    /// Surface the look is taken from: floor or ceiling of a room, left_side, right_side or
    /// top of a wall, piece for furniture
    from_surface: Surface,
    /// Element that gets the look (or use `ids`)
    id: Option<String>,
    ids: Option<Vec<String>>,
    /// Surface that gets the look. Default: the floor of a room, both sides of a wall, the
    /// whole piece
    surface: Option<Surface>,
}

#[derive(Deserialize, JsonSchema)]
struct ApplyParams {
    /// Room, wall or piece of furniture (or use `ids`)
    id: Option<String>,
    ids: Option<Vec<String>>,
    /// Catalog ID of the texture (see catalog_search with kind "textures"), "" to remove it
    texture: String,
    /// Surface that gets the texture. Default: the floor of a room, both sides of a wall, the
    /// whole piece
    surface: Option<Surface>,
}

#[derive(Deserialize, JsonSchema)]
struct AdjustParams {
    /// Room, wall or piece of furniture (or use `ids`)
    id: Option<String>,
    ids: Option<Vec<String>>,
    /// Surface with the texture: floor, ceiling, left_side, right_side, top or piece
    surface: Surface,
    /// Rotation of the texture in degrees
    angle_deg: Option<f32>,
    /// Size factor of the texture (1 = the size of the catalog, 2 = twice as large)
    scale: Option<f32>,
    /// Shift of the texture along its width, as a share of the width from 0 to 1
    x_offset: Option<f32>,
    /// Shift of the texture along its height, as a share of the height from 0 to 1
    y_offset: Option<f32>,
}

#[derive(Deserialize, JsonSchema)]
struct RoomParams {
    /// Room
    id: String,
}

#[derive(Deserialize, JsonSchema)]
struct RoomWallsParams {
    /// Room whose walls change (or use `ids`)
    id: Option<String>,
    ids: Option<Vec<String>>,
    /// Color of the wall sides facing the room as #RRGGBB, "" for the default color
    color: Option<String>,
    /// Catalog ID of a texture for the wall sides facing the room, "" to remove it
    texture: Option<String>,
    /// Shininess from 0 (matt) to 1; a negative value restores the default (matt)
    shininess: Option<f32>,
    /// Baseboard of the wall sides facing the room
    baseboard: Option<BaseboardParams>,
}

/// Distance in cm from a wall side at which a point is tested to lie in a room.
const SIDE_PROBE: f32 = 2.0;

/// Whether the side line `line` of a wall (with the opposite side `other`) faces the room.
fn faces(line: &[Pt], other: &[Pt], room: &[Pt]) -> bool {
    if line.len() != other.len() {
        return false;
    }
    let lerp = |a: Pt, b: Pt, t: f32| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for i in 0..line.len().saturating_sub(1) {
        for t in [0.1, 0.3, 0.5, 0.7, 0.9] {
            let p = lerp(line[i], line[i + 1], t);
            let q = lerp(other[i], other[i + 1], t);
            let (dx, dy) = (p[0] - q[0], p[1] - q[1]);
            let len = dx.hypot(dy);
            if len < 1e-3 {
                continue;
            }
            let probe = [p[0] + dx / len * SIDE_PROBE, p[1] + dy / len * SIDE_PROBE];
            if msh_geometry::point_in_polygon(probe, room) {
                return true;
            }
        }
    }
    false
}

/// Wall sides that face a room: the walls of its level with a side along the room's outline
/// or inside it. A wall longer than the room counts with its whole side.
fn room_walls(home: &Home, room_id: &str) -> Result<Vec<(String, Surface)>, CommandError> {
    let room = home
        .rooms
        .iter()
        .find(|r| r.attrs.id.as_deref() == Some(room_id))
        .ok_or_else(|| CommandError::failed(format!("unknown room '{room_id}'")))?;
    let polygon: Vec<Pt> = room.points.iter().map(|p| [p.x, p.y]).collect();
    let shapes = msh_geometry::wall_shapes(home);
    let mut out = Vec::new();
    for (wall, shape) in home.walls.iter().zip(&shapes) {
        if wall.attrs.level != room.attrs.level {
            continue;
        }
        for (side, line, other) in [
            (Surface::LeftSide, &shape.left, &shape.right),
            (Surface::RightSide, &shape.right, &shape.left),
        ] {
            if faces(line, other, &polygon) {
                out.push((wall.attrs.id.clone(), side));
            }
        }
    }
    Ok(out)
}

fn sides_json(sides: &[(String, Surface)]) -> serde_json::Value {
    sides
        .iter()
        .map(|(id, side)| {
            json!({ "id": id, "side": if *side == Surface::LeftSide { "left" } else { "right" } })
        })
        .collect()
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "surface_copy",
        "Gives rooms, walls or furniture the look (color, texture with its rotation and size, \
         shininess) of a surface of another element, like a pipette: e.g. the floor of one room \
         for the floor of others, or a wall side for a piece of furniture.",
        true,
        |doc, p: CopyParams| {
            let look = get_look(doc.home(), &p.from_id, p.from_surface)?;
            let targets = target_ids(p.id.clone(), p.ids.clone())?;
            for id in &targets {
                let surfaces = match p.surface {
                    Some(s) => vec![s],
                    None => default_surfaces(doc.home(), id)?,
                };
                for surface in surfaces {
                    set_look(doc, id, surface, &look)?;
                }
            }
            Ok(updated(&targets))
        },
    );
    r.add(
        "texture_apply",
        "Gives rooms, walls and furniture a catalog texture in one step: the floor of rooms, \
         both sides of walls and whole pieces, or the named surface. Colors and shininess stay \
         (a piece has either a color or a texture).",
        true,
        |doc, p: ApplyParams| {
            let texture = texture_for(doc, Some(p.texture.as_str()).filter(|t| !t.is_empty()), "")?;
            let targets = target_ids(p.id.clone(), p.ids.clone())?;
            for id in &targets {
                let surfaces = match p.surface {
                    Some(s) => vec![s],
                    None => default_surfaces(doc.home(), id)?,
                };
                for surface in surfaces {
                    let mut look = get_look(doc.home(), id, surface)?;
                    look.texture = texture.clone();
                    set_look(doc, id, surface, &look)?;
                }
            }
            Ok(updated(&targets))
        },
    );
    r.add(
        "texture_adjust",
        "Rotates, resizes or shifts the texture of a surface of rooms, walls or furniture (e.g. \
         parquet turned by 90 degrees, larger tiles). The surface must have a texture.",
        true,
        |doc, p: AdjustParams| {
            let values = [p.angle_deg, p.scale, p.x_offset, p.y_offset];
            if values.iter().flatten().any(|v| !v.is_finite()) {
                return Err(CommandError::failed("the values must be numbers"));
            }
            if p.scale.is_some_and(|v| v <= 0.0) {
                return Err(CommandError::failed("scale must be positive"));
            }
            let targets = target_ids(p.id.clone(), p.ids.clone())?;
            for id in &targets {
                let mut look = get_look(doc.home(), id, p.surface)?;
                let Some(t) = &mut look.texture else {
                    return Err(CommandError::failed(format!(
                        "'{id}' has no texture on '{}'",
                        p.surface.name()
                    )));
                };
                if let Some(v) = p.angle_deg {
                    t.angle = Some(rad(v.rem_euclid(360.0))).filter(|v| *v != 0.0);
                }
                if let Some(v) = p.scale {
                    t.scale = Some(v).filter(|v| *v != 1.0);
                }
                if let Some(v) = p.x_offset {
                    t.x_offset = Some(v.rem_euclid(1.0)).filter(|v| *v != 0.0);
                }
                if let Some(v) = p.y_offset {
                    t.y_offset = Some(v.rem_euclid(1.0)).filter(|v| *v != 0.0);
                }
                set_look(doc, id, p.surface, &look)?;
            }
            Ok(updated(&targets))
        },
    );
    r.add(
        "room_walls",
        "Lists the wall sides that face a room (wall ID and side, left or right when walking \
         from the start of the wall to its end).",
        false,
        |doc, p: RoomParams| Ok(json!({ "walls": sides_json(&room_walls(doc.home(), &p.id)?) })),
    );
    r.add(
        "room_walls_update",
        "Changes color, texture, shininess or baseboard of all wall sides that face a room (or \
         several rooms), whatever the drawing direction of each wall. A wall longer than the \
         room changes on its whole side.",
        true,
        |doc, p: RoomWallsParams| {
            let texture = texture_for(doc, non_empty(&p.texture), "")?;
            let baseboard_texture = match &p.baseboard {
                Some(b) => texture_for(doc, non_empty(&b.texture), "baseboardTexture")?,
                None => None,
            };
            let color = p.color.as_deref().map(optional_color).transpose()?;
            let shininess = p.shininess.map(optional_shininess).transpose()?;
            let mut sides: Vec<(String, Surface)> = Vec::new();
            for room in target_ids(p.id.clone(), p.ids.clone())? {
                for side in room_walls(doc.home(), &room)? {
                    if !sides.contains(&side) {
                        sides.push(side);
                    }
                }
            }
            if sides.is_empty() {
                return Err(CommandError::failed("no wall faces the room"));
            }
            for (id, side) in &sides {
                let Some(w) = doc.home_mut().walls.iter_mut().find(|w| &w.attrs.id == id) else {
                    continue;
                };
                let left = *side == Surface::LeftSide;
                let a = &mut w.attrs;
                if let Some(c) = color {
                    *(if left {
                        &mut a.left_side_color
                    } else {
                        &mut a.right_side_color
                    }) = c;
                }
                if let Some(s) = shininess {
                    *(if left {
                        &mut a.left_side_shininess
                    } else {
                        &mut a.right_side_shininess
                    }) = s;
                }
                if p.texture.is_some() {
                    put_texture(&mut w.textures, side.role(), &texture);
                }
                if let Some(b) = &p.baseboard {
                    let role = if left {
                        "leftSideBaseboard"
                    } else {
                        "rightSideBaseboard"
                    };
                    update_baseboard(w, role, b, baseboard_texture.clone())?;
                }
            }
            Ok(json!({ "walls": sides_json(&sides) }))
        },
    );
}
