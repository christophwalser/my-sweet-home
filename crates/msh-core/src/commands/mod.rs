//! Standard commands.
//!
//! Conventions for all commands (also stated in the MCP server instructions):
//! - Lengths in centimeters, plan coordinates with the y axis pointing down
//!   (towards the bottom of the plan, "south" with the default compass).
//! - Angles in degrees, clockwise in the plan.
//! - Colors as `#RRGGBB`.
//! - Elements on levels: if `level` is omitted, the selected level is used.

mod annotate;
mod edit;
mod export;
mod flip;
mod furniture;
mod group;
mod home;
mod import;
mod level;
mod library;
mod room;
mod view;
mod wall;
mod wall_ops;

use crate::registry::{CommandError, Registry};
use msh_model::{Color, Home};

pub(crate) fn register_all(r: &mut Registry) {
    home::register(r);
    import::register(r);
    level::register(r);
    library::register(r);
    wall::register(r);
    wall_ops::register(r);
    room::register(r);
    furniture::register(r);
    group::register(r);
    annotate::register(r);
    edit::register(r);
    flip::register(r);
    view::register(r);
    export::register(r);
}

/// New element ID in the style of Sweet Home 3D 7 (`wall-<uuid>`).
pub(crate) fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::new_v4())
}

/// Level for a new element: the given one (validated) or the selected level.
pub(crate) fn resolve_level(
    home: &Home,
    level: Option<String>,
) -> Result<Option<String>, CommandError> {
    match level {
        Some(id) => {
            if home.levels.iter().any(|l| l.attrs.id == id) {
                Ok(Some(id))
            } else {
                Err(CommandError::failed(format!("unknown level '{id}'")))
            }
        }
        None => Ok(home
            .attrs
            .selected_level
            .clone()
            .filter(|id| home.levels.iter().any(|l| &l.attrs.id == id))
            .or_else(|| home.levels.first().map(|l| l.attrs.id.clone()))),
    }
}

/// Parses `#RRGGBB` or `#AARRGGBB` into an ARGB color (opaque by default).
pub(crate) fn parse_color(s: &str) -> Result<Color, CommandError> {
    let hex = s.trim().trim_start_matches('#');
    let v = u32::from_str_radix(hex, 16)
        .map_err(|_| CommandError::failed(format!("invalid color '{s}', expected #RRGGBB")))?;
    Ok(Color(match hex.len() {
        6 => 0xFF00_0000 | v,
        8 => v,
        _ => {
            return Err(CommandError::failed(format!(
                "invalid color '{s}', expected #RRGGBB"
            )));
        }
    }))
}

/// Like [`parse_color`], but "" means "no color" (use the default).
pub(crate) fn optional_color(s: &str) -> Result<Option<Color>, CommandError> {
    if s.is_empty() {
        Ok(None)
    } else {
        parse_color(s).map(Some)
    }
}

/// IDs an update command applies to: `id` and/or `ids` (at least one).
pub(crate) fn target_ids(
    id: Option<String>,
    ids: Option<Vec<String>>,
) -> Result<Vec<String>, CommandError> {
    let mut out: Vec<String> = id.into_iter().chain(ids.unwrap_or_default()).collect();
    let mut seen = std::collections::HashSet::new();
    out.retain(|i| seen.insert(i.clone()));
    if out.is_empty() {
        return Err(CommandError::failed("give id or ids"));
    }
    Ok(out)
}

/// Result of an update command for one or several elements.
pub(crate) fn updated(targets: &[String]) -> serde_json::Value {
    if targets.len() == 1 {
        serde_json::json!({ "id": targets[0] })
    } else {
        serde_json::json!({ "ids": targets })
    }
}

/// The string unless it is empty ("" is used to remove a texture).
pub(crate) fn non_empty(s: &Option<String>) -> Option<&str> {
    s.as_deref().filter(|s| !s.is_empty())
}

pub(crate) fn color_hex(c: Option<Color>) -> Option<String> {
    c.map(|c| format!("#{:06X}", c.0 & 0x00FF_FFFF))
}

pub(crate) fn deg(rad: f32) -> f32 {
    (rad.to_degrees() * 100.0).round() / 100.0
}

pub(crate) fn rad(deg: f32) -> f32 {
    deg.to_radians()
}

pub(crate) fn round2(v: f32) -> f32 {
    (v * 100.0).round() / 100.0
}

pub(crate) fn ok_id(id: &str) -> serde_json::Value {
    serde_json::json!({ "id": id })
}
