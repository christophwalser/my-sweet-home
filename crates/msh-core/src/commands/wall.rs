//! Wall commands.

use super::{new_id, non_empty, optional_color, rad, resolve_level, target_ids, updated};
use crate::catalog::{CatalogIndex, embed_texture};
use crate::document::Document;
use crate::registry::{CommandError, Registry};
use msh_model::{Baseboard, BaseboardAttrs, Texture, Wall, WallAttrs};
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
    /// Arc extent in degrees of every wall of the path, for round walls
    arc_extent_deg: Option<f32>,
    /// Plan pattern (default hatchUp), see wall_update
    pattern: Option<String>,
    /// Colors of the sides as #RRGGBB
    left_side_color: Option<String>,
    right_side_color: Option<String>,
    level: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateParams {
    /// Wall to change (or use `ids`)
    id: Option<String>,
    /// Several walls that get the same values (one undo step)
    ids: Option<Vec<String>>,
    x_start: Option<f32>,
    y_start: Option<f32>,
    x_end: Option<f32>,
    y_end: Option<f32>,
    thickness: Option<f32>,
    height: Option<f32>,
    height_at_end: Option<f32>,
    arc_extent_deg: Option<f32>,
    /// Color of the left side as #RRGGBB (left = left when walking from start to end),
    /// "" for the default color
    left_side_color: Option<String>,
    right_side_color: Option<String>,
    /// Catalog ID of a texture for the left side (see catalog_search with kind "textures"),
    /// "" to remove the texture
    left_side_texture: Option<String>,
    right_side_texture: Option<String>,
    /// Baseboard on the left side
    left_side_baseboard: Option<BaseboardParams>,
    right_side_baseboard: Option<BaseboardParams>,
    /// Plan pattern: hatchUp, hatchDown, crossHatch, background, foreground, reversedHatchUp,
    /// reversedHatchDown
    pattern: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct BaseboardParams {
    /// Height in cm (default 7); 0 removes the baseboard
    height: Option<f32>,
    /// Thickness in cm (default 1)
    thickness: Option<f32>,
    /// Color as #RRGGBB, "" for the wall side color
    color: Option<String>,
    /// Catalog ID of a texture, "" to remove it
    texture: Option<String>,
}

/// Default size of new baseboards in cm (like the Sweet Home 3D preferences).
const DEFAULT_BASEBOARD_HEIGHT: f32 = 7.0;
const DEFAULT_BASEBOARD_THICKNESS: f32 = 1.0;

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
            let left_color = p
                .left_side_color
                .as_deref()
                .map(optional_color)
                .transpose()?;
            let right_color = p
                .right_side_color
                .as_deref()
                .map(optional_color)
                .transpose()?;
            let ids: Vec<String> = (0..n).map(|_| new_id("wall")).collect();
            let home = doc.home_mut();
            for i in 0..n {
                let start = p.points[i];
                let end = p.points[(i + 1) % p.points.len()];
                let mut w = new_wall(&ids[i], start, end, p.thickness, p.height, level.clone());
                w.attrs.arc_extent = p.arc_extent_deg.filter(|v| *v != 0.0).map(rad);
                if let Some(pattern) = &p.pattern {
                    w.attrs.pattern = Some(pattern.clone());
                }
                w.attrs.left_side_color = left_color.flatten();
                w.attrs.right_side_color = right_color.flatten();
                if i > 0 || closed {
                    w.attrs.wall_at_start = Some(ids[(i + n - 1) % n].clone());
                }
                if i + 1 < n || closed {
                    w.attrs.wall_at_end = Some(ids[(i + 1) % n].clone());
                }
                home.walls.push(w);
            }
            if !closed {
                let first = p.points[0];
                let last = p.points[p.points.len() - 1];
                join_free_end(home, &ids[0], first, true, &level);
                join_free_end(home, &ids[n - 1], last, false, &level);
            }
            Ok(json!({ "ids": ids }))
        },
    );
    r.add(
        "wall_update",
        "Changes coordinates, thickness, height, colors, textures, baseboards or pattern of a \
         wall (or of several walls with ids; coordinates only for one wall). Joined walls keep their connection: when an end point moves, the touching end \
         of the joined wall moves along.",
        true,
        |doc, p: UpdateParams| {
            let left_tex = texture_for(doc, non_empty(&p.left_side_texture), "leftSideTexture")?;
            let right_tex = texture_for(doc, non_empty(&p.right_side_texture), "rightSideTexture")?;
            let mut baseboard_tex = Vec::new();
            for b in [&p.left_side_baseboard, &p.right_side_baseboard] {
                let tex = match b {
                    Some(b) => texture_for(doc, non_empty(&b.texture), "baseboardTexture")?,
                    None => None,
                };
                baseboard_tex.push(tex);
            }
            let targets = target_ids(p.id.clone(), p.ids.clone())?;
            if targets.len() > 1
                && [p.x_start, p.y_start, p.x_end, p.y_end]
                    .iter()
                    .any(Option::is_some)
            {
                return Err(CommandError::failed(
                    "coordinates can only be changed for one wall at a time",
                ));
            }
            let home = doc.home_mut();
            // Doors and windows follow a new wall thickness
            let old_thickness: Vec<(String, f32)> = if p.thickness.is_some() {
                home.walls
                    .iter()
                    .filter(|w| targets.contains(&w.attrs.id))
                    .map(|w| (w.attrs.id.clone(), w.attrs.thickness))
                    .collect()
            } else {
                Vec::new()
            };
            for target in &targets {
            let w = home
                .walls
                .iter_mut()
                .find(|w| &w.attrs.id == target)
                .ok_or_else(|| CommandError::failed(format!("unknown wall '{target}'")))?;
            let a = &mut w.attrs;
            let old_start = (a.x_start, a.y_start);
            let old_end = (a.x_end, a.y_end);
            macro_rules! set {
                ($($f:ident),*) => { $( if let Some(v) = p.$f { a.$f = v; } )* };
            }
            set!(x_start, y_start, x_end, y_end, thickness);
            if a.thickness <= 0.0 {
                return Err(CommandError::failed("thickness must be positive"));
            }
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
                a.left_side_color = optional_color(c)?;
            }
            if let Some(c) = &p.right_side_color {
                a.right_side_color = optional_color(c)?;
            }
            if let Some(v) = &p.pattern {
                a.pattern = Some(v.clone());
            }
            for (role, tex, param) in [
                ("leftSideTexture", left_tex.clone(), &p.left_side_texture),
                ("rightSideTexture", right_tex.clone(), &p.right_side_texture),
            ] {
                if param.is_some() {
                    w.textures.retain(|t| t.role.as_deref() != Some(role));
                }
                w.textures.extend(tex);
            }
            for ((role, tex), params) in ["leftSideBaseboard", "rightSideBaseboard"]
                .into_iter()
                .zip(baseboard_tex.iter().cloned())
                .zip([&p.left_side_baseboard, &p.right_side_baseboard])
            {
                if let Some(b) = params {
                    update_baseboard(w, role, b, tex)?;
                }
            }
            let id = w.attrs.id.clone();
            let new_start = (w.attrs.x_start, w.attrs.y_start);
            let new_end = (w.attrs.x_end, w.attrs.y_end);
            let at_start = w.attrs.wall_at_start.clone();
            let at_end = w.attrs.wall_at_end.clone();
            // Joined walls follow moved end points
            for (joined, old, new) in [
                (at_start.clone(), old_start, new_start),
                (at_end.clone(), old_end, new_end),
            ] {
                let Some(joined) = joined else { continue };
                if old == new {
                    continue;
                }
                if let Some(j) = home.walls.iter_mut().find(|w| w.attrs.id == joined) {
                    move_joined_end(&mut j.attrs, &id, old, new);
                }
            }
            // A free end moved onto a free end of another wall gets joined to it
            let level = home
                .walls
                .iter()
                .find(|w| w.attrs.id == id)
                .and_then(|w| w.attrs.level.clone());
            for (joined, at_start, old, new) in [
                (&at_start, true, old_start, new_start),
                (&at_end, false, old_end, new_end),
            ] {
                if joined.is_none() && old != new {
                    join_free_end(home, &id, [new.0, new.1], at_start, &level);
                }
            }
            }
            super::furniture::refit_openings(home, &old_thickness);
            Ok(updated(&targets))
        },
    );
}

