//! Dimension chains along a wall, the style of all dimensions of a home, and elevation marks.

use super::{new_id, resolve_level};
use crate::registry::{CommandError, Registry};
use msh_export::{
    DIMENSION_STYLE_PROPERTY, DimensionStyle, DimensionUnit, EndMark, dimension_style,
};
use msh_geometry::chain::{self, RowKind, Side, WallChain};
use msh_model::{DimensionLine, DimensionLineAttrs, Home, Label, LabelAttrs, Property};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Property of a dimension line with the chain it belongs to, as JSON (our own; Sweet Home 3D
/// keeps it and shows the dimension line).
pub const CHAIN_PROPERTY: &str = "mySweetHome.dimensionChain";
/// Property of a label that is an elevation mark, as JSON (our own; Sweet Home 3D shows the
/// text).
pub const ELEVATION_MARK_PROPERTY: &str = "mySweetHome.elevationMark";

/// Distance of the first row of a chain from the wall and of each row from the next, in cm.
const DEFAULT_DISTANCE: f64 = 60.0;
const DEFAULT_SPACING: f64 = 45.0;
/// Font size of elevation marks in cm, as of texts.
const DEFAULT_FONT: f32 = 18.0;

// ---------------------------------------------------------------- Parameters

#[derive(Deserialize, JsonSchema, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum SideParam {
    Left,
    Right,
}

impl From<SideParam> for Side {
    fn from(s: SideParam) -> Self {
        match s {
            SideParam::Left => Side::Left,
            SideParam::Right => Side::Right,
        }
    }
}

#[derive(Deserialize, JsonSchema, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum RowParam {
    /// Doors, windows and the wall between them
    Openings,
    /// Adjoining walls and the space between them
    Walls,
    /// The whole length
    Total,
}

impl From<RowParam> for RowKind {
    fn from(r: RowParam) -> Self {
        match r {
            RowParam::Openings => RowKind::Openings,
            RowParam::Walls => RowKind::Walls,
            RowParam::Total => RowKind::Total,
        }
    }
}

#[derive(Deserialize, JsonSchema)]
struct ChainAddParams {
    /// ID of a straight wall; walls that continue its face belong to the chain. Give a wall or
    /// points
    wall: Option<String>,
    /// Side of the wall seen from its start to its end (default: the side outside the house)
    side: Option<SideParam>,
    /// Rows from the wall outwards: "openings", "walls", "total" (default: all that measure
    /// something)
    rows: Option<Vec<RowParam>>,
    /// Points to measure between, in order, as [[x, y], ...]; the dimensions run in the
    /// direction from the first to the last point
    points: Option<Vec<[f32; 2]>>,
    /// Distance of the first row from the wall in cm (default 60); with points the distance of
    /// the dimension line from the first point, positive or negative for the two sides
    distance: Option<f32>,
    /// Distance of each row from the next in cm (default 45)
    spacing: Option<f32>,
    /// Level of a chain of points (default: selected level)
    level: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct ChainCalcParams {
    /// ID of a straight wall
    wall: String,
}

#[derive(Deserialize, JsonSchema)]
struct ChainUpdateParams {
    /// ID of any dimension line of a chain along a wall
    id: String,
    /// Side of the wall seen from its start to its end
    side: Option<SideParam>,
    /// Rows from the wall outwards: "openings", "walls", "total"
    rows: Option<Vec<RowParam>>,
    /// Distance of the first row from the wall in cm
    distance: Option<f32>,
    /// Distance of each row from the next in cm
    spacing: Option<f32>,
}

#[derive(Deserialize, JsonSchema, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum MarkParam {
    Slash,
    Arrow,
    Dot,
    None,
}

#[derive(Deserialize, JsonSchema, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum UnitParam {
    /// The unit of the preferences in the app, m from 1 m on and cm below in files
    Auto,
    Mm,
    Cm,
    M,
    /// DIN 1356: cm below 1 m, else m, millimeters raised, no unit
    Din,
}

