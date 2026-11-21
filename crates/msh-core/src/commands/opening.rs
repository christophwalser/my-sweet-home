//! Floor openings: a hole in the floor of a level and in the ceiling below it, for a gallery,
//! an open space over two levels or a shaft. The file format has no openings, but staircases
//! cut holes: an opening is a staircase piece that reaches from just below the floor up to
//! it, with a cut-out of its outline. Its model is the edge of the hole.

use super::furniture::{find_piece_mut, set_property};
use super::generated::{
    ModelPart, ModelTriangle, bounds, checked_points, frame, limited, property_data, round,
    store_model,
};
use super::{new_id, resolve_level};
use crate::Document;
use crate::registry::{CommandError, Registry};
use msh_geometry::roof::P2;
use msh_model::{Furniture, Home, Piece, PieceAttrs, PieceKind};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Piece property with the outline of a floor opening, as JSON (our own).
pub const OPENING_PROPERTY: &str = "mySweetHome.opening";

/// Floor thickness without levels.
const DEFAULT_FLOOR_THICKNESS: f64 = 12.0;
/// How far the piece reaches below the floor, so that it cuts the ceiling below too.
const BELOW_FLOOR: f64 = 2.0;
/// Smallest side of an opening in cm.
const MIN_SIDE: f64 = 5.0;
/// Color of the edge of the hole.
const EDGE_COLOR: [f32; 3] = [0.85, 0.83, 0.8];

#[derive(Deserialize, JsonSchema)]
struct AddParams {
    /// Corners of the opening in the plan in cm, at least 3, its edges not crossing
    points: Vec<[f32; 2]>,
    /// Level whose floor gets the hole (default: selected level); the ceiling of the level
    /// below gets it too
    level: Option<String>,
    /// Name of the piece (default "Floor opening")
    name: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateParams {
    /// ID of the opening
    id: String,
    /// New corners in the plan in cm
    points: Option<Vec<[f32; 2]>>,
    /// Width of the opening in cm (stretches its outline)
    width: Option<f32>,
    /// Depth of the opening in cm (stretches its outline)
    depth: Option<f32>,
}

/// The outline of an opening, as stored in [`OPENING_PROPERTY`]: corners relative to the
/// middle of the piece before its rotation.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct OpeningData {
    outline: Vec<P2>,
}

fn opening_data(piece: &Piece) -> Option<OpeningData> {
    property_data(piece, OPENING_PROPERTY)
}

/// Thickness of the floor of a level.
fn floor_thickness(home: &Home, level: Option<&str>) -> f64 {
    level
        .and_then(|id| home.levels.iter().find(|l| l.attrs.id == id))
        .map_or(DEFAULT_FLOOR_THICKNESS, |l| {
            f64::from(l.attrs.floor_thickness)
        })
}

fn area(outline: &[P2]) -> f64 {
    let n = outline.len();
    (0..n)
        .map(|i| {
            let (a, b) = (outline[i], outline[(i + 1) % n]);
            a[0] * b[1] - b[0] * a[1]
        })
        .sum::<f64>()
        / 2.0
}

