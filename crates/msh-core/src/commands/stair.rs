//! Stairs made from their measures: straight, L, U and spiral. A stair is a piece of furniture
//! with a generated model and a cut-out in the floor above, so Sweet Home 3D shows it as a
//! staircase; what it was made from is kept in a property of our own.

use super::furniture::{find_piece_mut, set_property};
use super::generated::{
    ModelPart, ModelTexture, ModelTriangle, kept_image, limited, property_data, rgb, round,
    set_texture, store_model,
};
use super::{new_id, parse_color, resolve_level};
use crate::Document;
use crate::registry::{CommandError, Registry};
use msh_geometry::roof::P2;
use msh_geometry::stair::{
    self, Part, Rails, StairShape, StairSpec, StairStyle, StairWarning, Turn,
};
use msh_model::{Furniture, Home, Piece, PieceAttrs, PieceKind};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Piece property with what a stair was made from, as JSON (our own; Sweet Home 3D keeps it
/// and shows the stair as a staircase).
pub const STAIR_PROPERTY: &str = "mySweetHome.stair";

const DEFAULT_WIDTH: f64 = 100.0;
const DEFAULT_GAP: f64 = 10.0;
const DEFAULT_DIAMETER: f64 = 200.0;
const DEFAULT_COLUMN: f64 = 10.0;
const DEFAULT_THICKNESS: f64 = 5.0;
const DEFAULT_COLOR: &str = "#C8A27A";
const DEFAULT_FRAME_COLOR: &str = "#4A4A4A";
/// Free height above the steps; where it ends, the floor above gets a hole.
const HEADROOM: f64 = 200.0;
/// Floor thickness assumed without a level above.
const DEFAULT_FLOOR_THICKNESS: f64 = 12.0;

#[derive(Deserialize, JsonSchema, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum Shape {
    /// One flight
    Straight,
    /// Two flights at right angles with a square landing
    L,
    /// Two flights side by side in opposite directions with a landing across both
    U,
    /// Steps around a column
    Spiral,
}

impl From<Shape> for StairShape {
    fn from(s: Shape) -> Self {
        match s {
            Shape::Straight => StairShape::Straight,
            Shape::L => StairShape::L,
            Shape::U => StairShape::U,
            Shape::Spiral => StairShape::Spiral,
        }
    }
}

#[derive(Deserialize, JsonSchema, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum Side {
    Left,
    Right,
}

impl From<Side> for Turn {
    fn from(s: Side) -> Self {
        match s {
            Side::Left => Turn::Left,
            Side::Right => Turn::Right,
        }
    }
}

#[derive(Deserialize, JsonSchema, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum Style {
    /// Steps as blocks down to the floor
    Solid,
    /// Treads on stringers (a spiral stair: around its column)
    Open,
}

impl From<Style> for StairStyle {
    fn from(s: Style) -> Self {
        match s {
            Style::Solid => StairStyle::Solid,
            Style::Open => StairStyle::Open,
        }
    }
}

#[derive(Deserialize, JsonSchema, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum RailSides {
    None,
    Left,
    Right,
    Both,
}

impl From<RailSides> for Rails {
    fn from(s: RailSides) -> Self {
        match s {
            RailSides::None => Rails::None,
            RailSides::Left => Rails::Left,
            RailSides::Right => Rails::Right,
            RailSides::Both => Rails::Both,
        }
    }
}

