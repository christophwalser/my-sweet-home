//! Labels and dimension lines.

use super::{new_id, parse_color, rad, resolve_level};
use crate::registry::{CommandError, Registry};
use msh_model::{
    Color, DimensionLine, DimensionLineAttrs, Label, LabelAttrs, Point, Polyline, PolylineAttrs,
    TextStyle,
};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize, JsonSchema)]
struct LabelParams {
    /// Text; may contain line breaks
    text: String,
    x: f32,
    y: f32,
    /// Font size in cm (default 18)
    font_size: Option<f32>,
    angle_deg: Option<f32>,
    /// Text color as #RRGGBB
    color: Option<String>,
    level: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct DimensionParams {
    x_start: f32,
    y_start: f32,
    x_end: f32,
    y_end: f32,
    /// Distance of the dimension line from the measured points in cm (default 20)
    offset: Option<f32>,
    level: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct DimensionUpdateParams {
    id: String,
    x_start: Option<f32>,
    y_start: Option<f32>,
    x_end: Option<f32>,
    y_end: Option<f32>,
    /// Distance of the dimension line from the measured points in cm
    offset: Option<f32>,
    /// Text style of the length: size in cm, font family ("" = default), bold, italic
    font_size: Option<f32>,
    font_name: Option<String>,
    bold: Option<bool>,
    italic: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
struct HeightDimensionParams {
    /// Point in the plan where the height is measured (cm)
    x: f32,
    y: f32,
    /// Lower and upper end of the measured height in cm above the level (default 0)
    elevation_start: Option<f32>,
    elevation_end: f32,
    /// Distance of the dimension line from the point in cm (default 20)
    offset: Option<f32>,
    level: Option<String>,
}

#[derive(Deserialize, JsonSchema, Clone, Copy)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum DashStyle {
    Solid,
    Dot,
    Dash,
    DashDot,
    DashDotDot,
}

#[derive(Deserialize, JsonSchema, Clone, Copy)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ArrowStyle {
    None,
    Delta,
    Open,
    Disc,
}

impl DashStyle {
    fn as_str(self) -> &'static str {
        match self {
            Self::Solid => "SOLID",
            Self::Dot => "DOT",
            Self::Dash => "DASH",
            Self::DashDot => "DASH_DOT",
            Self::DashDotDot => "DASH_DOT_DOT",
        }
    }
}

impl ArrowStyle {
    fn as_str(self) -> &'static str {
        match self {
            Self::None => "NONE",
            Self::Delta => "DELTA",
            Self::Open => "OPEN",
            Self::Disc => "DISC",
        }
    }
}