/// True if two edges of the outline cross.
fn crossing(outline: &[P2]) -> bool {
    let n = outline.len();
    let side = |a: P2, b: P2, c: P2| (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for i in 0..n {
        for j in i + 2..n {
            if i == 0 && j == n - 1 {
                continue;
            }
            let (a, b) = (outline[i], outline[(i + 1) % n]);
            let (c, d) = (outline[j], outline[(j + 1) % n]);
            if side(a, b, c) * side(a, b, d) < 0.0 && side(c, d, a) * side(c, d, b) < 0.0 {
                return true;
            }
        }
    }
    false
}

fn checked_outline(points: &[[f32; 2]]) -> Result<Vec<P2>, CommandError> {
    let mut outline = checked_points(points)?;
    outline.dedup_by(|a, b| (a[0] - b[0]).hypot(a[1] - b[1]) < 0.01);
    if outline.len() > 1
        && (outline[0][0] - outline[outline.len() - 1][0]).abs() < 0.01
        && (outline[0][1] - outline[outline.len() - 1][1]).abs() < 0.01
    {
        outline.pop();
    }
    if outline.len() > 3 && crossing(&outline) {
        return Err(CommandError::failed("the edges of the opening cross"));
    }
    if outline.len() < 3 || area(&outline).abs() < MIN_SIDE * MIN_SIDE {
        return Err(CommandError::failed(
            "an opening needs at least 3 corners around an area",
        ));
    }
    Ok(outline)
}

/// A generated opening, stored in the document.
struct Generated {
    model: String,
    model_size: i64,
    size: [f64; 2],
    /// Middle of the outline relative to the middle it was given around
    offset: P2,
    cut_out: String,
}

/// Makes the edge of the hole as the model of an opening (faces looking into the hole, from
/// `depth` below the floor up to it) and its cut-out. The outline is moved to be relative to
/// its middle.
fn generate(
    doc: &mut Document,
    data: &mut OpeningData,
    depth: f64,
) -> Result<Generated, CommandError> {
    let (lo, hi) = bounds(&data.outline);
    let offset = [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0];
    let (width, length) = (hi[0] - lo[0], hi[1] - lo[1]);
    if width < MIN_SIDE || length < MIN_SIDE {
        return Err(CommandError::failed(format!(
            "an opening must be at least {MIN_SIDE} cm wide and deep"
        )));
    }
    for p in &mut data.outline {
        *p = [round(p[0] - offset[0]), round(p[1] - offset[1])];
    }
    let outline = &data.outline;
    let n = outline.len();
    // Inside lies left of every edge of a counter-clockwise outline (in a frame with y up)
    let inside = if area(outline) > 0.0 { 1.0 } else { -1.0 };
    let mut positions = Vec::new();
    let mut uvs = Vec::new();
    let mut triangles = Vec::new();
    let mut along = 0.0;
    for i in 0..n {
        let (a, b) = (outline[i], outline[(i + 1) % n]);
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let len = dx.hypot(dy);
        if len < 1e-9 {
            continue;
        }
        let normal = [-dy / len * inside, 0.0, dx / len * inside];
        let first = positions.len() as u32;
        let corners = [
            [a[0], -depth, a[1]],
            [b[0], -depth, b[1]],
            [b[0], 0.0, b[1]],
            [a[0], 0.0, a[1]],
        ];
        positions.extend(corners);
        uvs.extend([
            [along, -depth],
            [along + len, -depth],
            [along + len, 0.0],
            [along, 0.0],
        ]);
        along += len;
        // Counter-clockwise seen from inside the hole
        let e1 = [b[0] - a[0], 0.0, b[1] - a[1]];
        let e2 = [0.0, depth, 0.0];
        let cross = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
        ];
        let facing = cross[0] * normal[0] + cross[2] * normal[2] > 0.0;
        let quads: [[u32; 3]; 2] = if facing {
            [[0, 1, 2], [0, 2, 3]]
        } else {
            [[0, 2, 1], [0, 3, 2]]
        };
        for q in quads {
            triangles.push(ModelTriangle {
                corners: q.map(|c| first + c),
                normal,
                part: 0,
            });
        }
    }
    let parts = vec![ModelPart {
        name: "opening_edge",
        color: EDGE_COLOR,
        texture: None,
    }];
    let (model, model_size) = store_model(doc, "opening", &positions, &uvs, &triangles, parts);
    let unit = |v: f64| {
        let v = (v.clamp(0.0, 1.0) * 10000.0).round() / 10000.0;
        if v == 0.0 { 0.0 } else { v }
    };
    let mut cut_out = String::new();
    for (i, p) in outline.iter().enumerate() {
        let u = unit(p[0] / width + 0.5);
        let v = unit(p[1] / length + 0.5);
        cut_out.push_str(&format!("{}{u},{v} ", if i == 0 { "M" } else { "L" }));
    }
    cut_out.push('Z');
    Ok(Generated {
        model,
        model_size,
        size: [width, length],
        offset,
        cut_out,
    })
}

fn place(piece: &mut Piece, generated: &Generated, data: &OpeningData, depth: f64) {
    let a = &mut piece.attrs;
    let (sin, cos) = f64::from(a.angle_or_default()).sin_cos();
    let [ox, oy] = generated.offset;
    a.x = round(f64::from(a.x) + ox * cos - oy * sin) as f32;
    a.y = round(f64::from(a.y) + ox * sin + oy * cos) as f32;
    a.model = Some(generated.model.clone());
    a.model_size = Some(generated.model_size);
    a.width = round(generated.size[0]) as f32;
    a.depth = round(generated.size[1]) as f32;
    a.height = round(depth) as f32;
    a.width_in_plan = None;
    a.depth_in_plan = None;
    a.height_in_plan = None;
    a.pitch = None;
    a.roll = None;
    a.model_mirrored = None;
    // From just below the floor slab up to the floor: the hole goes through the floor of the
    // level and the ceiling below
    a.elevation = Some(-round(depth) as f32);
    a.staircase_cut_out_shape = Some(generated.cut_out.clone());
    set_property(
        piece,
        OPENING_PROPERTY,
        Some(serde_json::to_string(data).unwrap_or_default()),
    );
}

