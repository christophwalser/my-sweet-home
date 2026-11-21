//! Roofs. The file format of Sweet Home 3D has no roofs, so a roof is a piece of furniture
//! with a generated model that keeps what it was made from in a property of our own. Sweet
//! Home 3D shows it as any other piece; here it can be changed and is made again.

use super::furniture::{find_piece_mut, set_property};
use super::generated::{
    ModelPart, ModelTexture, ModelTriangle, bounds, checked_points, frame, kept_image, limited,
    property_data, rgb, round, set_texture, store_model,
};
use super::{new_id, parse_color, resolve_level};
use crate::Document;
use crate::registry::{CommandError, Registry};
use msh_geometry::roof::{self, EdgeKind, LineKind, P2, RoofShape, RoofSpec, Surface};
use msh_model::{Furniture, Home, Piece, PieceAttrs, PieceKind};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Piece property with what a roof was made from, as JSON (our own; Sweet Home 3D keeps it
/// and shows the roof as a piece of furniture).
pub const ROOF_PROPERTY: &str = "mySweetHome.roof";

const DEFAULT_PITCH: f64 = 35.0;
const DEFAULT_OVERHANG: f64 = 40.0;
const DEFAULT_THICKNESS: f64 = 20.0;
const DEFAULT_COLOR: &str = "#8C4A3C";
const DEFAULT_GABLE_COLOR: &str = "#F2F0EB";
/// Color of the underside and of the faces around the edge.
const SOFFIT_COLOR: [f32; 3] = [0.89, 0.87, 0.83];
/// Dents of the outline of walls up to this depth in cm are roofed over (steps between walls
/// of different thickness, a cut corner, a recessed door).
const WALL_DENT: f64 = 60.0;
/// Smallest side of the area a roof covers, in cm.
const MIN_SIDE: f64 = 10.0;

#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Shape {
    /// Two surfaces and a ridge along the longer side, gables at the ends
    Gable,
    /// A surface at every edge
    Hip,
    /// One surface, low at the longest edge
    Shed,
    /// A level slab on the walls
    Flat,
}

impl From<Shape> for RoofShape {
    fn from(s: Shape) -> Self {
        match s {
            Shape::Gable => RoofShape::Gable,
            Shape::Hip => RoofShape::Hip,
            Shape::Shed => RoofShape::Shed,
            Shape::Flat => RoofShape::Flat,
        }
    }
}

#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Edge {
    /// The roof rises from this edge
    Eave,
    /// The roof ends here with a wall up to the roof
    Gable,
}

impl From<Edge> for EdgeKind {
    fn from(e: Edge) -> Self {
        match e {
            Edge::Eave => EdgeKind::Eave,
            Edge::Gable => EdgeKind::Gable,
        }
    }
}