#[derive(Deserialize, JsonSchema)]
struct StyleParams {
    /// Mark at the ends: "slash" (default), "arrow", "dot" or "none"
    mark: Option<MarkParam>,
    /// Unit of the lengths: "auto" (default), "mm", "cm", "m" or "din" (cm below 1 m, else m,
    /// millimeters raised, no unit)
    unit: Option<UnitParam>,
    /// Decimals of mm, cm and m, 0 to 4; -1 for the default (0, 1 and 2)
    decimals: Option<i32>,
    /// Write the unit behind mm, cm and m (default true)
    show_unit: Option<bool>,
    /// Decimal comma instead of a point in files and elevation marks (default false)
    comma: Option<bool>,
    /// Text size in cm of dimensions without a text style of their own; 0 for the default (18)
    font_size: Option<f32>,
    /// Go back to the default style first (default false)
    reset: Option<bool>,
}

#[derive(Serialize, Deserialize, JsonSchema, Clone, Copy, PartialEq, Debug, Default)]
#[serde(rename_all = "snake_case")]
enum MarkKind {
    /// Finished floor: an open triangle
    #[default]
    Finished,
    /// Unfinished floor: a filled triangle
    Raw,
}

#[derive(Deserialize, JsonSchema)]
struct ElevationAddParams {
    x: f32,
    y: f32,
    /// Height above the floor of the level in cm (default 0); the mark shows the elevation of
    /// the level plus this height
    height: Option<f32>,
    /// "finished" (default, open triangle) or "raw" (filled triangle)
    kind: Option<MarkKind>,
    /// Font size in cm (default 18)
    font_size: Option<f32>,
    /// Decimal comma instead of a point (default: as the dimension style of the home)
    comma: Option<bool>,
    level: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct ElevationUpdateParams {
    /// ID of the elevation mark
    id: String,
    /// Height above the floor of the level in cm
    height: Option<f32>,
    /// "finished" (open triangle) or "raw" (filled triangle)
    kind: Option<MarkKind>,
}

// ---------------------------------------------------------------- Stored data

/// The chain a dimension line belongs to, as stored in [`CHAIN_PROPERTY`].
#[derive(Serialize, Deserialize, Clone, Debug)]
struct ChainData {
    /// Shared by the dimension lines of a chain
    id: String,
    /// Wall it runs along; a chain of points has none
    #[serde(default, skip_serializing_if = "Option::is_none")]
    wall: Option<String>,
    side: Side,
    /// Rows asked for (all that measure something without)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rows: Option<Vec<RowKind>>,
    distance: f64,
    spacing: f64,
}

/// What an elevation mark shows, as stored in [`ELEVATION_MARK_PROPERTY`].
#[derive(Serialize, Deserialize, Clone, Debug)]
struct MarkData {
    height: f32,
    #[serde(default)]
    kind: MarkKind,
    /// Decimal comma even if the dimension style has none
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    comma: bool,
}

fn property<'a>(properties: &'a [Property], name: &str) -> Option<&'a str> {
    properties
        .iter()
        .find(|p| p.name == name)
        .map(|p| p.value.as_str())
}

fn put(properties: &mut Vec<Property>, name: &str, value: Option<String>) {
    properties.retain(|p| p.name != name);
    if let Some(value) = value {
        properties.push(Property {
            name: name.into(),
            value,
            kind: None,
            ..Default::default()
        });
    }
}

fn chain_data(d: &DimensionLine) -> Option<ChainData> {
    serde_json::from_str(property(&d.properties, CHAIN_PROPERTY)?).ok()
}

fn mark_data(l: &Label) -> Option<MarkData> {
    serde_json::from_str(property(&l.properties, ELEVATION_MARK_PROPERTY)?).ok()
}

/// A copy of a dimension line stands alone: it no longer belongs to the chain of the original.
pub(crate) fn leave_chain(d: &mut DimensionLine) {
    put(&mut d.properties, CHAIN_PROPERTY, None);
}

/// A label with a text of its own is no elevation mark any more.
pub(super) fn leave_elevation_mark(l: &mut Label) {
    put(&mut l.properties, ELEVATION_MARK_PROPERTY, None);
}

