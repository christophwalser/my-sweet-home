//! The user's catalog settings of My Sweet Home: libraries that are hidden from the catalog
//! and categories the user gave catalog items (e.g. by dragging them to another category).
//!
//! They are kept apart from the library files, so libraries of the Sweet Home 3D installation
//! (read-only) can be changed as well and Sweet Home 3D's own files stay untouched. Stored in
//! `%APPDATA%\ch.mysweethome.app\catalog.json` (`MSH_CATALOG_SETTINGS` overrides the path).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Kind of catalog item a category belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemKind {
    Furniture,
    Textures,
}

impl ItemKind {
    fn prefix(self) -> &'static str {
        match self {
            ItemKind::Furniture => "furniture",
            ItemKind::Textures => "textures",
        }
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct CatalogSettings {
    /// Library files that are not shown in the catalog
    #[serde(default)]
    pub hidden_libraries: Vec<PathBuf>,
    /// Category chosen by the user, by "<kind>:<catalog ID>"
    #[serde(default)]
    pub categories: BTreeMap<String, String>,
}

/// Paths are compared without case, like Windows does.
fn same_path(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

fn key(kind: ItemKind, id: &str) -> String {
    format!("{}:{id}", kind.prefix())
}

impl CatalogSettings {
    /// File the settings are stored in.
    pub fn path() -> Option<PathBuf> {
        if let Some(p) = std::env::var_os("MSH_CATALOG_SETTINGS") {
            return Some(PathBuf::from(p));
        }
        let appdata = std::env::var_os("APPDATA")?;
        Some(
            PathBuf::from(appdata)
                .join("ch.mysweethome.app")
                .join("catalog.json"),
        )
    }

    /// The stored settings; defaults when there are none or the file cannot be read.
    pub fn load() -> Self {
        Self::path()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|data| serde_json::from_slice(&data).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> Result<(), String> {
        let path = Self::path().ok_or("the settings folder is unknown")?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let data = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(&path, data).map_err(|e| e.to_string())
    }

    pub fn is_hidden(&self, library: &Path) -> bool {
        self.hidden_libraries.iter().any(|h| same_path(h, library))
    }

    pub fn set_hidden(&mut self, library: &Path, hidden: bool) {
        self.hidden_libraries.retain(|h| !same_path(h, library));
        if hidden {
            self.hidden_libraries.push(library.to_path_buf());
        }
    }

    /// Category the user chose for an item, if any.
    pub fn category(&self, kind: ItemKind, id: Option<&str>) -> Option<&str> {
        self.categories.get(&key(kind, id?)).map(String::as_str)
    }

    /// Sets the category of an item; `None` (or an empty name) restores the library's own.
    pub fn set_category(&mut self, kind: ItemKind, id: &str, category: Option<&str>) {
        match category.map(str::trim).filter(|c| !c.is_empty()) {
            Some(c) => {
                self.categories.insert(key(kind, id), c.to_owned());
            }
            None => {
                self.categories.remove(&key(kind, id));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categories_and_hidden_libraries() {
        let mut s = CatalogSettings::default();
        s.set_category(ItemKind::Furniture, "eTeks#bed", Some(" Bedroom "));
        assert_eq!(
            s.category(ItemKind::Furniture, Some("eTeks#bed")),
            Some("Bedroom")
        );
        assert_eq!(s.category(ItemKind::Textures, Some("eTeks#bed")), None);
        s.set_category(ItemKind::Furniture, "eTeks#bed", Some(""));
        assert!(s.categories.is_empty());

        s.set_hidden(Path::new(r"C:\Lib\A.sh3f"), true);
        assert!(s.is_hidden(Path::new(r"c:\lib\a.SH3F")));
        s.set_hidden(Path::new(r"c:\lib\a.sh3f"), false);
        assert!(s.hidden_libraries.is_empty());
    }
}