#[derive(Deserialize, JsonSchema)]
struct PolylineParams {
    /// Points as [[x, y], ...] in cm (at least 2)
    points: Vec<[f32; 2]>,
    /// Connect the last point to the first
    closed: Option<bool>,
    /// Line thickness in cm (default 2)
    thickness: Option<f32>,
    /// Color as #RRGGBB (default black)
    color: Option<String>,
    dash_style: Option<DashStyle>,
    start_arrow: Option<ArrowStyle>,
    end_arrow: Option<ArrowStyle>,
    /// Smooth curve through the points instead of straight segments
    curved: Option<bool>,
    level: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct PolylineUpdateParams {
    id: String,
    points: Option<Vec<[f32; 2]>>,
    closed: Option<bool>,
    thickness: Option<f32>,
    color: Option<String>,
    dash_style: Option<DashStyle>,
    start_arrow: Option<ArrowStyle>,
    end_arrow: Option<ArrowStyle>,
    /// Smooth curve through the points instead of straight segments
    curved: Option<bool>,
}

/// Join style of polylines drawn as curves (Sweet Home 3D's `CURVED`).
fn join_style(curved: bool) -> String {
    if curved { "CURVED" } else { "MITER" }.into()
}

/// Thickness of new polylines in cm.
const DEFAULT_POLYLINE_THICKNESS: f32 = 2.0;

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

#[derive(Deserialize, JsonSchema)]
struct LabelUpdateParams {
    id: String,
    text: Option<String>,
    x: Option<f32>,
    y: Option<f32>,
    font_size: Option<f32>,
    angle_deg: Option<f32>,
    color: Option<String>,
    /// Font family ("" = default font), bold, italic
    font_name: Option<String>,
    bold: Option<bool>,
    italic: Option<bool>,
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "polyline_add",
        "Adds a polyline (free line drawing in the plan, e.g. for arrows or outlines).",
        true,
        |doc, p: PolylineParams| {
            if p.points.len() < 2 {
                return Err(CommandError::failed("a polyline needs at least 2 points"));
            }
            let level = resolve_level(doc.home(), p.level)?;
            let id = new_id("polyline");
            let closed = p.closed.unwrap_or(false) && p.points.len() >= 3;
            doc.home_mut().polylines.push(Polyline {
                attrs: PolylineAttrs {
                    id: Some(id.clone()),
                    level,
                    thickness: Some(p.thickness.unwrap_or(DEFAULT_POLYLINE_THICKNESS)),
                    cap_style: Some("BUTT".into()),
                    join_style: Some(join_style(p.curved.unwrap_or(false))),
                    dash_style: Some(p.dash_style.unwrap_or(DashStyle::Solid).as_str().into()),
                    start_arrow_style: Some(
                        p.start_arrow.unwrap_or(ArrowStyle::None).as_str().into(),
                    ),
                    end_arrow_style: Some(p.end_arrow.unwrap_or(ArrowStyle::None).as_str().into()),
                    color: Some(match &p.color {
                        Some(c) => parse_color(c)?,
                        None => Color(0xFF00_0000),
                    }),
                    closed_path: Some(closed),
                    ..Default::default()
                },
                points: to_points(&p.points),
                ..Default::default()
            });
            Ok(json!({ "id": id }))
        },
    );
    r.add(
        "polyline_update",
        "Changes points, thickness, color, dash style, arrows or curving of a polyline.",
        true,
        |doc, p: PolylineUpdateParams| {
            let pl = doc
                .home_mut()
                .polylines
                .iter_mut()
                .find(|l| l.attrs.id.as_deref() == Some(p.id.as_str()))
                .ok_or_else(|| CommandError::failed(format!("unknown polyline '{}'", p.id)))?;
            if let Some(points) = &p.points {
                if points.len() < 2 {
                    return Err(CommandError::failed("a polyline needs at least 2 points"));
                }
                pl.points = to_points(points);
            }
            let a = &mut pl.attrs;
            // Like polyline_add: two points cannot form a closed outline
            if let Some(v) = p.closed {
                a.closed_path = Some(v && pl.points.len() >= 3);
            }
            if let Some(v) = p.thickness {
                a.thickness = Some(v);
            }
            if let Some(c) = &p.color {
                a.color = Some(parse_color(c)?);
            }
            if let Some(v) = p.dash_style {
                a.dash_style = Some(v.as_str().into());
            }
            if let Some(v) = p.start_arrow {
                a.start_arrow_style = Some(v.as_str().into());
            }
            if let Some(v) = p.end_arrow {
                a.end_arrow_style = Some(v.as_str().into());
            }
            if let Some(v) = p.curved {
                a.join_style = Some(join_style(v));
            }
            Ok(json!({ "id": p.id }))
        },
    );
    r.add(
        "dimension_update",
        "Changes the measured points, the offset or the text style of a dimension line.",
        true,
        |doc, p: DimensionUpdateParams| {
            let d = doc
                .home_mut()
                .dimension_lines
                .iter_mut()
                .find(|d| d.attrs.id.as_deref() == Some(p.id.as_str()))
                .ok_or_else(|| {
                    CommandError::failed(format!("unknown dimension line '{}'", p.id))
                })?;
            let a = &mut d.attrs;
            macro_rules! set {
                ($($f:ident),*) => { $( if let Some(v) = p.$f { a.$f = v; } )* };
            }
            set!(x_start, y_start, x_end, y_end, offset);
            super::text::update_style(
                &mut d.text_style,
                18.0,
                &super::text::StyleChange {
                    size: p.font_size,
                    font: p.font_name.clone(),
                    bold: p.bold,
                    italic: p.italic,
                },
            )?;
            Ok(json!({ "id": p.id }))
        },
    );
    r.add(
        "label_update",
        "Changes text, position, angle, color or text style (size, font, bold, italic) of a label.",
        true,
        |doc, p: LabelUpdateParams| {
            let l = doc
                .home_mut()
                .labels
                .iter_mut()
                .find(|l| l.attrs.id.as_deref() == Some(p.id.as_str()))
                .ok_or_else(|| CommandError::failed(format!("unknown label '{}'", p.id)))?;
            if let Some(t) = p.text {
                if t.trim().is_empty() {
                    return Err(CommandError::failed("label text must not be empty"));
                }
                l.text = t;
            }
            if let Some(v) = p.x {
                l.attrs.x = v;
            }
            if let Some(v) = p.y {
                l.attrs.y = v;
            }
            if let Some(v) = p.angle_deg {
                l.attrs.angle = Some(rad(v));
            }
            if let Some(c) = &p.color {
                l.attrs.color = Some(parse_color(c)?);
            }
            super::text::update_style(
                &mut l.text_style,
                18.0,
                &super::text::StyleChange {
                    size: p.font_size,
                    font: p.font_name.clone(),
                    bold: p.bold,
                    italic: p.italic,
                },
            )?;
            Ok(json!({ "id": p.id }))
        },
    );
    r.add(
        "label_add",
        "Adds a text label to the plan.",
        true,
        |doc, p: LabelParams| {
            if p.text.trim().is_empty() {
                return Err(CommandError::failed("label text must not be empty"));
            }
            if p.font_size.is_some_and(|s| !s.is_finite() || s <= 0.0) {
                return Err(CommandError::failed("font size must be positive"));
            }
            let level = resolve_level(doc.home(), p.level)?;
            let id = new_id("label");
            let label = Label {
                attrs: LabelAttrs {
                    id: Some(id.clone()),
                    level,
                    x: p.x,
                    y: p.y,
                    angle: p.angle_deg.map(rad),
                    color: p.color.as_deref().map(parse_color).transpose()?,
                    ..Default::default()
                },
                text_style: p.font_size.map(|size| TextStyle {
                    font_size: size,
                    ..Default::default()
                }),
                text: p.text,
                ..Default::default()
            };
            doc.home_mut().labels.push(label);
            Ok(json!({ "id": id }))
        },
    );
    r.add(
        "dimension_add",
        "Adds a dimension line that shows the distance between two points.",
        true,
        |doc, p: DimensionParams| {
            let level = resolve_level(doc.home(), p.level)?;
            let id = new_id("dimensionLine");
            doc.home_mut().dimension_lines.push(DimensionLine {
                attrs: DimensionLineAttrs {
                    id: Some(id.clone()),
                    level,
                    x_start: p.x_start,
                    y_start: p.y_start,
                    x_end: p.x_end,
                    y_end: p.y_end,
                    offset: p.offset.unwrap_or(20.0),
                    ..Default::default()
                },
                ..Default::default()
            });
            Ok(json!({ "id": id }))
        },
    );
    r.add(
        "dimension_add_height",
        "Adds a height dimension: a vertical dimension line at a point of the plan between two \
         elevations (e.g. 0 and the height of a wall or a piece), shown in the plan and in 3D.",
        true,
        |doc, p: HeightDimensionParams| {
            let level = resolve_level(doc.home(), p.level)?;
            let start = p.elevation_start.unwrap_or(0.0);
            if (p.elevation_end - start).abs() < 0.1 {
                return Err(CommandError::failed(
                    "the measured height must be at least 0.1 cm",
                ));
            }
            let id = new_id("dimensionLine");
            doc.home_mut().dimension_lines.push(DimensionLine {
                attrs: DimensionLineAttrs {
                    id: Some(id.clone()),
                    level,
                    // Same point in the plan, different elevations: Sweet Home 3D's elevation
                    // dimension line
                    x_start: p.x,
                    y_start: p.y,
                    x_end: p.x,
                    y_end: p.y,
                    elevation_start: Some(start),
                    elevation_end: Some(p.elevation_end),
                    offset: p.offset.unwrap_or(20.0),
                    visible_in_3d: Some(true),
                    ..Default::default()
                },
                ..Default::default()
            });
            Ok(json!({ "id": id }))
        },
    );
}