// ---------------------------------------------------------------- Chains

fn finite(name: &str, v: f32) -> Result<f64, CommandError> {
    if v.is_finite() {
        Ok(f64::from(v))
    } else {
        Err(CommandError::failed(format!("{name} must be a number")))
    }
}

fn positive(name: &str, v: Option<f32>, default: f64) -> Result<f64, CommandError> {
    match v {
        None => Ok(default),
        Some(v) => {
            let v = finite(name, v)?;
            if (1.0..=100_000.0).contains(&v) {
                Ok(v)
            } else {
                Err(CommandError::failed(format!(
                    "{name} must be between 1 and 100000 cm"
                )))
            }
        }
    }
}

fn round2(v: f64) -> f32 {
    ((v * 100.0).round() / 100.0) as f32
}

fn line(
    level: Option<String>,
    from: [f64; 2],
    to: [f64; 2],
    offset: f64,
    data: &ChainData,
) -> DimensionLine {
    let mut d = DimensionLine {
        attrs: DimensionLineAttrs {
            id: Some(new_id("dimensionLine")),
            level,
            x_start: round2(from[0]),
            y_start: round2(from[1]),
            x_end: round2(to[0]),
            y_end: round2(to[1]),
            offset: round2(offset),
            ..Default::default()
        },
        ..Default::default()
    };
    put(
        &mut d.properties,
        CHAIN_PROPERTY,
        serde_json::to_string(data).ok(),
    );
    d
}

/// The rows of a chain that were asked for, in the order from the wall outwards.
fn chosen<'a>(chain: &'a WallChain, rows: &Option<Vec<RowKind>>) -> Vec<&'a chain::ChainRow> {
    chain
        .rows
        .iter()
        .filter(|r| rows.as_ref().is_none_or(|rows| rows.contains(&r.kind)))
        .collect()
}

/// The dimension lines of a chain along a wall.
fn wall_lines(home: &Home, data: &ChainData) -> Result<Vec<DimensionLine>, CommandError> {
    let wall_id = data.wall.as_deref().unwrap_or_default();
    let chain = chain::wall_chain(home, wall_id, data.side)
        .map_err(|e| CommandError::failed(e.to_string()))?;
    let level = home
        .walls
        .iter()
        .find(|w| w.attrs.id == wall_id)
        .and_then(|w| w.attrs.level.clone());
    let rows = chosen(&chain, &data.rows);
    if rows.is_empty() {
        return Err(CommandError::failed(
            "none of the rows measures something on this wall",
        ));
    }
    let mut lines = Vec::new();
    for (k, row) in rows.iter().enumerate() {
        let offset = chain.offset(data.distance + k as f64 * data.spacing);
        for pair in row.stations.windows(2) {
            lines.push(line(
                level.clone(),
                chain.point(pair[0]),
                chain.point(pair[1]),
                offset,
                data,
            ));
        }
    }
    Ok(lines)
}

/// The dimension lines between points, measured in the direction from the first to the last.
fn point_lines(
    points: &[[f32; 2]],
    distance: f64,
    level: Option<String>,
    data: &ChainData,
) -> Result<Vec<DimensionLine>, CommandError> {
    let p: Vec<[f64; 2]> = points
        .iter()
        .map(|q| Ok([finite("points", q[0])?, finite("points", q[1])?]))
        .collect::<Result<_, CommandError>>()?;
    let too_few = || CommandError::failed("a chain needs at least 2 points at different places");
    let (Some(first), Some(last)) = (p.first(), p.last()) else {
        return Err(too_few());
    };
    let len = (last[0] - first[0]).hypot(last[1] - first[1]);
    if p.len() < 2 || len < 0.1 {
        return Err(too_few());
    }
    let dir = [(last[0] - first[0]) / len, (last[1] - first[1]) / len];
    let mut stations: Vec<f64> = p
        .iter()
        .map(|q| (q[0] - first[0]) * dir[0] + (q[1] - first[1]) * dir[1])
        .collect();
    stations.sort_by(f64::total_cmp);
    stations.dedup_by(|a, b| (*a - *b).abs() < 0.1);
    let at = |t: f64| [first[0] + dir[0] * t, first[1] + dir[1] * t];
    Ok(stations
        .windows(2)
        .map(|w| line(level.clone(), at(w[0]), at(w[1]), distance, data))
        .collect())
}