#[derive(Deserialize, JsonSchema)]
struct AddParams {
    /// Corners of the area the roof covers, along the outer face of the walls. Default: the
    /// outline of the walls of the level that close around an area. An outline with corners
    /// that point inwards (an L, T or U shaped house with right angles) gets one roof for
    /// each of its largest rectangles
    points: Option<Vec<[f32; 2]>>,
    /// Level ID (default: selected level)
    level: Option<String>,
    /// "gable" (default), "hip", "shed" or "flat"
    shape: Option<Shape>,
    /// Pitch of the roof surfaces in degrees, up to 80 (default 35)
    pitch: Option<f32>,
    /// How far the roof reaches beyond the outline in cm (default 40)
    overhang: Option<f32>,
    /// Thickness of the roof in cm (default 20)
    thickness: Option<f32>,
    /// Turns the roof to its next position: the ridge of a gable roof by a quarter (1), the
    /// low edge of a shed roof to the next edge (1, 2, ...)
    turn: Option<u32>,
    /// Kind of every edge, from each corner to the next, instead of a shape: "eave" or
    /// "gable". Only for an outline without corners that point inwards
    edges: Option<Vec<Edge>>,
    /// Height of the top of the walls above the floor of the level in cm, where the roof
    /// starts (default: the lowest wall of the level, or the height of the level)
    base: Option<f32>,
    /// Color of the roof covering as #RRGGBB (default a tile red)
    color: Option<String>,
    /// Color of the walls under the gables as #RRGGBB (default a light wall color)
    gable_color: Option<String>,
    /// Catalog ID of a texture for the roof covering (see catalog_search); its rows run
    /// along the eaves
    texture: Option<String>,
    /// Catalog ID of a texture for the walls under the gables
    gable_texture: Option<String>,
    /// Name of the piece (default "Roof")
    name: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateParams {
    /// ID of the roof
    id: String,
    /// "gable", "hip", "shed" or "flat"
    shape: Option<Shape>,
    /// Pitch of the roof surfaces in degrees, up to 80
    pitch: Option<f32>,
    /// How far the roof reaches beyond the outline in cm
    overhang: Option<f32>,
    /// Thickness of the roof in cm
    thickness: Option<f32>,
    /// Position of the roof: the ridge of a gable roof turned by a quarter (1), the low edge
    /// of a shed roof at the next edge (1, 2, ...)
    turn: Option<u32>,
    /// Kind of every edge, from each corner to the next: "eave" or "gable"
    edges: Option<Vec<Edge>>,
    /// New corners of the area the roof covers (without corners that point inwards)
    points: Option<Vec<[f32; 2]>>,
    /// Width of the area the roof covers in cm, without the overhang
    width: Option<f32>,
    /// Depth of the area the roof covers in cm, without the overhang
    depth: Option<f32>,
    /// Height of the top of the walls above the floor of the level in cm
    base: Option<f32>,
    /// Color of the roof covering as #RRGGBB
    color: Option<String>,
    /// Color of the walls under the gables as #RRGGBB
    gable_color: Option<String>,
    /// Catalog ID of a texture for the roof covering (its rows run along the eaves); ""
    /// removes the texture
    texture: Option<String>,
    /// Catalog ID of a texture for the walls under the gables; "" removes the texture
    gable_texture: Option<String>,
}

/// What a roof was made from, as stored in [`ROOF_PROPERTY`]. Lengths in cm, the pitch in
/// degrees; points are relative to the middle of the piece, before its rotation.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct RoofData {
    shape: RoofShape,
    #[serde(default)]
    turn: u32,
    /// Corners of the covered area
    outline: Vec<P2>,
    /// Kind of the edge from each corner to the next
    edges: Vec<EdgeKind>,
    pitch: f64,
    overhang: f64,
    thickness: f64,
    color: String,
    gable_color: String,
    /// Texture of the roof covering, shown instead of its color
    #[serde(default, skip_serializing_if = "Option::is_none")]
    texture: Option<ModelTexture>,
    /// Texture of the walls under the gables
    #[serde(default, skip_serializing_if = "Option::is_none")]
    gable_texture: Option<ModelTexture>,
    /// Height of the lowest point of the roof above the top of the walls (not positive for
    /// a sloped roof)
    #[serde(default)]
    lowest: f64,
    /// Width and depth of the roof with its overhang, as it was made
    #[serde(default)]
    size: [f64; 2],
    /// Lines of the roof seen from above: x and y of both ends and "eave", "verge", "ridge"
    /// or "hip"
    #[serde(default)]
    lines: Vec<(f64, f64, f64, f64, LineKind)>,
}

/// The images of the textures of a roof.
#[derive(Default, Clone)]
struct Images {
    cover: Option<Vec<u8>>,
    gable: Option<Vec<u8>>,
}

/// The images of the textures a roof has, from the files of its model.
fn kept_images(doc: &Document, model: Option<&str>, data: &RoofData) -> Images {
    Images {
        cover: kept_image(doc, model, &data.texture),
        gable: kept_image(doc, model, &data.gable_texture),
    }
}

/// The roof data of a piece, if it is a roof.
fn roof_data(piece: &Piece) -> Option<RoofData> {
    property_data(piece, ROOF_PROPERTY)
}