/// The measures of a stair, for stair_add, stair_update and stair_calc.
#[derive(Deserialize, JsonSchema, Default)]
struct Measures {
    /// "straight" (default), "l" (quarter landing), "u" (half landing) or "spiral"
    shape: Option<Shape>,
    /// Which way an L, U or spiral stair turns walking up: "right" (default) or "left"
    turn: Option<Side>,
    /// Width of the flights in cm (default 100)
    width: Option<f32>,
    /// Height from the floor of the level to the floor above in cm (default: up to the next
    /// level, or the height of the level and its floor thickness)
    rise: Option<f32>,
    /// Number of risers, the last one onto the floor above (default: about 17.5 cm each)
    risers: Option<u32>,
    /// Depth of a tread in cm, on the walking line of a spiral stair (default: by the step
    /// rule 2 × riser + tread = 63 cm)
    tread: Option<f32>,
    /// Treads before the landing of an L or U shaped stair (default: half of them)
    first_flight: Option<u32>,
    /// Space between the flights of a U shaped stair in cm (default 10)
    gap: Option<f32>,
    /// Outer diameter of a spiral stair in cm (default 200)
    diameter: Option<f32>,
    /// Diameter of the column of a spiral stair in cm (default 10)
    column: Option<f32>,
    /// "solid" (blocks down to the floor, default) or "open" (treads on stringers; a spiral
    /// stair is open by default)
    style: Option<Style>,
    /// Thickness of the treads of an open stair in cm (default 5)
    thickness: Option<f32>,
    /// Handrails, seen walking up: "none", "left", "right" or "both" (default; a spiral stair
    /// has one on the outside only)
    rails: Option<RailSides>,
}

#[derive(Deserialize, JsonSchema)]
struct AddParams {
    /// X of the middle of the front edge of the first step in cm
    x: f32,
    /// Y of the middle of the front edge of the first step in cm
    y: f32,
    /// Direction the stair climbs in degrees, clockwise from up in the plan (default 0)
    angle_deg: Option<f32>,
    /// Level ID (default: selected level)
    level: Option<String>,
    #[serde(flatten)]
    measures: Measures,
    /// Color of the steps as #RRGGBB (default a light wood)
    color: Option<String>,
    /// Color of the stringers, the column and the handrails as #RRGGBB (default dark gray)
    frame_color: Option<String>,
    /// Catalog ID of a texture for the steps (see catalog_search)
    texture: Option<String>,
    /// Name of the piece (default "Stairs")
    name: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateParams {
    /// ID of the stair
    id: String,
    #[serde(flatten)]
    measures: Measures,
    /// Color of the steps as #RRGGBB
    color: Option<String>,
    /// Color of the stringers, the column and the handrails as #RRGGBB
    frame_color: Option<String>,
    /// Catalog ID of a texture for the steps; "" removes the texture
    texture: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct CalcParams {
    /// Level ID the stair starts on (default: selected level), for the default rise
    level: Option<String>,
    #[serde(flatten)]
    measures: Measures,
}

/// What a stair was made from, as stored in [`STAIR_PROPERTY`]. Lengths in cm; points are
/// relative to the middle of the piece, before its rotation.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct StairData {
    shape: StairShape,
    turn: Turn,
    style: StairStyle,
    rails: Rails,
    width: f64,
    rise: f64,
    risers: u32,
    tread: f64,
    /// Treads before the landing as given (else half of them)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    first_flight: Option<u32>,
    gap: f64,
    diameter: f64,
    column: f64,
    thickness: f64,
    color: String,
    frame_color: String,
    /// Texture of the steps, shown instead of their color
    #[serde(default, skip_serializing_if = "Option::is_none")]
    texture: Option<ModelTexture>,
    /// Where the stair starts: the middle of the front edge of its first step
    #[serde(default)]
    start: P2,
    /// Treads of each flight (an L or U shaped stair: before and after the landing)
    #[serde(default)]
    flights: Vec<u32>,
    /// Width and depth of the stair as it was made
    #[serde(default)]
    size: [f64; 2],
    /// Edges of the treads and landings seen from above: x and y of both ends
    #[serde(default)]
    lines: Vec<[f64; 4]>,
    /// Walking line from the bottom to the top
    #[serde(default)]
    walk: Vec<P2>,
    /// Checks the stair does not pass
    #[serde(default)]
    warnings: Vec<StairWarning>,
}

impl StairData {
    fn spec(&self, cut_from: f64) -> StairSpec {
        StairSpec {
            shape: self.shape,
            turn: self.turn,
            style: self.style,
            rails: self.rails,
            width: self.width,
            rise: self.rise,
            risers: self.risers,
            tread: self.tread,
            first_flight: self.first_flight,
            gap: self.gap,
            diameter: self.diameter,
            column: self.column,
            thickness: self.thickness,
            cut_from,
        }
    }

