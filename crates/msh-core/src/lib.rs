//! Core of My Sweet Home.
//!
//! Contains the open [`Document`] with undo/redo and the [`Registry`] of all
//! commands. UI, CLI and MCP server change homes exclusively through these
//! commands, so all of them offer the same functionality.

pub mod catalog;
pub mod catalog_settings;
pub mod clipboard;
mod commands;
pub mod document;
mod model_formats;
pub mod model_package;
pub mod patch;
pub mod registry;
mod texture_formats;

pub use commands::camera_path_len;
pub use document::Document;
pub use registry::{CommandError, CommandResult, CommandSpec, Registry};

use serde::Serialize;

/// Basic application information that every frontend can display.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
}

/// Returns the name and version of the core.
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "My Sweet Home",
        version: env!("CARGO_PKG_VERSION"),
    }
}

/// Conventions every client (CLI, MCP, UI) should know; used as MCP server instructions.
pub const CONVENTIONS: &str = "\
My Sweet Home edits Sweet Home 3D homes (.sh3d).
Units and coordinates: lengths in centimeters; plan coordinates with x to the right and y DOWN \
(towards the bottom of the plan); angles in degrees, clockwise; colors as #RRGGBB.
Typical workflow: home_new (or home_open) → wall_add_path with closed=true for the outer walls, \
wall_add_path for inner walls → room_add for each room (inside_point: any point inside the closed \
walls, or points: the inner outline) → \
catalog_search for doors, windows and furniture → furniture_add_in_wall for doors/windows, \
furniture_add for furniture → view_plan_image to check the result → home_save.
Walls are centered on their axis: a wall from (0,0) to (500,0) with thickness 20 covers y = -10..10. \
Use home_describe to get IDs and coordinates of existing elements. edit_duplicate copies elements \
(e.g. a furnished room); edit_copy / edit_paste also work across homes. Every change can be undone \
with edit_undo.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_has_version() {
        let info = app_info();
        assert_eq!(info.name, "My Sweet Home");
        assert!(!info.version.is_empty());
    }
}