/// A generated roof, stored in the document.
struct Generated {
    /// Resource name of the model
    model: String,
    model_size: i64,
    /// Width, depth and height of the model
    size: [f64; 3],
    /// How far the middle of the model lies from the middle the corners were given around
    offset: P2,
    /// Height of the highest point above the top of the walls
    highest: f64,
}

/// Makes the model of the roof, stores it in the document and updates the values of `data`
/// that follow from the model. The corners of `data` are moved so that they are relative
/// to the middle of the model.
fn generate(
    doc: &mut Document,
    data: &mut RoofData,
    images: Images,
) -> Result<Generated, CommandError> {
    // A texture without its image is no texture
    if images.cover.is_none() {
        data.texture = None;
    }
    if images.gable.is_none() {
        data.gable_texture = None;
    }
    let pitch = if data.shape == RoofShape::Flat {
        0.0
    } else {
        data.pitch.to_radians()
    };
    let mesh = roof::roof(&RoofSpec {
        outline: data.outline.clone(),
        edges: data.edges.clone(),
        pitch,
        overhang: data.overhang,
        thickness: data.thickness,
    })
    .map_err(|e| CommandError::failed(e.to_string()))?;
    let (lo, hi) = mesh.bounds();
    let offset = [(lo[0] + hi[0]) / 2.0, (lo[2] + hi[2]) / 2.0];
    for p in &mut data.outline {
        *p = [round(p[0] - offset[0]), round(p[1] - offset[1])];
    }
    data.lowest = round(lo[1]);
    data.size = [round(hi[0] - lo[0]), round(hi[2] - lo[2])];
    data.lines = mesh
        .lines
        .iter()
        .map(|l| {
            (
                round(l.a[0] - offset[0]),
                round(l.a[1] - offset[1]),
                round(l.b[0] - offset[0]),
                round(l.b[1] - offset[1]),
                l.kind,
            )
        })
        .collect();

    let positions: Vec<[f64; 3]> = mesh
        .positions
        .iter()
        .map(|p| [p[0] - offset[0], p[1], p[2] - offset[1]])
        .collect();
    let surfaces = [Surface::Cover, Surface::Soffit, Surface::Gable];
    let triangles: Vec<ModelTriangle> = mesh
        .triangles
        .iter()
        .map(|t| ModelTriangle {
            corners: t.corners,
            normal: t.normal,
            part: surfaces.iter().position(|s| *s == t.surface).unwrap_or(0),
        })
        .collect();
    let parts = vec![
        ModelPart {
            name: "roof_cover",
            color: rgb(&data.color)?,
            texture: data.texture.clone().zip(images.cover),
        },
        ModelPart {
            name: "roof_soffit",
            color: SOFFIT_COLOR,
            texture: None,
        },
        ModelPart {
            name: "roof_gable",
            color: rgb(&data.gable_color)?,
            texture: data.gable_texture.clone().zip(images.gable),
        },
    ];
    let (model, model_size) = store_model(doc, "roof", &positions, &mesh.uvs, &triangles, parts);
    Ok(Generated {
        model,
        model_size,
        size: [hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1]],
        offset,
        highest: hi[1],
    })
}

/// Puts a generated roof into its piece. `base` is the height of the top of the walls above
/// the floor of the level.
fn place(piece: &mut Piece, generated: &Generated, data: &RoofData, base: f64) {
    let a = &mut piece.attrs;
    let (sin, cos) = f64::from(a.angle_or_default()).sin_cos();
    let [ox, oy] = generated.offset;
    a.x = round(f64::from(a.x) + ox * cos - oy * sin) as f32;
    a.y = round(f64::from(a.y) + ox * sin + oy * cos) as f32;
    a.model = Some(generated.model.clone());
    a.model_size = Some(generated.model_size);
    a.width = round(generated.size[0]) as f32;
    a.depth = round(generated.size[1]) as f32;
    a.height = round(generated.size[2]) as f32;
    a.width_in_plan = None;
    a.depth_in_plan = None;
    a.height_in_plan = None;
    a.pitch = None;
    a.roll = None;
    a.elevation = Some(round(base + data.lowest) as f32);
    set_property(
        piece,
        ROOF_PROPERTY,
        Some(serde_json::to_string(data).unwrap_or_default()),
    );
}

