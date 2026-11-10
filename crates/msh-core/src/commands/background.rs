//! Background image of the plan (a scanned or exported floor plan to trace).
//!
//! As in Sweet Home 3D, each level has its own background image; a home without levels has
//! one for the whole home. The scale comes from a marker between two image points (in image
//! pixels) and its real length; the origin is the position of the plan's (0, 0) on the image,
//! in cm from its top-left corner. The plan draws the image at `scale` cm per pixel, shifted
//! by the origin.

use crate::document::Document;
use crate::registry::{CommandError, Registry};
use base64::Engine;
use msh_model::BackgroundImage;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::PathBuf;

#[derive(Deserialize, JsonSchema)]
struct SetParams {
    /// Level ID; default: the selected level, or the home itself if it has no levels
    level: Option<String>,
    /// Image file (PNG, JPEG, BMP or GIF)
    path: Option<PathBuf>,
    /// The image as base64 (PNG, JPEG, BMP or GIF) instead of a file, e.g. a rendered PDF page
    image_base64: Option<String>,
    /// Real length of the scale marker in cm
    scale_distance: f32,
    /// Ends of the scale marker in image pixels
    x_start: f32,
    y_start: f32,
    x_end: f32,
    y_end: f32,
    /// Position of the plan origin (0, 0) on the image, in cm from its top-left corner
    /// (default 0, 0)
    x_origin: Option<f32>,
    y_origin: Option<f32>,
    /// Show the image in the plan (default true)
    visible: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateParams {
    /// Level ID; default: the selected level, or the home itself if it has no levels
    level: Option<String>,
    /// Real length of the scale marker in cm
    scale_distance: Option<f32>,
    /// Ends of the scale marker in image pixels
    x_start: Option<f32>,
    y_start: Option<f32>,
    x_end: Option<f32>,
    y_end: Option<f32>,
    /// Position of the plan origin on the image, in cm from its top-left corner
    x_origin: Option<f32>,
    y_origin: Option<f32>,
    /// Show the image in the plan
    visible: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
struct RemoveParams {
    /// Level ID; default: the selected level, or the home itself if it has no levels
    level: Option<String>,
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "background_image_set",
        "Sets the background image of a level (or of the home without levels): a floor plan to \
         trace, scaled by a marker between two image points (pixels) with its real length in \
         cm, and placed with the plan origin at x_origin / y_origin (cm from the image's \
         top-left corner). Replaces an existing background image of that level.",
        true,
        |doc, p: SetParams| {
            let data = match (&p.path, &p.image_base64) {
                (Some(path), None) => {
                    std::fs::read(path).map_err(|e| CommandError::failed(e.to_string()))?
                }
                (None, Some(b64)) => {
                    // Accept data URLs too
                    let raw = b64.split_once(',').map_or(b64.as_str(), |(_, d)| d);
                    base64::engine::general_purpose::STANDARD
                        .decode(raw.trim())
                        .map_err(|e| CommandError::failed(format!("invalid image_base64: {e}")))?
                }
                _ => return Err(CommandError::failed("give either path or image_base64")),
            };
            if image_kind(&data).is_none() {
                return Err(CommandError::failed(
                    "the background image must be a PNG, JPEG, BMP or GIF image",
                ));
            }
            check_scale(p.scale_distance, [p.x_start, p.y_start, p.x_end, p.y_end])?;
            let target = Target::resolve(doc, p.level)?;
            // The same image on several levels is stored once
            let image = doc.add_or_reuse_content(data);
            let background = BackgroundImage {
                image,
                scale_distance: p.scale_distance,
                scale_distance_x_start: p.x_start,
                scale_distance_y_start: p.y_start,
                scale_distance_x_end: p.x_end,
                scale_distance_y_end: p.y_end,
                x_origin: Some(p.x_origin.unwrap_or(0.0)),
                y_origin: Some(p.y_origin.unwrap_or(0.0)),
                // Sweet Home 3D writes `visible` only for hidden images
                visible: (p.visible == Some(false)).then_some(false),
                ..Default::default()
            };
            let result = info(&background, &target);
            *target.slot(doc) = Some(background);
            Ok(result)
        },
    );
    r.add(
        "background_image_update",
        "Changes the scale marker, the origin or the visibility of the background image of a \
         level (or of the home without levels).",
        true,
        |doc, p: UpdateParams| {
            let target = Target::resolve(doc, p.level)?;
            let slot = target.slot(doc);
            let b = slot.as_mut().ok_or_else(|| {
                CommandError::failed(format!("{} has no background image", target))
            })?;
            let set = |v: Option<f32>, field: &mut f32| {
                if let Some(v) = v {
                    *field = v;
                }
            };
            set(p.scale_distance, &mut b.scale_distance);
            set(p.x_start, &mut b.scale_distance_x_start);
            set(p.y_start, &mut b.scale_distance_y_start);
            set(p.x_end, &mut b.scale_distance_x_end);
            set(p.y_end, &mut b.scale_distance_y_end);
            if let Some(v) = p.x_origin {
                b.x_origin = Some(v);
            }
            if let Some(v) = p.y_origin {
                b.y_origin = Some(v);
            }
            if let Some(v) = p.visible {
                b.visible = (!v).then_some(false);
            }
            check_scale(
                b.scale_distance,
                [
                    b.scale_distance_x_start,
                    b.scale_distance_y_start,
                    b.scale_distance_x_end,
                    b.scale_distance_y_end,
                ],
            )?;
            Ok(info(b, &target))
        },
    );
    r.add(
        "background_image_remove",
        "Removes the background image of a level (or of the home without levels).",
        true,
        |doc, p: RemoveParams| {
            let target = Target::resolve(doc, p.level)?;
            if target.slot(doc).take().is_none() {
                return Err(CommandError::failed(format!(
                    "{} has no background image",
                    target
                )));
            }
            Ok(json!({ "removed": true }))
        },
    );
}

/// Where a background image belongs: a level or the home (without levels).
enum Target {
    Level(String),
    Home,
}

impl std::fmt::Display for Target {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Target::Level(id) => write!(f, "level '{id}'"),
            Target::Home => write!(f, "the home"),
        }
    }
}

