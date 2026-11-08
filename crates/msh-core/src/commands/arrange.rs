//! Arranging and restyling elements: reverse wall direction, align and distribute
//! furniture, paste the style of the copied element.

use super::edit::move_elements;
use crate::clipboard::Clipboard;
use crate::registry::{CommandError, Registry};
use msh_model::{Furniture, Home, Wall};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;

#[derive(Deserialize, JsonSchema)]
struct IdsParams {
    /// IDs of the elements
    ids: Vec<String>,
}

#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Align {
    /// Left sides in a line with the leading piece's left side (in its orientation)
    Left,
    /// Right sides in a line with the leading piece's right side
    Right,
    /// Front sides in a line with the leading piece's front
    Front,
    /// Back sides in a line with the leading piece's back
    Back,
    /// Same top height as the leading piece
    Top,
    /// Same elevation as the leading piece
    Bottom,
    /// Side by side along the leading piece's width, without gaps, in their current order
    SideBySide,
}

#[derive(Deserialize, JsonSchema)]
struct AlignParams {
    /// IDs of pieces or groups (at least two)
    ids: Vec<String>,
    how: Align,
    /// Piece the others are aligned to (default: the last of `ids`, the one selected last)
    leader: Option<String>,
}

#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Axis {
    /// Along x (left to right in the plan)
    Horizontal,
    /// Along y (top to bottom in the plan)
    Vertical,
}