fn result(piece: &Piece, generated: &Generated, data: &RoofData, base: f64) -> serde_json::Value {
    let a = &piece.attrs;
    json!({
        "id": a.id,
        "x": a.x,
        "y": a.y,
        "width": a.width,
        "depth": a.depth,
        "height": a.height,
        "elevation": a.elevation,
        "ridge_height": round(base + generated.highest),
        "shape": data.shape,
        "edges": data.edges,
    })
}

/// Height of the top of the walls above the floor of the level: the lowest wall of the level,
/// or the height of the level if it has no walls.
fn wall_top(home: &Home, level: Option<&str>) -> f64 {
    let wall_height = home.attrs.wall_height.unwrap_or(250.0);
    let lowest = home
        .walls
        .iter()
        .filter(|w| w.attrs.level.as_deref() == level)
        .map(|w| w.attrs.height.unwrap_or(wall_height))
        .fold(None, |low: Option<f32>, h| {
            Some(low.map_or(h, |low| low.min(h)))
        });
    let of_level = level
        .and_then(|id| home.levels.iter().find(|l| l.attrs.id == id))
        .map(|l| l.attrs.height);
    f64::from(lowest.or(of_level).unwrap_or(wall_height))
}

/// The areas that each carry one roof: the outline itself, or its largest rectangles if it
/// has corners that point inwards.
fn parts(outline: Vec<P2>) -> Result<Vec<Vec<P2>>, CommandError> {
    let trial = roof::roof(&RoofSpec {
        outline: outline.clone(),
        edges: Vec::new(),
        pitch: 0.0,
        overhang: 0.0,
        thickness: 1.0,
    });
    match trial {
        Ok(_) => Ok(vec![outline]),
        Err(roof::RoofError::NotConvex) => roof::rectangles(&outline, 0.0).ok_or_else(|| {
            CommandError::failed(
                "the outline has corners that point inwards and edges that are not at right \
                 angles; give the corners of several roofs without such corners instead",
            )
        }),
        Err(e) => Err(CommandError::failed(e.to_string())),
    }
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "roof_add",
        "Adds a roof over an area: a gable, hip, shed or flat roof with a pitch, an overhang \
         and a thickness. Without points it covers the walls of the level. The roof is a piece \
         of furniture with a generated model (Sweet Home 3D shows it, here roof_update \
         changes it); it lies on the level at the top of its walls.",
        true,
        |doc, p: AddParams| {
            let level = resolve_level(doc.home(), p.level.clone())?;
            let outlines: Vec<Vec<P2>> = match &p.points {
                Some(points) => vec![checked_points(points)?],
                None => msh_geometry::walls_outlines(doc.home(), level.as_deref())
                    .iter()
                    .map(|ring| {
                        ring.iter()
                            .map(|q| [f64::from(q[0]), f64::from(q[1])])
                            .collect()
                    })
                    .collect(),
            };
            if outlines.is_empty() {
                return Err(CommandError::failed(
                    "the level has no walls that close around an area; give the corners of the \
                     roof as points",
                ));
            }
            let mut areas = Vec::new();
            for outline in outlines {
                if p.points.is_some() {
                    areas.extend(parts(outline)?);
                } else {
                    // The outline of walls has small steps and cut corners
                    areas.extend(roof::roof_areas(&outline, WALL_DENT));
                }
            }
            if areas.is_empty() {
                return Err(CommandError::failed(
                    "the walls of the level span no area; give the corners of the roof as points",
                ));
            }
            if p.edges.is_some() && areas.len() > 1 {
                return Err(CommandError::failed(
                    "edges can only be given for one roof over an outline without corners that \
                     point inwards",
                ));
            }
            let shape: RoofShape = p.shape.unwrap_or(Shape::Gable).into();
            let turn = p.turn.unwrap_or(0);
            let pitch = limited("pitch", p.pitch, 0.0, 80.0)?.unwrap_or(DEFAULT_PITCH);
            let overhang = limited("overhang", p.overhang, 0.0, 500.0)?.unwrap_or(DEFAULT_OVERHANG);
            let thickness =
                limited("thickness", p.thickness, 1.0, 100.0)?.unwrap_or(DEFAULT_THICKNESS);
            let base = match limited("base", p.base, -10_000.0, 100_000.0)? {
                Some(base) => base,
                None => wall_top(doc.home(), level.as_deref()),
            };
            let color = p.color.clone().unwrap_or_else(|| DEFAULT_COLOR.into());
            let gable_color = p
                .gable_color
                .clone()
                .unwrap_or_else(|| DEFAULT_GABLE_COLOR.into());
            let (mut texture, mut gable_texture) = (None, None);
            let mut images = Images::default();
            set_texture(&mut texture, &mut images.cover, &p.texture, "cover")?;
            set_texture(
                &mut gable_texture,
                &mut images.gable,
                &p.gable_texture,
                "gable",
            )?;
            let icon = doc.add_or_reuse_content(crate::model_package::placeholder_icon());

            let mut results = Vec::new();
            for area in areas {
                let (center, angle, outline) = frame(&area);
                let (shape, edges) = match &p.edges {
                    Some(edges) if edges.len() == outline.len() => (
                        RoofShape::Custom,
                        edges.iter().map(|e| (*e).into()).collect(),
                    ),
                    Some(_) => {
                        return Err(CommandError::failed(
                            "edges needs one entry for each corner of the roof",
                        ));
                    }
                    None => (shape, roof::shape_edges(&outline, shape, turn as usize)),
                };
                let mut data = RoofData {
                    shape,
                    turn,
                    outline,
                    edges,
                    pitch,
                    overhang,
                    thickness,
                    color: color.clone(),
                    gable_color: gable_color.clone(),
                    texture: texture.clone(),
                    gable_texture: gable_texture.clone(),
                    lowest: 0.0,
                    size: [0.0; 2],
                    lines: Vec::new(),
                };
                let generated = generate(doc, &mut data, images.clone())?;
                let mut piece = Piece {
                    kind: PieceKind::Piece,
                    attrs: PieceAttrs {
                        id: Some(new_id("pieceOfFurniture")),
                        level: level.clone(),
                        name: p.name.clone().unwrap_or_else(|| "Roof".into()),
                        icon: Some(icon.clone()),
                        x: center[0] as f32,
                        y: center[1] as f32,
                        angle: (angle != 0.0).then_some(angle as f32),
                        ..Default::default()
                    },
                    ..Default::default()
                };
                place(&mut piece, &generated, &data, base);
                results.push(result(&piece, &generated, &data, base));
                doc.home_mut()
                    .furniture
                    .push(Furniture::Piece(Box::new(piece)));
            }
            let ids: Vec<&serde_json::Value> = results.iter().map(|r| &r["id"]).collect();
            let mut first = results[0].clone();
            first["ids"] = json!(ids);
            Ok(first)
        },
    );
    r.add(
        "roof_update",
        "Changes a roof made by roof_add: its shape, pitch, overhang, thickness, the edges it \
         rises from, the area it covers, the height it starts at or its colors. The model of \
         the roof is made again. Move and turn a roof with furniture_update.",
        true,
        |doc, p: UpdateParams| {
            let piece = find_piece_mut(doc, &p.id)?;
            let Some(mut data) = roof_data(piece) else {
                return Err(CommandError::failed(format!(
                    "'{}' is not a roof made by roof_add",
                    piece.attrs.name
                )));
            };
            let mut base = f64::from(piece.attrs.elevation.unwrap_or(0.0)) - data.lowest;
            let mut center = [f64::from(piece.attrs.x), f64::from(piece.attrs.y)];
            let mut angle = f64::from(piece.attrs.angle_or_default());
            let mut reshape = p.shape.is_some() || p.turn.is_some();
            let model = piece.attrs.model.clone();
            let mut images = kept_images(doc, model.as_deref(), &data);
            set_texture(&mut data.texture, &mut images.cover, &p.texture, "cover")?;
            set_texture(
                &mut data.gable_texture,
                &mut images.gable,
                &p.gable_texture,
                "gable",
            )?;

            if let Some(points) = &p.points {
                let outline = checked_points(points)?;
                if data.shape == RoofShape::Custom && outline.len() != data.outline.len() {
                    data.shape = RoofShape::Hip;
                }
                (center, angle, data.outline) = frame(&outline);
                reshape = true;
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
            if let Some(shape) = p.shape {
                data.shape = shape.into();
            }
            if let Some(turn) = p.turn {
                data.turn = turn;
            }
            if let Some(edges) = &p.edges {
                if edges.len() != data.outline.len() {
                    return Err(CommandError::failed(
                        "edges needs one entry for each corner of the roof",
                    ));
                }
                data.edges = edges.iter().map(|e| (*e).into()).collect();
                data.shape = RoofShape::Custom;
            } else if reshape && data.shape != RoofShape::Custom {
                data.edges = roof::shape_edges(&data.outline, data.shape, data.turn as usize);
            }
            if let Some(v) = limited("pitch", p.pitch, 0.0, 80.0)? {
                data.pitch = v;
            }
            if let Some(v) = limited("overhang", p.overhang, 0.0, 500.0)? {
                data.overhang = v;
            }
            if let Some(v) = limited("thickness", p.thickness, 1.0, 100.0)? {
                data.thickness = v;
            }
            if let Some(v) = limited("base", p.base, -10_000.0, 100_000.0)? {
                base = v;
            }
            if let Some(c) = &p.color {
                parse_color(c)?;
                data.color = c.clone();
            }
            if let Some(c) = &p.gable_color {
                parse_color(c)?;
                data.gable_color = c.clone();
            }
            let generated = generate(doc, &mut data, images)?;
            let piece = find_piece_mut(doc, &p.id)?;
            piece.attrs.x = center[0] as f32;
            piece.attrs.y = center[1] as f32;
            piece.attrs.angle = (angle != 0.0).then_some(angle as f32);
            place(piece, &generated, &data, base);
            Ok(result(piece, &generated, &data, base))
        },
    );
}