fn ids(lines: &[DimensionLine]) -> Vec<String> {
    lines.iter().filter_map(|d| d.attrs.id.clone()).collect()
}

fn side_json(home: &Home, wall: &str, side: Side) -> Result<Value, CommandError> {
    let chain =
        chain::wall_chain(home, wall, side).map_err(|e| CommandError::failed(e.to_string()))?;
    let rows: Vec<Value> = chain
        .rows
        .iter()
        .map(|r| {
            let points: Vec<[f32; 2]> = r
                .stations
                .iter()
                .map(|t| chain.point(*t).map(round2))
                .collect();
            json!({ "kind": r.kind, "points": points })
        })
        .collect();
    Ok(json!({
        "normal": chain.normal,
        "face": round2(chain.face),
        "sign": if chain.offset(1.0) > 0.0 { 1 } else { -1 },
        "rows": rows,
    }))
}

// ---------------------------------------------------------------- Elevation marks

fn mark_text(home: &Home, level: Option<&str>, data: &MarkData, style: &DimensionStyle) -> String {
    let floor = level
        .and_then(|id| home.levels.iter().find(|l| l.attrs.id == id))
        .map_or(0.0, |l| l.attrs.elevation);
    let symbol = match data.kind {
        MarkKind::Finished => '\u{25bd}',
        MarkKind::Raw => '\u{25bc}',
    };
    let style = DimensionStyle {
        comma: style.comma || data.comma,
        ..style.clone()
    };
    format!("{symbol} {}", style.format_elevation(floor + data.height))
}

/// The labels whose text no longer says the elevation they mark: index and new text.
fn stale_marks(home: &Home) -> Vec<(usize, String)> {
    if !home
        .labels
        .iter()
        .any(|l| property(&l.properties, ELEVATION_MARK_PROPERTY).is_some())
    {
        return Vec::new();
    }
    let style = dimension_style(home);
    home.labels
        .iter()
        .enumerate()
        .filter_map(|(i, l)| {
            let text = mark_text(home, l.attrs.level.as_deref(), &mark_data(l)?, &style);
            (text != l.text).then_some((i, text))
        })
        .collect()
}

/// Writes the elevations of all elevation marks anew after a command changed the home: the
/// elevation of a level, the level of a mark or the style.
pub(crate) fn refresh_elevation_marks(doc: &mut crate::Document) {
    let stale = stale_marks(doc.home());
    if stale.is_empty() {
        return;
    }
    let home = doc.home_mut();
    for (i, text) in stale {
        home.labels[i].text = text;
    }
}

// ---------------------------------------------------------------- Commands