#[derive(Deserialize, JsonSchema)]
struct DistributeParams {
    /// IDs of pieces or groups (at least three)
    ids: Vec<String>,
    axis: Axis,
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "wall_reverse",
        "Reverses the direction of walls (start and end swap). Colors, textures and baseboards \
         move to the other side, so the walls look the same.",
        true,
        |doc, p: IdsParams| {
            let ids: HashSet<&str> = p.ids.iter().map(String::as_str).collect();
            let mut n = 0;
            for w in doc
                .home_mut()
                .walls
                .iter_mut()
                .filter(|w| ids.contains(w.attrs.id.as_str()))
            {
                reverse_wall(w);
                n += 1;
            }
            if n == 0 {
                return Err(CommandError::failed(format!(
                    "no wall found for {:?}",
                    p.ids
                )));
            }
            Ok(json!({ "reversed": n }))
        },
    );
    r.add(
        "furniture_align",
        "Aligns pieces of furniture (or groups) to the leading piece: left, right, front or back \
         side (in the leading piece's orientation), top or bottom (elevation), or side by side \
         along its width.",
        true,
        |doc, p: AlignParams| {
            let leader = p
                .leader
                .clone()
                .or_else(|| p.ids.last().cloned())
                .ok_or_else(|| CommandError::failed("give the IDs of at least two pieces"))?;
            let home = doc.home_mut();
            let items: Vec<Item> = p.ids.iter().filter_map(|id| item(home, id)).collect();
            let lead = item(home, &leader)
                .ok_or_else(|| CommandError::failed(format!("no piece '{leader}'")))?;
            if items.iter().filter(|i| i.id != lead.id).count() == 0 {
                return Err(CommandError::failed("give the IDs of at least two pieces"));
            }
            let (ux, uy) = lead.axes();
            let [lx0, lx1, ly0, ly1] = lead.extent(ux, uy);
            match p.how {
                Align::Top | Align::Bottom => {
                    for i in items.iter().filter(|i| i.id != lead.id) {
                        let delta = if p.how == Align::Top {
                            (lead.elevation + lead.height) - (i.elevation + i.height)
                        } else {
                            lead.elevation - i.elevation
                        };
                        raise(home, &i.id, delta);
                    }
                }
                Align::SideBySide => {
                    let mut sorted = items.clone();
                    if !sorted.iter().any(|i| i.id == lead.id) {
                        sorted.push(lead.clone());
                    }
                    sorted.sort_by(|a, b| dot(a.center(), ux).total_cmp(&dot(b.center(), ux)));
                    let mut next = sorted[0].extent(ux, uy)[1];
                    for i in &sorted[1..] {
                        let [x0, x1, _, _] = i.extent(ux, uy);
                        let shift = next - x0;
                        move_elements(
                            home,
                            std::slice::from_ref(&i.id),
                            ux[0] * shift,
                            ux[1] * shift,
                        );
                        next += x1 - x0;
                    }
                }
                _ => {
                    for i in items.iter().filter(|i| i.id != lead.id) {
                        let [x0, x1, y0, y1] = i.extent(ux, uy);
                        let (dir, shift) = match p.how {
                            Align::Left => (ux, lx0 - x0),
                            Align::Right => (ux, lx1 - x1),
                            Align::Back => (uy, ly0 - y0),
                            _ => (uy, ly1 - y1),
                        };
                        move_elements(
                            home,
                            std::slice::from_ref(&i.id),
                            dir[0] * shift,
                            dir[1] * shift,
                        );
                    }
                }
            }
            Ok(json!({ "aligned": items.len(), "leader": lead.id }))
        },
    );
    r.add(
        "furniture_distribute",
        "Distributes pieces of furniture (or groups) evenly along x or y: the outer ones stay, \
         the gaps between all of them become equal.",
        true,
        |doc, p: DistributeParams| {
            let home = doc.home_mut();
            let mut items: Vec<Item> = p.ids.iter().filter_map(|id| item(home, id)).collect();
            if items.len() < 3 {
                return Err(CommandError::failed(
                    "give the IDs of at least three pieces",
                ));
            }
            let axis = if p.axis == Axis::Horizontal {
                [1.0, 0.0]
            } else {
                [0.0, 1.0]
            };
            let other = [axis[1], axis[0]];
            items.sort_by(|a, b| dot(a.center(), axis).total_cmp(&dot(b.center(), axis)));
            let extents: Vec<[f32; 4]> = items.iter().map(|i| i.extent(axis, other)).collect();
            let start = extents[0][0];
            let end = extents[extents.len() - 1][1];
            let total: f32 = extents.iter().map(|e| e[1] - e[0]).sum();
            let gap = (end - start - total) / (items.len() - 1) as f32;
            let mut pos = start;
            for (i, e) in items.iter().zip(&extents) {
                let shift = pos - e[0];
                if shift.abs() > 1e-4 {
                    move_elements(
                        home,
                        std::slice::from_ref(&i.id),
                        axis[0] * shift,
                        axis[1] * shift,
                    );
                }
                pos += e[1] - e[0] + gap;
            }
            Ok(json!({ "distributed": items.len(), "gap": (gap * 10.0).round() / 10.0 }))
        },
    );
    r.add(
        "edit_paste_style",
        "Applies the style of the copied element (see edit_copy) to elements of the same kind: \
         walls (colors, textures, baseboards, pattern, thickness, height), rooms (floor and \
         ceiling, texts), furniture (color, texture, materials of the same model), lines, \
         dimensions and labels (colors, text style).",
        true,
        |doc, p: IdsParams| {
            let clip = doc.clipboard.clone().ok_or_else(|| {
                CommandError::failed("the clipboard is empty: copy an element first")
            })?;
            // Textures of the copied element come into this home first
            let clip = clip.merged_into(doc);
            let n = paste_style(doc.home_mut(), &clip, &p.ids);
            if n == 0 {
                return Err(CommandError::failed(
                    "no element of the same kind as the copied one among the given IDs",
                ));
            }
            Ok(json!({ "styled": n }))
        },
    );
}

// ---------------------------------------------------------------- walls

/// Reverses a wall; its look stays the same (sides, heights and arc follow).
fn reverse_wall(w: &mut Wall) {
    let a = &mut w.attrs;
    std::mem::swap(&mut a.x_start, &mut a.x_end);
    std::mem::swap(&mut a.y_start, &mut a.y_end);
    std::mem::swap(&mut a.wall_at_start, &mut a.wall_at_end);
    if let Some(end) = a.height_at_end {
        let start = a.height.unwrap_or(end);
        a.height = Some(end);
        a.height_at_end = Some(start);
    }
    // The arc bulges to the same side when seen from the other end with the opposite extent
    a.arc_extent = a.arc_extent.map(|e| -e);
    std::mem::swap(&mut a.left_side_color, &mut a.right_side_color);
    std::mem::swap(&mut a.left_side_shininess, &mut a.right_side_shininess);
    let swap_side = |role: &str| match role {
        "leftSideTexture" => "rightSideTexture".to_string(),
        "rightSideTexture" => "leftSideTexture".to_string(),
        "leftSideBaseboard" => "rightSideBaseboard".to_string(),
        "rightSideBaseboard" => "leftSideBaseboard".to_string(),
        other => other.to_string(),
    };
    for t in &mut w.textures {
        t.role = t.role.as_deref().map(swap_side);
    }
    for b in &mut w.baseboards {
        b.attrs.role = swap_side(&b.attrs.role);
    }
}

