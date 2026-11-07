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
mod furniture;
mod home;
mod level;
mod room;
mod view;
mod wall;

use crate::registry::{CommandError, Registry};
use msh_model::{Color, Home};

pub(crate) fn register_all(r: &mut Registry) {
    home::register(r);
    level::register(r);
    wall::register(r);
    room::register(r);
    furniture::register(r);
    annotate::register(r);
    edit::register(r);
    view::register(r);
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