/// Width, depth and height of the piece if it is a roof (before `furniture_update` changes
/// it).
pub(super) fn roof_size(doc: &mut Document, id: &str) -> Option<[f32; 3]> {
    let piece = find_piece_mut(doc, id).ok()?;
    let a = &piece.attrs;
    roof_data(piece).map(|_| [a.width, a.depth, a.height])
}

/// Makes a roof again after `furniture_update` changed the size of its piece: the area it
/// covers is stretched; the pitch, the overhang and the thickness stay, and with them the
/// height.
pub(super) fn refit(doc: &mut Document, id: &str, old: [f32; 3]) -> Result<(), CommandError> {
    let piece = find_piece_mut(doc, id)?;
    let Some(mut data) = roof_data(piece) else {
        return Ok(());
    };
    let a = &piece.attrs;
    let new = [a.width, a.depth, a.height];
    if new.iter().zip(old).all(|(n, o)| (n - o).abs() < 0.005) {
        return Ok(());
    }
    let base = f64::from(a.elevation.unwrap_or(0.0)) - data.lowest;
    let model = a.model.clone();
    let images = kept_images(doc, model.as_deref(), &data);
    let (lo, hi) = bounds(&data.outline);
    for axis in 0..2 {
        let covered = hi[axis] - lo[axis];
        // What the roof reaches beyond the area it covers stays
        let beyond = f64::from(old[axis]) - covered;
        let wanted = (f64::from(new[axis]) - beyond).max(MIN_SIDE);
        if covered > 1e-6 {
            for q in &mut data.outline {
                q[axis] *= wanted / covered;
            }
        }
    }
    let generated = generate(doc, &mut data, images)?;
    let piece = find_piece_mut(doc, id)?;
    place(piece, &generated, &data, base);
    Ok(())
}