/// Joins the start (or end) of the new wall `id` at `point` to an existing wall on
/// `level` that has a free end at the same point, like Sweet Home 3D does when a
/// wall is drawn from the end of another one.
fn join_free_end(
    home: &mut msh_model::Home,
    id: &str,
    point: [f32; 2],
    at_start: bool,
    level: &Option<String>,
) {
    const TOLERANCE: f32 = 0.01;
    let near =
        |x: f32, y: f32| (x - point[0]).abs() < TOLERANCE && (y - point[1]).abs() < TOLERANCE;
    let Some(other) = home.walls.iter_mut().find(|w| {
        let a = &w.attrs;
        a.id != id
            && &a.level == level
            && a.arc_extent.is_none_or(|e| e.abs() < 1e-4)
            && ((a.wall_at_end.is_none() && near(a.x_end, a.y_end))
                || (a.wall_at_start.is_none() && near(a.x_start, a.y_start)))
    }) else {
        return;
    };
    let a = &mut other.attrs;
    if a.wall_at_end.is_none() && near(a.x_end, a.y_end) {
        a.wall_at_end = Some(id.to_owned());
    } else {
        a.wall_at_start = Some(id.to_owned());
    }
    let other_id = a.id.clone();
    if let Some(w) = home.walls.iter_mut().find(|w| w.attrs.id == id) {
        if at_start {
            w.attrs.wall_at_start = Some(other_id);
        } else {
            w.attrs.wall_at_end = Some(other_id);
        }
    }
}