fn result(piece: &Piece) -> serde_json::Value {
    let a = &piece.attrs;
    json!({
        "id": a.id,
        "x": a.x,
        "y": a.y,
        "width": a.width,
        "depth": a.depth,
        "level": a.level,
    })
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "opening_add",
        "Adds a floor opening: a hole in the floor of a level and in the ceiling below it, for \
         a gallery, an open space over two levels or a shaft. It is kept as a staircase piece \
         with a cut-out, so Sweet Home 3D cuts the hole too.",
        true,
        |doc, p: AddParams| {
            let level = resolve_level(doc.home(), p.level.clone())?;
            let points = checked_outline(&p.points)?;
            let depth = floor_thickness(doc.home(), level.as_deref()) + BELOW_FLOOR;
            let (center, angle, outline) = frame(&points);
            let mut data = OpeningData { outline };
            let generated = generate(doc, &mut data, depth)?;
            let icon = doc.add_or_reuse_content(crate::model_package::placeholder_icon());
            let mut piece = Piece {
                kind: PieceKind::Piece,
                attrs: PieceAttrs {
                    id: Some(new_id("pieceOfFurniture")),
                    level,
                    name: p.name.clone().unwrap_or_else(|| "Floor opening".into()),
                    icon: Some(icon),
                    x: center[0] as f32,
                    y: center[1] as f32,
                    angle: (angle != 0.0).then_some(angle as f32),
                    movable: Some(false),
                    ..Default::default()
                },
                ..Default::default()
            };
            place(&mut piece, &generated, &data, depth);
            let out = result(&piece);
            doc.home_mut()
                .furniture
                .push(Furniture::Piece(Box::new(piece)));
            Ok(out)
        },
    );
    r.add(
        "opening_update",
        "Changes a floor opening made by opening_add: new corners, or its width and depth \
         (the outline is stretched). Move and turn it with furniture_update.",
        true,
        |doc, p: UpdateParams| {
            let piece = find_piece_mut(doc, &p.id)?;
            let Some(mut data) = opening_data(piece) else {
                return Err(CommandError::failed(format!(
                    "'{}' is not a floor opening made by opening_add",
                    piece.attrs.name
                )));
            };
            let level = piece.attrs.level.clone();
            let mut center = [f64::from(piece.attrs.x), f64::from(piece.attrs.y)];
            let mut angle = f64::from(piece.attrs.angle_or_default());
            if let Some(points) = &p.points {
                (center, angle, data.outline) = frame(&checked_outline(points)?);
            }
            for (given, axis, name) in [(p.width, 0, "width"), (p.depth, 1, "depth")] {
                let Some(side) = limited(name, given, MIN_SIDE, 100_000.0)? else {
                    continue;
                };
                let (lo, hi) = bounds(&data.outline);
                let old = hi[axis] - lo[axis];
                if old > 1e-6 {
                    for q in &mut data.outline {
                        q[axis] *= side / old;
                    }
                }
            }
            let depth = floor_thickness(doc.home(), level.as_deref()) + BELOW_FLOOR;
            let generated = generate(doc, &mut data, depth)?;
            let piece = find_piece_mut(doc, &p.id)?;
            piece.attrs.x = center[0] as f32;
            piece.attrs.y = center[1] as f32;
            piece.attrs.angle = (angle != 0.0).then_some(angle as f32);
            place(piece, &generated, &data, depth);
            Ok(result(piece))
        },
    );
}

/// Width and depth of the piece if it is a floor opening (before `furniture_update` changes
/// it).
pub(super) fn opening_size(doc: &mut Document, id: &str) -> Option<[f32; 3]> {
    let piece = find_piece_mut(doc, id).ok()?;
    let a = &piece.attrs;
    opening_data(piece).map(|_| [a.width, a.depth, a.height])
}

/// Makes a floor opening again after `furniture_update` changed the size of its piece: the
/// outline is stretched; it stays below the floor.
pub(super) fn refit(doc: &mut Document, id: &str, old: [f32; 3]) -> Result<(), CommandError> {
    let piece = find_piece_mut(doc, id)?;
    let Some(mut data) = opening_data(piece) else {
        return Ok(());
    };
    let a = &piece.attrs;
    let new = [a.width, a.depth, a.height];
    let elevation = a.elevation;
    if new.iter().zip(old).all(|(n, o)| (n - o).abs() < 0.005) && elevation == Some(-old[2]) {
        return Ok(());
    }
    let level = a.level.clone();
    let (lo, hi) = bounds(&data.outline);
    for axis in 0..2 {
        let side = hi[axis] - lo[axis];
        let wanted = f64::from(new[axis]).max(MIN_SIDE);
        if side > 1e-6 {
            for q in &mut data.outline {
                q[axis] *= wanted / side;
            }
        }
    }
    let depth = floor_thickness(doc.home(), level.as_deref()) + BELOW_FLOOR;
    let generated = generate(doc, &mut data, depth)?;
    let piece = find_piece_mut(doc, id)?;
    place(piece, &generated, &data, depth);
    Ok(())
}
