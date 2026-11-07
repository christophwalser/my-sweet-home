//! Labels and dimension lines.

use super::{new_id, parse_color, rad, resolve_level};
use crate::registry::Registry;
use msh_model::{DimensionLine, DimensionLineAttrs, Label, LabelAttrs, TextStyle};
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

pub(super) fn register(r: &mut Registry) {
    r.add(
        "label_add",
        "Adds a text label to the plan.",
        true,
        |doc, p: LabelParams| {
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
}
