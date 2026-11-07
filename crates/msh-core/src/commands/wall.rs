//! Wall commands.

use super::{new_id, parse_color, rad, resolve_level};
use crate::catalog::{CatalogIndex, embed_texture};
use crate::document::Document;
use crate::registry::{CommandError, Registry};
use msh_model::{Texture, Wall, WallAttrs};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;

/// Thickness of new walls in cm if not given.
const DEFAULT_THICKNESS: f32 = 10.0;

#[derive(Deserialize, JsonSchema)]
struct AddParams {
    x_start: f32,
    y_start: f32,
    x_end: f32,
    y_end: f32,
    /// Thickness in cm (default 10)
    thickness: Option<f32>,
    /// Height in cm at the start (default: home wall height)
    height: Option<f32>,
    /// Height in cm at the end, for sloping walls
    height_at_end: Option<f32>,
    /// Arc extent in degrees for round walls (positive or negative)
    arc_extent_deg: Option<f32>,
    level: Option<String>,
    /// ID of a wall whose end touches the start of this wall (joins them with a mitered corner)
    join_at_start: Option<String>,
    /// ID of a wall whose start touches the end of this wall
    join_at_end: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct PathParams {
    /// Points of the wall path as [[x, y], ...] in cm; one wall per segment
    points: Vec<[f32; 2]>,
    /// Close the path (last point connects to the first), e.g. for the outline of a house
    closed: Option<bool>,
    /// Thickness in cm (default 10)
    thickness: Option<f32>,
    /// Height in cm (default: home wall height)
    height: Option<f32>,
    level: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateParams {
    id: String,
    x_start: Option<f32>,
    y_start: Option<f32>,
    x_end: Option<f32>,
    y_end: Option<f32>,
    thickness: Option<f32>,
    height: Option<f32>,
    height_at_end: Option<f32>,
    arc_extent_deg: Option<f32>,
    /// Color of the left side as #RRGGBB (left = left when walking from start to end)
    left_side_color: Option<String>,
    right_side_color: Option<String>,
    /// Catalog ID of a texture for the left side (see catalog_search with kind "textures")
    left_side_texture: Option<String>,
    right_side_texture: Option<String>,
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "wall_add",
        "Adds a single wall from (x_start, y_start) to (x_end, y_end). For connected walls prefer \
         wall_add_path, which joins the corners automatically.",
        true,
        |doc, p: AddParams| {
            let level = resolve_level(doc.home(), p.level)?;
            let home = doc.home_mut();
            for id in [&p.join_at_start, &p.join_at_end].into_iter().flatten() {
                if !home.walls.iter().any(|w| &w.attrs.id == id) {
                    return Err(CommandError::failed(format!("unknown wall '{id}'")));
                }
            }
            let id = new_id("wall");
            let mut wall = new_wall(
                &id,
                [p.x_start, p.y_start],
                [p.x_end, p.y_end],
                p.thickness,
                p.height,
                level,
            );
            wall.attrs.height_at_end = p.height_at_end;
            wall.attrs.arc_extent = p.arc_extent_deg.map(rad);
            wall.attrs.wall_at_start = p.join_at_start.clone();
            wall.attrs.wall_at_end = p.join_at_end.clone();
            for w in &mut home.walls {
                if Some(&w.attrs.id) == p.join_at_start.as_ref() {
                    w.attrs.wall_at_end = Some(id.clone());
                }
                if Some(&w.attrs.id) == p.join_at_end.as_ref() {
                    w.attrs.wall_at_start = Some(id.clone());
                }
            }
            home.walls.push(wall);
            Ok(json!({ "id": id }))
        },
    );
    r.add(
        "wall_add_path",
        "Adds connected walls along a path of points with mitered corners. Use closed=true for a \
         closed outline (e.g. the exterior walls of a house). Returns the wall IDs in order.",
        true,
        |doc, p: PathParams| {
            if p.points.len() < 2 {
                return Err(CommandError::failed("a wall path needs at least 2 points"));
            }
            let level = resolve_level(doc.home(), p.level)?;
            let closed = p.closed.unwrap_or(false) && p.points.len() >= 3;
            let n = if closed {
                p.points.len()
            } else {
                p.points.len() - 1
            };
            let ids: Vec<String> = (0..n).map(|_| new_id("wall")).collect();
            let home = doc.home_mut();
            for i in 0..n {
                let start = p.points[i];
                let end = p.points[(i + 1) % p.points.len()];
                let mut w = new_wall(&ids[i], start, end, p.thickness, p.height, level.clone());
                if i > 0 || closed {
                    w.attrs.wall_at_start = Some(ids[(i + n - 1) % n].clone());
                }
                if i + 1 < n || closed {
                    w.attrs.wall_at_end = Some(ids[(i + 1) % n].clone());
                }
                home.walls.push(w);
            }
            Ok(json!({ "ids": ids }))
        },
    );
    r.add(
        "wall_update",
        "Changes coordinates, thickness, height, colors or textures of a wall.",
        true,
        |doc, p: UpdateParams| {
            let left_tex = texture_for(doc, p.left_side_texture.as_deref(), "leftSideTexture")?;
            let right_tex = texture_for(doc, p.right_side_texture.as_deref(), "rightSideTexture")?;
            let w = doc
                .home_mut()
                .walls
                .iter_mut()
                .find(|w| w.attrs.id == p.id)
                .ok_or_else(|| CommandError::failed(format!("unknown wall '{}'", p.id)))?;
            let a = &mut w.attrs;
            macro_rules! set {
                ($($f:ident),*) => { $( if let Some(v) = p.$f { a.$f = v; } )* };
            }
            set!(x_start, y_start, x_end, y_end, thickness);
            if let Some(v) = p.height {
                a.height = Some(v);
            }
            if let Some(v) = p.height_at_end {
                a.height_at_end = Some(v);
            }
            if let Some(v) = p.arc_extent_deg {
                a.arc_extent = (v != 0.0).then(|| rad(v));
            }
            if let Some(c) = &p.left_side_color {
                a.left_side_color = Some(parse_color(c)?);
            }
            if let Some(c) = &p.right_side_color {
                a.right_side_color = Some(parse_color(c)?);
            }
            for tex in [left_tex, right_tex].into_iter().flatten() {
                w.textures.retain(|t| t.role != tex.role);
                w.textures.push(tex);
            }
            Ok(json!({ "id": p.id }))
        },
    );
}

pub(super) fn new_wall(
    id: &str,
    start: [f32; 2],
    end: [f32; 2],
    thickness: Option<f32>,
    height: Option<f32>,
    level: Option<String>,
) -> Wall {
    Wall {
        attrs: WallAttrs {
            id: id.to_owned(),
            level,
            x_start: start[0],
            y_start: start[1],
            x_end: end[0],
            y_end: end[1],
            thickness: thickness.unwrap_or(DEFAULT_THICKNESS),
            height,
            pattern: Some("hatchUp".into()),
            ..Default::default()
        },
        ..Default::default()
    }
}

/// Embeds a catalog texture and returns it with the given role.
pub(super) fn texture_for(
    doc: &mut Document,
    catalog_id: Option<&str>,
    role: &str,
) -> Result<Option<Texture>, CommandError> {
    let Some(id) = catalog_id else {
        return Ok(None);
    };
    let entry = CatalogIndex::get()
        .texture_by_id(id)
        .ok_or_else(|| CommandError::failed(format!("unknown texture '{id}'")))?
        .clone();
    let image = embed_texture(doc, &entry)?;
    Ok(Some(Texture {
        role: Some(role.to_owned()),
        catalog_id: entry.item.id.clone(),
        name: entry.item.name.clone(),
        creator: entry.item.creator.clone(),
        width: entry.item.width,
        height: entry.item.height,
        image,
        ..Default::default()
    }))
}