// ---------------------------------------------------------------- furniture geometry

/// A piece or group as a rotated rectangle in the plan.
#[derive(Clone)]
struct Item {
    id: String,
    x: f32,
    y: f32,
    width: f32,
    depth: f32,
    angle: f32,
    elevation: f32,
    height: f32,
}

fn dot(p: [f32; 2], u: [f32; 2]) -> f32 {
    p[0] * u[0] + p[1] * u[1]
}

impl Item {
    fn center(&self) -> [f32; 2] {
        [self.x, self.y]
    }

    /// Width and depth directions of the piece in the plan (y down, angles clockwise).
    fn axes(&self) -> ([f32; 2], [f32; 2]) {
        let (s, c) = self.angle.sin_cos();
        ([c, s], [-s, c])
    }

    /// Extent along `u` and `v`: [min u, max u, min v, max v].
    fn extent(&self, u: [f32; 2], v: [f32; 2]) -> [f32; 4] {
        let (ax, ay) = self.axes();
        let (hw, hd) = (self.width / 2.0, self.depth / 2.0);
        let mut e = [f32::MAX, f32::MIN, f32::MAX, f32::MIN];
        for (sx, sy) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
            let p = [
                self.x + ax[0] * hw * sx + ay[0] * hd * sy,
                self.y + ax[1] * hw * sx + ay[1] * hd * sy,
            ];
            let (pu, pv) = (dot(p, u), dot(p, v));
            e = [e[0].min(pu), e[1].max(pu), e[2].min(pv), e[3].max(pv)];
        }
        e
    }
}

/// The top-level piece or group with this ID.
fn item(home: &Home, id: &str) -> Option<Item> {
    home.furniture.iter().find_map(|f| match f {
        Furniture::Piece(p) if p.attrs.id.as_deref() == Some(id) => {
            let a = &p.attrs;
            Some(Item {
                id: id.to_string(),
                x: a.x,
                y: a.y,
                width: a.width_in_plan.unwrap_or(a.width),
                depth: a.depth_in_plan.unwrap_or(a.depth),
                angle: a.angle_or_default(),
                elevation: a.elevation_or_default(),
                height: a.height_in_plan.unwrap_or(a.height),
            })
        }
        Furniture::Group(g) if g.attrs.id.as_deref() == Some(id) => {
            let a = &g.attrs;
            Some(Item {
                id: id.to_string(),
                x: a.x?,
                y: a.y?,
                width: a.width?,
                depth: a.depth?,
                angle: a.angle.unwrap_or(0.0),
                elevation: a.elevation.unwrap_or(0.0),
                height: a.height?,
            })
        }
        _ => None,
    })
}

/// Raises a top-level piece or group (and the pieces of a group) by `delta` cm.
fn raise(home: &mut Home, id: &str, delta: f32) {
    fn shift(item: &mut Furniture, delta: f32) {
        match item {
            Furniture::Piece(p) => {
                p.attrs.elevation = Some((p.attrs.elevation_or_default() + delta).max(0.0));
            }
            Furniture::Group(g) => {
                g.attrs.elevation = Some((g.attrs.elevation.unwrap_or(0.0) + delta).max(0.0));
                g.items.iter_mut().for_each(|c| shift(c, delta));
            }
        }
    }
    for f in &mut home.furniture {
        let fid = match f {
            Furniture::Piece(p) => p.attrs.id.as_deref(),
            Furniture::Group(g) => g.attrs.id.as_deref(),
        };
        if fid == Some(id) {
            shift(f, delta);
        }
    }
}

// ---------------------------------------------------------------- paste style