pub(super) fn register(r: &mut Registry) {
    r.add(
        "dimension_chain_add",
        "Adds a dimension chain along a straight wall: a row for its doors and windows, one for the \
         adjoining walls and one for the whole length, with the walls that continue its face. Or a \
         chain of dimensions between points. dimension_chain_update measures it again.",
        true,
        |doc, p: ChainAddParams| {
            let spacing = positive("spacing", p.spacing, DEFAULT_SPACING)?;
            let mut data = ChainData {
                id: new_id("chain"),
                wall: p.wall.clone(),
                side: Side::Left,
                rows: p
                    .rows
                    .map(|rows| rows.into_iter().map(RowKind::from).collect()),
                distance: DEFAULT_DISTANCE,
                spacing,
            };
            let lines = match (&p.wall, &p.points) {
                (Some(wall), None) => {
                    data.distance = positive("distance", p.distance, DEFAULT_DISTANCE)?;
                    data.side = match p.side {
                        Some(side) => side.into(),
                        None => doc
                            .home()
                            .walls
                            .iter()
                            .find(|w| &w.attrs.id == wall)
                            .map_or(Side::Left, |w| chain::outer_side(doc.home(), w)),
                    };
                    wall_lines(doc.home(), &data)?
                }
                (None, Some(points)) => {
                    data.distance = match p.distance {
                        Some(v) => finite("distance", v)?,
                        None => DEFAULT_DISTANCE,
                    };
                    let level = resolve_level(doc.home(), p.level.clone())?;
                    point_lines(points, data.distance, level, &data)?
                }
                _ => {
                    return Err(CommandError::failed("give either a wall or points"));
                }
            };
            let ids = ids(&lines);
            doc.home_mut().dimension_lines.extend(lines);
            Ok(json!({ "ids": ids, "chain": data.id }))
        },
    );
    r.add(
        "dimension_chain_calc",
        "Works out the dimension chains on both sides of a straight wall without adding them: \
         the points each row measures between, and which side is outside the house.",
        false,
        |doc, p: ChainCalcParams| {
            let home = doc.home();
            let outside = home
                .walls
                .iter()
                .find(|w| w.attrs.id == p.wall)
                .map(|w| chain::outer_side(home, w));
            Ok(json!({
                "outside": outside,
                "left": side_json(home, &p.wall, Side::Left)?,
                "right": side_json(home, &p.wall, Side::Right)?,
            }))
        },
    );
    r.add(
        "dimension_chain_update",
        "Measures a dimension chain along a wall again, after the wall, its doors and windows or \
         the adjoining walls changed, and changes its side, rows or distances. Its dimension lines \
         are replaced; color and text style stay.",
        true,
        |doc, p: ChainUpdateParams| {
            let home = doc.home();
            let first = home
                .dimension_lines
                .iter()
                .find(|d| d.attrs.id.as_deref() == Some(p.id.as_str()))
                .ok_or_else(|| {
                    CommandError::failed(format!("unknown dimension line '{}'", p.id))
                })?;
            let Some(mut data) = chain_data(first).filter(|c| c.wall.is_some()) else {
                return Err(CommandError::failed(format!(
                    "dimension line '{}' does not belong to a chain along a wall",
                    p.id
                )));
            };
            let (color, text_style) = (first.attrs.color, first.text_style.clone());
            if let Some(side) = p.side {
                data.side = side.into();
            }
            if let Some(rows) = p.rows {
                data.rows = Some(rows.into_iter().map(RowKind::from).collect());
            }
            data.distance = positive("distance", p.distance, data.distance)?;
            data.spacing = positive("spacing", p.spacing, data.spacing)?;
            let mut lines = wall_lines(home, &data)?;
            for d in &mut lines {
                d.attrs.color = color;
                d.text_style.clone_from(&text_style);
            }
            let ids = ids(&lines);
            let home = doc.home_mut();
            home.dimension_lines
                .retain(|d| chain_data(d).is_none_or(|c| c.id != data.id));
            home.dimension_lines.extend(lines);
            Ok(json!({ "ids": ids, "chain": data.id }))
        },
    );
    r.add(
        "dimension_style_set",
        "Sets how all dimensions of the home look: marks at their ends, unit and decimals of their \
         lengths (also DIN 1356 with raised millimeters) and the text size. Sweet Home 3D keeps the \
         style and shows the dimensions in its own.",
        true,
        |doc, p: StyleParams| {
            let mut style = if p.reset == Some(true) {
                DimensionStyle::default()
            } else {
                dimension_style(doc.home())
            };
            if let Some(m) = p.mark {
                style.mark = match m {
                    MarkParam::Slash => EndMark::Slash,
                    MarkParam::Arrow => EndMark::Arrow,
                    MarkParam::Dot => EndMark::Dot,
                    MarkParam::None => EndMark::None,
                };
            }
            if let Some(u) = p.unit {
                style.unit = match u {
                    UnitParam::Auto => DimensionUnit::Auto,
                    UnitParam::Mm => DimensionUnit::Mm,
                    UnitParam::Cm => DimensionUnit::Cm,
                    UnitParam::M => DimensionUnit::M,
                    UnitParam::Din => DimensionUnit::Din,
                };
            }
            if let Some(d) = p.decimals {
                style.decimals = match d {
                    ..0 => None,
                    0..=4 => Some(d as u8),
                    _ => return Err(CommandError::failed("decimals must be 0 to 4, or -1")),
                };
            }
            if let Some(v) = p.show_unit {
                style.show_unit = v;
            }
            if let Some(v) = p.comma {
                style.comma = v;
            }
            if let Some(v) = p.font_size {
                if !v.is_finite() || !(0.0..=1000.0).contains(&v) {
                    return Err(CommandError::failed(
                        "font_size must be between 0 and 1000 cm",
                    ));
                }
                style.font_size = (v > 0.0).then_some(v);
            }
            let value =
                (style != DimensionStyle::default()).then(|| serde_json::to_string(&style));
            put(
                &mut doc.home_mut().properties,
                DIMENSION_STYLE_PROPERTY,
                value.and_then(Result::ok),
            );
            Ok(json!(style))
        },
    );
    r.add(
        "elevation_mark_add",
        "Adds an elevation mark to the plan: a triangle with the elevation in m, e.g. +2.62, which \
         follows the elevation of its level. It is a text label, so Sweet Home 3D shows it too.",
        true,
        |doc, p: ElevationAddParams| {
            let height = finite("height", p.height.unwrap_or(0.0))? as f32;
            finite("x", p.x)?;
            finite("y", p.y)?;
            let size = p.font_size.unwrap_or(DEFAULT_FONT);
            if !size.is_finite() || size <= 0.0 {
                return Err(CommandError::failed("font size must be positive"));
            }
            let level = resolve_level(doc.home(), p.level)?;
            let data = MarkData {
                height,
                kind: p.kind.unwrap_or_default(),
                comma: p.comma.unwrap_or(false),
            };
            let style = dimension_style(doc.home());
            let text = mark_text(doc.home(), level.as_deref(), &data, &style);
            let id = new_id("label");
            let mut label = Label {
                attrs: LabelAttrs {
                    id: Some(id.clone()),
                    level,
                    x: p.x,
                    y: p.y,
                    ..Default::default()
                },
                text_style: p.font_size.map(|size| msh_model::TextStyle {
                    font_size: size,
                    ..Default::default()
                }),
                text: text.clone(),
                ..Default::default()
            };
            put(
                &mut label.properties,
                ELEVATION_MARK_PROPERTY,
                serde_json::to_string(&data).ok(),
            );
            doc.home_mut().labels.push(label);
            Ok(json!({ "id": id, "text": text }))
        },
    );
    r.add(
        "elevation_mark_update",
        "Changes the height or the kind of an elevation mark. Move it with edit_move, change its \
         size and color with label_update; a text of its own makes it an ordinary label.",
        true,
        |doc, p: ElevationUpdateParams| {
            let home = doc.home();
            let index = home
                .labels
                .iter()
                .position(|l| l.attrs.id.as_deref() == Some(p.id.as_str()))
                .ok_or_else(|| CommandError::failed(format!("unknown label '{}'", p.id)))?;
            let Some(mut data) = mark_data(&home.labels[index]) else {
                return Err(CommandError::failed(format!(
                    "label '{}' is no elevation mark",
                    p.id
                )));
            };
            if let Some(h) = p.height {
                data.height = finite("height", h)? as f32;
            }
            if let Some(kind) = p.kind {
                data.kind = kind;
            }
            let level = home.labels[index].attrs.level.clone();
            let text = mark_text(home, level.as_deref(), &data, &dimension_style(home));
            let label = &mut doc.home_mut().labels[index];
            label.text.clone_from(&text);
            put(
                &mut label.properties,
                ELEVATION_MARK_PROPERTY,
                serde_json::to_string(&data).ok(),
            );
            Ok(json!({ "id": p.id, "text": text }))
        },
    );
}
