//! Core of My Sweet Home.
//!
//! Phase P3 adds the document model, the command registry and undo/redo here.
//! UI, CLI and MCP call these commands exclusively.

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