fn paste_style(home: &mut Home, clip: &Clipboard, ids: &[String]) -> usize {
    let ids: HashSet<&str> = ids.iter().map(String::as_str).collect();
    let has = |id: &Option<String>| id.as_deref().is_some_and(|i| ids.contains(i));
    let mut n = 0;
    if let Some(src) = clip.walls.first() {
        for w in home
            .walls
            .iter_mut()
            .filter(|w| ids.contains(w.attrs.id.as_str()))
        {
            let (s, a) = (&src.attrs, &mut w.attrs);
            a.left_side_color = s.left_side_color;
            a.left_side_shininess = s.left_side_shininess;
            a.right_side_color = s.right_side_color;
            a.right_side_shininess = s.right_side_shininess;
            a.top_color = s.top_color;
            a.pattern = s.pattern.clone();
            a.thickness = s.thickness;
            a.height = s.height;
            a.height_at_end = s.height_at_end;
            w.textures = src.textures.clone();
            w.baseboards = src.baseboards.clone();
            n += 1;
        }
    }
    if let Some(src) = clip.rooms.first() {
        for r in home.rooms.iter_mut().filter(|r| has(&r.attrs.id)) {
            let (s, a) = (&src.attrs, &mut r.attrs);
            a.floor_visible = s.floor_visible;
            a.floor_color = s.floor_color;
            a.floor_shininess = s.floor_shininess;
            a.ceiling_visible = s.ceiling_visible;
            a.ceiling_color = s.ceiling_color;
            a.ceiling_shininess = s.ceiling_shininess;
            a.area_visible = s.area_visible;
            r.textures = src.textures.clone();
            r.text_styles = src.text_styles.clone();
            n += 1;
        }
    }
    let src_piece = clip.furniture.iter().find_map(|f| match f {
        Furniture::Piece(p) => Some(p.as_ref().clone()),
        Furniture::Group(_) => None,
    });
    if let Some(src) = src_piece {
        fn walk(
            items: &mut [Furniture],
            has: &dyn Fn(&Option<String>) -> bool,
            src: &msh_model::Piece,
        ) -> usize {
            let mut n = 0;
            for item in items {
                match item {
                    Furniture::Piece(p) if has(&p.attrs.id) => {
                        p.attrs.color = src.attrs.color;
                        p.attrs.shininess = src.attrs.shininess;
                        p.texture = src.texture.clone();
                        // Materials belong to a model: only for the same model
                        p.materials = if p.attrs.model == src.attrs.model {
                            src.materials.clone()
                        } else {
                            Vec::new()
                        };
                        n += 1;
                    }
                    Furniture::Group(g) => n += walk(&mut g.items, has, src),
                    Furniture::Piece(_) => {}
                }
            }
            n
        }
        n += walk(&mut home.furniture, &has, &src);
    }
    if let Some(src) = clip.polylines.first() {
        for pl in home.polylines.iter_mut().filter(|p| has(&p.attrs.id)) {
            let (s, a) = (&src.attrs, &mut pl.attrs);
            a.thickness = s.thickness;
            a.cap_style = s.cap_style.clone();
            a.join_style = s.join_style.clone();
            a.dash_style = s.dash_style.clone();
            a.dash_pattern = s.dash_pattern.clone();
            a.dash_offset = s.dash_offset;
            a.start_arrow_style = s.start_arrow_style.clone();
            a.end_arrow_style = s.end_arrow_style.clone();
            a.color = s.color;
            n += 1;
        }
    }
    if let Some(src) = clip.dimension_lines.first() {
        for d in home.dimension_lines.iter_mut().filter(|d| has(&d.attrs.id)) {
            d.attrs.color = src.attrs.color;
            d.attrs.end_mark_size = src.attrs.end_mark_size;
            d.text_style = src.text_style.clone();
            n += 1;
        }
    }
    if let Some(src) = clip.labels.first() {
        for l in home.labels.iter_mut().filter(|l| has(&l.attrs.id)) {
            l.attrs.color = src.attrs.color;
            l.attrs.outline_color = src.attrs.outline_color;
            l.text_style = src.text_style.clone();
            n += 1;
        }
    }
    n
}