    /// Takes the given measures. The riser count follows a new rise, and the tread a new riser
    /// height, unless they are given too.
    fn apply(&mut self, m: &Measures) -> Result<(), CommandError> {
        let old_riser = self.rise / f64::from(self.risers.max(1));
        if let Some(v) = m.shape {
            let shape: StairShape = v.into();
            // A spiral stair is open by default, the others solid: a change between them takes
            // the style of the new shape unless one is given
            let spiral = StairShape::Spiral;
            if m.style.is_none() && (shape == spiral) != (self.shape == spiral) {
                self.style = default_style(shape);
            }
            self.shape = shape;
        }
        if let Some(v) = m.turn {
            self.turn = v.into();
        }
        if let Some(v) = m.style {
            self.style = v.into();
        }
        if let Some(v) = m.rails {
            self.rails = v.into();
        }
        if let Some(v) = limited("width", m.width, 30.0, 1000.0)? {
            self.width = v;
        }
        if let Some(v) = limited("rise", m.rise, 20.0, 2000.0)? {
            self.rise = v;
            if m.risers.is_none() {
                self.risers = stair::default_risers(v);
            }
        }
        if let Some(v) = m.risers {
            self.risers = v.clamp(2, 200);
        }
        let riser = self.rise / f64::from(self.risers);
        if let Some(v) = limited("tread", m.tread, 10.0, 100.0)? {
            self.tread = v;
        } else if (riser - old_riser).abs() > 1e-6 {
            self.tread = stair::default_tread(riser);
        }
        if let Some(v) = m.first_flight {
            self.first_flight = Some(v);
        }
        if let Some(v) = limited("gap", m.gap, 0.0, 500.0)? {
            self.gap = v;
        }
        if let Some(v) = limited("diameter", m.diameter, 60.0, 1000.0)? {
            self.diameter = v;
        }
        if let Some(v) = limited("column", m.column, 2.0, 200.0)? {
            self.column = v;
        }
        if let Some(v) = limited("thickness", m.thickness, 1.0, 50.0)? {
            self.thickness = v;
        }
        Ok(())
    }
}

/// The style a stair of a shape has by default: open around the column of a spiral stair,
/// else solid.
fn default_style(shape: StairShape) -> StairStyle {
    if shape == StairShape::Spiral {
        StairStyle::Open
    } else {
        StairStyle::Solid
    }
}

/// A stair with the defaults for a rise, before its measures are applied.
fn default_data(m: &Measures, rise: f64) -> StairData {
    let shape: StairShape = m.shape.map_or(StairShape::Straight, Into::into);
    let risers = stair::default_risers(rise);
    StairData {
        shape,
        turn: Turn::Right,
        style: default_style(shape),
        rails: Rails::Both,
        width: DEFAULT_WIDTH,
        rise,
        risers,
        tread: stair::default_tread(rise / f64::from(risers)),
        first_flight: None,
        gap: DEFAULT_GAP,
        diameter: DEFAULT_DIAMETER,
        column: DEFAULT_COLUMN,
        thickness: DEFAULT_THICKNESS,
        color: DEFAULT_COLOR.into(),
        frame_color: DEFAULT_FRAME_COLOR.into(),
        texture: None,
        start: [0.0, 0.0],
        flights: Vec::new(),
        size: [0.0; 2],
        lines: Vec::new(),
        walk: Vec::new(),
        warnings: Vec::new(),
    }
}

/// Height from the floor of a level to the floor above and the thickness of that floor: up to
/// the next higher level, else the height of the level with its floor thickness.
fn level_rise(home: &Home, level: Option<&str>) -> (f64, f64) {
    let Some(this) = level.and_then(|id| home.levels.iter().find(|l| l.attrs.id == id)) else {
        let height = f64::from(home.attrs.wall_height.unwrap_or(250.0));
        return (height + DEFAULT_FLOOR_THICKNESS, DEFAULT_FLOOR_THICKNESS);
    };
    let above = home
        .levels
        .iter()
        .filter(|l| l.attrs.elevation > this.attrs.elevation + 1.0)
        .min_by(|a, b| a.attrs.elevation.total_cmp(&b.attrs.elevation));
    match above {
        Some(above) => (
            f64::from(above.attrs.elevation - this.attrs.elevation),
            f64::from(above.attrs.floor_thickness),
        ),
        None => (
            f64::from(this.attrs.height + this.attrs.floor_thickness),
            f64::from(this.attrs.floor_thickness),
        ),
    }
}

/// Where the steps start to need a hole in the floor above.
fn cut_from(home: &Home, level: Option<&str>, rise: f64) -> f64 {
    let (_, floor) = level_rise(home, level);
    rise - floor - HEADROOM
}

/// Treads of each flight: before and after the landing of an L or U shaped stair (as the
/// generator splits them).
fn flights(data: &StairData) -> Vec<u32> {
    match data.shape {
        StairShape::L | StairShape::U => {
            let treads = data.risers.max(4) - 2;
            let first = data
                .first_flight
                .unwrap_or(treads.div_ceil(2))
                .clamp(1, treads - 1);
            vec![first, treads - first]
        }
        _ => vec![data.risers - 1],
    }
}

/// A generated stair, stored in the document.
struct Generated {
    model: String,
    model_size: i64,
    /// Width, depth and height of the model
    size: [f64; 3],
    /// Middle of the model in the frame of the stair (its start at the origin)
    offset: P2,
    /// Cut-out in the floor above as an SVG path in the unit square of the piece
    cut_out: Option<String>,
}

/// Makes the model of a stair, stores it in the document and updates the values of `data`
/// that follow from it.
fn generate(
    doc: &mut Document,
    data: &mut StairData,
    image: Option<Vec<u8>>,
    cut_from: f64,
) -> Result<Generated, CommandError> {
    if image.is_none() {
        data.texture = None;
    }
    let spec = data.spec(cut_from);
    let mesh = stair::stair(&spec).map_err(|e| CommandError::failed(e.to_string()))?;
    let (lo, hi) = mesh.bounds();
    let offset = [(lo[0] + hi[0]) / 2.0, (lo[2] + hi[2]) / 2.0];
    let (width, depth) = (hi[0] - lo[0], hi[2] - lo[2]);
    let local = |p: P2| [round(p[0] - offset[0]), round(p[1] - offset[1])];
    data.start = local([0.0, 0.0]);
    data.size = [round(width), round(depth)];
    data.lines = mesh
        .lines
        .iter()
        .map(|[a, b]| {
            let (a, b) = (local(*a), local(*b));
            [a[0], a[1], b[0], b[1]]
        })
        .collect();
    data.walk = mesh.walk.iter().map(|p| local(*p)).collect();
    data.warnings = stair::warnings(&spec);
    data.flights = flights(data);

    let unit = |v: f64| {
        let v = (v.clamp(0.0, 1.0) * 10000.0).round() / 10000.0;
        if v == 0.0 { 0.0 } else { v }
    };
    let cut_out = (!mesh.cut_out.is_empty()).then(|| {
        mesh.cut_out
            .iter()
            .map(|outline| {
                let mut path = String::new();
                for (i, p) in outline.iter().enumerate() {
                    let u = unit((p[0] - lo[0]) / width);
                    let v = unit((p[1] - lo[2]) / depth);
                    path.push_str(&format!("{}{u},{v} ", if i == 0 { "M" } else { "L" }));
                }
                path.push('Z');
                path
            })
            .collect::<Vec<_>>()
            .join(" ")
    });

    let positions: Vec<[f64; 3]> = mesh
        .positions
        .iter()
        .map(|p| [p[0] - offset[0], p[1], p[2] - offset[1]])
        .collect();
    let triangles: Vec<ModelTriangle> = mesh
        .triangles
        .iter()
        .map(|t| ModelTriangle {
            corners: t.corners,
            normal: t.normal,
            part: usize::from(t.part == Part::Frame),
        })
        .collect();
    let parts = vec![
        ModelPart {
            name: "stair_steps",
            color: rgb(&data.color)?,
            texture: data.texture.clone().zip(image),
        },
        ModelPart {
            name: "stair_frame",
            color: rgb(&data.frame_color)?,
            texture: None,
        },
    ];
    let (model, model_size) = store_model(doc, "stair", &positions, &mesh.uvs, &triangles, parts);
    Ok(Generated {
        model,
        model_size,
        size: [width, depth, hi[1] - lo[1].min(0.0)],
        offset,
        cut_out,
    })
}

fn turned(p: P2, angle: f64) -> P2 {
    let (sin, cos) = angle.sin_cos();
    [p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos]
}

/// Puts a generated stair into its piece so that it starts at `start` in the plan.
fn place(piece: &mut Piece, generated: &Generated, data: &StairData, start: P2) {
    let a = &mut piece.attrs;
    let angle = f64::from(a.angle_or_default());
    let middle = turned(generated.offset, angle);
    a.x = round(start[0] + middle[0]) as f32;
    a.y = round(start[1] + middle[1]) as f32;
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
    a.model_mirrored = None;
    // The steps fit only their own measures
    a.resizable = Some(false);
    a.staircase_cut_out_shape = generated.cut_out.clone();
    set_property(
        piece,
        STAIR_PROPERTY,
        Some(serde_json::to_string(data).unwrap_or_default()),
    );
}

/// Riser height, tread, step length and failed checks of a stair, for results.
fn checks(data: &StairData) -> serde_json::Value {
    let riser = data.rise / f64::from(data.risers);
    json!({
        "shape": data.shape,
        "risers": data.risers,
        "riser": round(riser),
        "tread": round(data.tread),
        "step_length": round(2.0 * riser + data.tread),
        "flights": data.flights,
        "warnings": data.warnings,
    })
}

fn result(piece: &Piece, data: &StairData) -> serde_json::Value {
    let a = &piece.attrs;
    let mut out = json!({
        "id": a.id,
        "x": a.x,
        "y": a.y,
        "width": a.width,
        "depth": a.depth,
        "height": a.height,
        "cut_out": a.staircase_cut_out_shape.is_some(),
    });
    if let (Some(out), serde_json::Value::Object(more)) = (out.as_object_mut(), checks(data)) {
        out.extend(more);
    }
    out
}

fn stair_data(piece: &Piece) -> Option<StairData> {
    property_data(piece, STAIR_PROPERTY)
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "stair_add",
        "Adds a stair made from its measures: straight, L shaped with a quarter landing, U shaped \
         with a half landing, or spiral; solid or open, with handrails. Riser count and tread \
         follow from the height to the next level by the step rule unless given. The stair is \
         a staircase with a generated model: it cuts the hole it needs in the floor above, in \
         Sweet Home 3D too; stair_update changes it.",
        true,
        |doc, p: AddParams| {
            if !(p.x.is_finite() && p.y.is_finite()) {
                return Err(CommandError::failed("x and y must be numbers"));
            }
            let level = resolve_level(doc.home(), p.level.clone())?;
            let (rise, _) = level_rise(doc.home(), level.as_deref());
            let rise = limited("rise", p.measures.rise, 20.0, 2000.0)?.unwrap_or(rise);
            let mut data = default_data(&p.measures, rise);
            data.apply(&p.measures)?;
            if let Some(c) = &p.color {
                parse_color(c)?;
                data.color = c.clone();
            }
            if let Some(c) = &p.frame_color {
                parse_color(c)?;
                data.frame_color = c.clone();
            }
            let mut image = None;
            set_texture(&mut data.texture, &mut image, &p.texture, "steps")?;
            let cut = cut_from(doc.home(), level.as_deref(), data.rise);
            let generated = generate(doc, &mut data, image, cut)?;
            let icon = doc.add_or_reuse_content(crate::model_package::placeholder_icon());
            let angle = limited("angle_deg", p.angle_deg, -100_000.0, 100_000.0)?
                .unwrap_or(0.0)
                .to_radians()
                .rem_euclid(std::f64::consts::TAU);
            let mut piece = Piece {
                kind: PieceKind::Piece,
                attrs: PieceAttrs {
                    id: Some(new_id("pieceOfFurniture")),
                    level,
                    name: p.name.clone().unwrap_or_else(|| "Stairs".into()),
                    icon: Some(icon),
                    angle: (angle.abs() > 1e-9).then_some(angle as f32),
                    ..Default::default()
                },
                ..Default::default()
            };
            place(
                &mut piece,
                &generated,
                &data,
                [f64::from(p.x), f64::from(p.y)],
            );
            let out = result(&piece, &data);
            doc.home_mut()
                .furniture
                .push(Furniture::Piece(Box::new(piece)));
            Ok(out)
        },
    );
    r.add(
        "stair_update",
        "Changes a stair made by stair_add: its shape, turn, measures, style, handrails, colors \
         or texture. A new rise sets the riser count and a new riser height the tread, unless \
         they are given too. The stair keeps its start; move and turn it with furniture_update.",
        true,
        |doc, p: UpdateParams| {
            let piece = find_piece_mut(doc, &p.id)?;
            let Some(mut data) = stair_data(piece) else {
                return Err(CommandError::failed(format!(
                    "'{}' is not a stair made by stair_add",
                    piece.attrs.name
                )));
            };
            let a = &piece.attrs;
            let angle = f64::from(a.angle_or_default());
            let start = turned(data.start, angle);
            let start = [f64::from(a.x) + start[0], f64::from(a.y) + start[1]];
            let level = a.level.clone();
            let model = a.model.clone();
            let mut image = kept_image(doc, model.as_deref(), &data.texture);
            data.apply(&p.measures)?;
            if let Some(c) = &p.color {
                parse_color(c)?;
                data.color = c.clone();
            }
            if let Some(c) = &p.frame_color {
                parse_color(c)?;
                data.frame_color = c.clone();
            }
            set_texture(&mut data.texture, &mut image, &p.texture, "steps")?;
            let cut = cut_from(doc.home(), level.as_deref(), data.rise);
            let generated = generate(doc, &mut data, image, cut)?;
            let piece = find_piece_mut(doc, &p.id)?;
            place(piece, &generated, &data, start);
            Ok(result(piece, &data))
        },
    );
    r.add(
        "stair_calc",
        "Works out a stair without adding it: riser count, riser height, tread, step length \
         (2 × riser + tread), the checks it does not pass (riser 14–20 cm, tread 23–37 cm, step \
         length 59–65 cm, headroom of a spiral stair) and its outline seen from above, with its \
         start at the origin and climbing towards -y.",
        false,
        |doc, p: CalcParams| {
            let level = resolve_level(doc.home(), p.level.clone())?;
            let (rise, _) = level_rise(doc.home(), level.as_deref());
            let rise = limited("rise", p.measures.rise, 20.0, 2000.0)?.unwrap_or(rise);
            let mut data = default_data(&p.measures, rise);
            data.apply(&p.measures)?;
            let spec = data.spec(f64::MAX);
            let mesh = stair::stair(&spec).map_err(|e| CommandError::failed(e.to_string()))?;
            data.warnings = stair::warnings(&spec);
            let (lo, hi) = mesh.bounds();
            data.flights = flights(&data);
            let mut out = checks(&data);
            out["rise"] = json!(round(data.rise));
            out["width"] = json!(round(hi[0] - lo[0]));
            out["depth"] = json!(round(hi[2] - lo[2]));
            out["footprint"] = json!(
                mesh.footprint
                    .iter()
                    .map(|p| [round(p[0]), round(p[1])])
                    .collect::<Vec<_>>()
            );
            Ok(out)
        },
    );
}