impl Target {
    fn resolve(doc: &Document, level: Option<String>) -> Result<Self, CommandError> {
        let home = doc.home();
        if home.levels.is_empty() {
            return match level {
                Some(id) => Err(CommandError::failed(format!(
                    "unknown level '{id}' (the home has no levels)"
                ))),
                None => Ok(Target::Home),
            };
        }
        Ok(match super::resolve_level(home, level)? {
            Some(id) => Target::Level(id),
            None => Target::Home,
        })
    }

    fn slot<'a>(&self, doc: &'a mut Document) -> &'a mut Option<BackgroundImage> {
        let home = doc.home_mut();
        match self {
            Target::Home => &mut home.background_image,
            Target::Level(id) => {
                // `resolve` checked that the level exists
                let level = home
                    .levels
                    .iter_mut()
                    .find(|l| &l.attrs.id == id)
                    .expect("level exists");
                &mut level.background_image
            }
        }
    }
}

fn check_scale(distance: f32, [xs, ys, xe, ye]: [f32; 4]) -> Result<(), CommandError> {
    // Also rejects NaN
    if !distance.is_finite() || distance <= 0.0 {
        return Err(CommandError::failed("scale_distance must be positive"));
    }
    if (xe - xs).hypot(ye - ys) < 1.0 {
        return Err(CommandError::failed(
            "the ends of the scale marker must be at least one pixel apart",
        ));
    }
    Ok(())
}

/// Scale in cm per image pixel.
fn scale(b: &BackgroundImage) -> f32 {
    let px = (b.scale_distance_x_end - b.scale_distance_x_start)
        .hypot(b.scale_distance_y_end - b.scale_distance_y_start);
    b.scale_distance / px
}

fn info(b: &BackgroundImage, target: &Target) -> Value {
    let r = |v: f32| (f64::from(v) * 1000.0).round() / 1000.0;
    json!({
        "level": match target { Target::Level(id) => Some(id.as_str()), Target::Home => None },
        "image": b.image,
        "cm_per_pixel": r(scale(b)),
        "x_origin": r(b.x_origin.unwrap_or(0.0)),
        "y_origin": r(b.y_origin.unwrap_or(0.0)),
        "visible": b.visible != Some(false),
    })
}

/// Image format from the first bytes, if Sweet Home 3D can read it.
fn image_kind(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("png")
    } else if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpeg")
    } else if data.starts_with(b"GIF8") {
        Some("gif")
    } else if data.starts_with(b"BM") {
        Some("bmp")
    } else {
        None
    }
}
