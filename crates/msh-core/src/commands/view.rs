//! Visual feedback: plan image.

use crate::registry::{CommandError, Registry};
use base64::Engine;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize, JsonSchema, Default, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
enum ImageFormat {
    #[default]
    Png,
    Svg,
}

#[derive(Deserialize, JsonSchema)]
struct PlanImageParams {
    /// Level to draw (default: selected level, or everything if the home has no levels)
    level: Option<String>,
    /// Width of the PNG in pixels (default 1200)
    width: Option<u32>,
    /// "png" (default) or "svg"
    format: Option<ImageFormat>,
    /// Draw furniture names (default true)
    furniture_names: Option<bool>,
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "view_plan_image",
        "Renders the 2D plan (walls, rooms with names and areas, furniture with names, doors and \
         windows, dimensions, labels, 1 m scale bar) as an image, to check the result visually.",
        false,
        |doc, p: PlanImageParams| {
            let home = doc.home();
            let level = match p.level {
                Some(l) => Some(l),
                None if !home.levels.is_empty() => home
                    .attrs
                    .selected_level
                    .clone()
                    .or_else(|| home.levels.first().map(|l| l.attrs.id.clone())),
                None => None,
            };
            let opts = msh_export::PlanOptions {
                level,
                furniture_names: p.furniture_names.unwrap_or(true),
                ..Default::default()
            };
            let svg = msh_export::plan_svg(home, &opts);
            match p.format.unwrap_or_default() {
                ImageFormat::Svg => Ok(json!({ "mime_type": "image/svg+xml", "svg": svg })),
                ImageFormat::Png => {
                    let width = p.width.unwrap_or(1200).clamp(100, 4000);
                    let png = msh_export::svg_to_png(&svg, width).map_err(CommandError::failed)?;
                    Ok(json!({
                        "mime_type": "image/png",
                        "image_base64": base64::engine::general_purpose::STANDARD.encode(png),
                    }))
                }
            }
        },
    );
}
