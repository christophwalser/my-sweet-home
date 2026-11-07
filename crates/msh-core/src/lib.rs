//! Kern von My Sweet Home.
//!
//! Hier entstehen in Phase P3 das Dokumentmodell, die Command-Registry und
//! Undo/Redo. UI, CLI und MCP rufen ausschliesslich diese Commands auf.

use serde::Serialize;

/// Basisinformationen über die Anwendung, die alle Oberflächen anzeigen können.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
}

/// Liefert Name und Version des Kerns.
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