/// Moves the end of `joined` that is connected to the wall `id` from `old` to `new`.
pub(super) fn move_joined_end(joined: &mut WallAttrs, id: &str, old: (f32, f32), new: (f32, f32)) {
    let end_joined = joined.wall_at_end.as_deref() == Some(id);
    let start_joined = joined.wall_at_start.as_deref() == Some(id);
    let start_touches = (joined.x_start, joined.y_start) == old;
    let end_touches = (joined.x_end, joined.y_end) == old;
    // Both ends can be joined to the same wall (two walls forming a closed shape)
    if end_joined && (end_touches || !start_touches || !start_joined) {
        (joined.x_end, joined.y_end) = new;
    } else if start_joined {
        (joined.x_start, joined.y_start) = new;
    }
}

fn update_baseboard(
    w: &mut Wall,
    role: &str,
    p: &BaseboardParams,
    texture: Option<Texture>,
) -> Result<(), CommandError> {
    if p.height == Some(0.0) {
        w.baseboards.retain(|b| b.attrs.role != role);
        return Ok(());
    }
    let index = match w.baseboards.iter().position(|b| b.attrs.role == role) {
        Some(i) => i,
        None => {
            w.baseboards.push(Baseboard {
                attrs: BaseboardAttrs {
                    role: role.to_owned(),
                    thickness: DEFAULT_BASEBOARD_THICKNESS,
                    height: DEFAULT_BASEBOARD_HEIGHT,
                    ..Default::default()
                },
                ..Default::default()
            });
            w.baseboards.len() - 1
        }
    };
    let b = &mut w.baseboards[index];
    if let Some(v) = p.height {
        b.attrs.height = v;
    }
    if let Some(v) = p.thickness {
        if v <= 0.0 {
            return Err(CommandError::failed("baseboard thickness must be positive"));
        }
        b.attrs.thickness = v;
    }
    if let Some(c) = &p.color {
        b.attrs.color = optional_color(c)?;
    }
    if p.texture.is_some() {
        // Sweet Home 3D writes baseboard textures without a role attribute
        b.texture = texture.map(|t| Texture { role: None, ..t });
    }
    Ok(())
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
