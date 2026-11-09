//! Adding imported textures and furniture to a library. By default they go to the user's own
//! libraries ("My furniture.sh3f", "My textures.sh3t") in Sweet Home 3D's user library
//! folders, so they stay in the catalog of both applications; any other editable library can
//! be chosen as target.

use crate::library_edit::EditableLibrary;
use crate::{CatalogError, CatalogKind, user_library_dir};
use std::path::{Path, PathBuf};

/// A texture to add to a texture library.
pub struct NewTexture {
    pub name: String,
    pub category: String,
    pub creator: Option<String>,
    /// Image file content (JPEG, PNG, BMP or GIF)
    pub image: Vec<u8>,
    /// File extension of the image, e.g. "jpg"
    pub image_extension: String,
    /// Size of one tile in cm
    pub width: f32,
    pub height: f32,
    /// Target library (default: "My textures.sh3t")
    pub library: Option<PathBuf>,
}

/// A piece of furniture to add to a furniture library.
pub struct NewFurniture {
    pub name: String,
    pub category: String,
    pub creator: Option<String>,
    /// PNG icon
    pub icon: Vec<u8>,
    /// Model files with their path relative to the model folder; `model` names the main file
    pub model_files: Vec<(String, Vec<u8>)>,
    pub model: String,
    pub width: f32,
    pub depth: f32,
    pub height: f32,
    pub elevation: f32,
    pub movable: bool,
    pub door_or_window: bool,
    /// 3x3 rotation of the model (row major), applied before scaling to the size
    pub model_rotation: Option<[f32; 9]>,
    /// Staircase: SVG path in the unit square of the floor hole it cuts in the level above
    pub staircase_cut_out_shape: Option<String>,
    /// Target library (default: "My furniture.sh3f")
    pub library: Option<PathBuf>,
}

/// Where an item was added.
#[derive(Debug, Clone)]
pub struct AddedItem {
    pub library: PathBuf,
    pub catalog_id: String,
}

/// The user's own library of a kind.
pub fn default_library_path(kind: CatalogKind) -> Result<PathBuf, CatalogError> {
    let dir = user_library_dir(kind).ok_or_else(|| CatalogError::NoCatalog {
        path: PathBuf::from("%APPDATA%"),
    })?;
    Ok(dir.join(match kind {
        CatalogKind::Furniture => "My furniture.sh3f",
        CatalogKind::Textures => "My textures.sh3t",
    }))
}

/// Unique catalog ID for a new item.
pub fn new_catalog_id() -> String {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("my-sweet-home#{:x}", nanos + n as u128)
}

/// Escapes a key or value for a Java properties file (ISO 8859-1 with \\u escapes).
pub(crate) fn escape(s: &str, key: bool) -> String {
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '=' | ':' | '#' | '!' => {
                out.push('\\');
                out.push(c);
            }
            ' ' if key || i == 0 => out.push_str("\\ "),
            c if (c as u32) < 0x20 || (c as u32) > 0x7e => {
                let mut buf = [0u16; 2];
                for unit in c.encode_utf16(&mut buf) {
                    out.push_str(&format!("\\u{unit:04X}"));
                }
            }
            c => out.push(c),
        }
    }
    out
}

/// The target library, read or (for the user's own library) created.
fn target(kind: CatalogKind, library: Option<PathBuf>) -> Result<EditableLibrary, CatalogError> {
    let path = match library {
        Some(p) => p,
        None => default_library_path(kind)?,
    };
    if path.exists() {
        let lib = EditableLibrary::open(&path)?;
        if lib.kind != kind {
            return Err(CatalogError::NoCatalog { path });
        }
        return Ok(lib);
    }
    let (id, name) = match kind {
        CatalogKind::Furniture => ("my-sweet-home.my-furniture", "My furniture"),
        CatalogKind::Textures => ("my-sweet-home.my-textures", "My textures"),
    };
    let mut lib = EditableLibrary::new(&path, kind, name);
    lib.props.insert("id".into(), id.into());
    lib.props
        .insert("description".into(), "Imported with My Sweet Home".into());
    Ok(lib)
}

/// Adds a texture (by default to "My textures.sh3t").
pub fn add_texture(texture: NewTexture) -> Result<AddedItem, CatalogError> {
    let mut lib = target(CatalogKind::Textures, texture.library)?;
    let n = lib.next_index();
    let id = new_catalog_id();
    let image = lib.free_name(&format!(
        "{n}/texture.{}",
        texture.image_extension.to_ascii_lowercase()
    ));
    let mut put = |k: &str, v: String| {
        lib.props.insert(format!("{k}#{n}"), v);
    };
    put("id", id.clone());
    put("name", texture.name);
    put("category", texture.category);
    put("image", format!("/{image}"));
    put("width", texture.width.to_string());
    put("height", texture.height.to_string());
    if let Some(c) = texture.creator {
        put("creator", c);
    }
    lib.push_file(image, texture.image);
    lib.save()?;
    Ok(AddedItem {
        library: lib.path,
        catalog_id: id,
    })
}

/// Adds a piece of furniture (by default to "My furniture.sh3f").
pub fn add_furniture(piece: NewFurniture) -> Result<AddedItem, CatalogError> {
    let mut lib = target(CatalogKind::Furniture, piece.library)?;
    let n = lib.next_index();
    let id = new_catalog_id();
    let mut put = |k: &str, v: String| {
        lib.props.insert(format!("{k}#{n}"), v);
    };
    put("id", id.clone());
    put("name", piece.name);
    put("category", piece.category);
    put("icon", format!("/{n}/icon.png"));
    put("model", format!("/{n}/model/{}", piece.model));
    if piece.model_files.len() > 1 {
        put("multiPartModel", "true".into());
    }
    put("width", piece.width.to_string());
    put("depth", piece.depth.to_string());
    put("height", piece.height.to_string());
    put("elevation", piece.elevation.to_string());
    put("movable", piece.movable.to_string());
    put("doorOrWindow", piece.door_or_window.to_string());
    if let Some(r) = piece.model_rotation {
        let text: Vec<String> = r.iter().map(|v| v.to_string()).collect();
        put("modelRotation", text.join(" "));
    }
    if let Some(shape) = piece.staircase_cut_out_shape {
        put("staircaseCutOutShape", shape);
    }
    if let Some(c) = piece.creator {
        put("creator", c);
    }
    lib.push_file(format!("{n}/icon.png"), piece.icon);
    for (name, data) in piece.model_files {
        lib.push_file(format!("{n}/model/{name}"), data);
    }
    lib.save()?;
    Ok(AddedItem {
        library: lib.path,
        catalog_id: id,
    })
}

/// Whether `path` names the user's own library of its kind.
pub fn is_default_library(path: &Path) -> bool {
    [CatalogKind::Furniture, CatalogKind::Textures]
        .into_iter()
        .filter_map(|k| default_library_path(k).ok())
        .any(|p| p == path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escaping_round_trips_through_the_parser() {
        let value = "Holz: hell = schön\\dunkel #1";
        let text = format!("{}={}\n", escape("name#1", true), escape(value, false));
        let parsed = crate::properties::parse(text.as_bytes());
        assert_eq!(parsed["name#1"], value);
    }

    #[test]
    fn catalog_ids_are_unique() {
        let a = new_catalog_id();
        let b = new_catalog_id();
        assert_ne!(a, b);
    }
}
