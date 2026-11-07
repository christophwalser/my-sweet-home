//! The user's own libraries ("My furniture.sh3f", "My textures.sh3t") in Sweet Home
//! 3D's user library folders. Imported textures and furniture are appended to them,
//! so they stay in the catalog of both applications.

use crate::{CatalogError, CatalogKind, user_library_dir};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// A texture to add to the user's texture library.
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
}

/// A piece of furniture to add to the user's furniture library.
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
}

/// Where an item was added.
#[derive(Debug, Clone)]
pub struct AddedItem {
    pub library: PathBuf,
    pub catalog_id: String,
}

fn library_path(kind: CatalogKind) -> Result<PathBuf, CatalogError> {
    let dir = user_library_dir(kind).ok_or_else(|| CatalogError::NoCatalog {
        path: PathBuf::from("%APPDATA%"),
    })?;
    Ok(dir.join(match kind {
        CatalogKind::Furniture => "My furniture.sh3f",
        CatalogKind::Textures => "My textures.sh3t",
    }))
}

fn properties_entry(kind: CatalogKind) -> &'static str {
    match kind {
        CatalogKind::Furniture => "PluginFurnitureCatalog.properties",
        CatalogKind::Textures => "PluginTexturesCatalog.properties",
    }
}

/// Unique catalog ID for a new item.
fn new_catalog_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("my-sweet-home#{nanos:x}")
}

/// Files (name, content) of a library except its properties file.
type Entries = Vec<(String, Vec<u8>)>;

/// Existing entries and properties of a user library (empty if it does not exist).
fn read_library(
    path: &Path,
    kind: CatalogKind,
) -> Result<(Entries, BTreeMap<String, String>), CatalogError> {
    if !path.exists() {
        return Ok((Vec::new(), BTreeMap::new()));
    }
    let io = |source| CatalogError::Io {
        path: path.to_owned(),
        source,
    };
    let zip_err = |e: zip::result::ZipError| CatalogError::Zip {
        path: path.to_owned(),
        message: e.to_string(),
    };
    let file = std::fs::File::open(path).map_err(io)?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(zip_err)?;
    let mut entries = Vec::new();
    let mut props = BTreeMap::new();
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(zip_err)?;
        if f.is_dir() {
            continue;
        }
        let mut data = Vec::new();
        f.read_to_end(&mut data).map_err(io)?;
        if f.name() == properties_entry(kind) {
            props = crate::properties::parse(&data);
        } else {
            entries.push((f.name().to_owned(), data));
        }
    }
    Ok((entries, props))
}

/// Next free item index (`name#N`).
fn next_index(props: &BTreeMap<String, String>) -> u32 {
    props
        .keys()
        .filter_map(|k| k.rsplit_once('#')?.1.parse::<u32>().ok())
        .max()
        .map_or(1, |n| n + 1)
}

/// Escapes a key or value for a Java properties file (ISO 8859-1 with \\u escapes).
fn escape(s: &str, key: bool) -> String {
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

/// Writes the library atomically (temporary file, then rename).
fn write_library(
    path: &Path,
    kind: CatalogKind,
    entries: &[(String, Vec<u8>)],
    props: &BTreeMap<String, String>,
) -> Result<(), CatalogError> {
    let io = |source| CatalogError::Io {
        path: path.to_owned(),
        source,
    };
    let zip_err = |e: zip::result::ZipError| CatalogError::Zip {
        path: path.to_owned(),
        message: e.to_string(),
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(io)?;
    }
    let tmp = path.with_extension("tmp");
    {
        let file = std::fs::File::create(&tmp).map_err(io)?;
        let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(file));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mut text = String::from("# Created by My Sweet Home\n");
        for (k, v) in props {
            text.push_str(&escape(k, true));
            text.push('=');
            text.push_str(&escape(v, false));
            text.push('\n');
        }
        zip.start_file(properties_entry(kind), options)
            .map_err(zip_err)?;
        zip.write_all(text.as_bytes()).map_err(io)?;
        for (name, data) in entries {
            zip.start_file(name.as_str(), options).map_err(zip_err)?;
            zip.write_all(data).map_err(io)?;
        }
        zip.finish().map_err(zip_err)?;
    }
    std::fs::rename(&tmp, path).map_err(io)
}

fn set_header(props: &mut BTreeMap<String, String>, kind: CatalogKind) {
    let (id, name) = match kind {
        CatalogKind::Furniture => ("my-sweet-home.my-furniture", "My furniture"),
        CatalogKind::Textures => ("my-sweet-home.my-textures", "My textures"),
    };
    props.entry("id".into()).or_insert_with(|| id.into());
    props.entry("name".into()).or_insert_with(|| name.into());
    props
        .entry("description".into())
        .or_insert_with(|| "Imported with My Sweet Home".into());
    props
        .entry("version".into())
        .or_insert_with(|| "1.0".into());
    props
        .entry("provider".into())
        .or_insert_with(|| "My Sweet Home".into());
}

/// Appends a texture to "My textures.sh3t" in the user's texture folder.
pub fn add_texture(texture: NewTexture) -> Result<AddedItem, CatalogError> {
    let kind = CatalogKind::Textures;
    let path = library_path(kind)?;
    let (mut entries, mut props) = read_library(&path, kind)?;
    set_header(&mut props, kind);
    let n = next_index(&props);
    let id = new_catalog_id();
    let image = format!(
        "{n}/texture.{}",
        texture.image_extension.to_ascii_lowercase()
    );
    let mut put = |k: &str, v: String| {
        props.insert(format!("{k}#{n}"), v);
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
    entries.push((image, texture.image));
    write_library(&path, kind, &entries, &props)?;
    Ok(AddedItem {
        library: path,
        catalog_id: id,
    })
}

/// Appends a piece of furniture to "My furniture.sh3f" in the user's furniture folder.
pub fn add_furniture(piece: NewFurniture) -> Result<AddedItem, CatalogError> {
    let kind = CatalogKind::Furniture;
    let path = library_path(kind)?;
    let (mut entries, mut props) = read_library(&path, kind)?;
    set_header(&mut props, kind);
    let n = next_index(&props);
    let id = new_catalog_id();
    let mut put = |k: &str, v: String| {
        props.insert(format!("{k}#{n}"), v);
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
    if let Some(c) = piece.creator {
        put("creator", c);
    }
    entries.push((format!("{n}/icon.png"), piece.icon));
    for (name, data) in piece.model_files {
        entries.push((format!("{n}/model/{name}"), data));
    }
    write_library(&path, kind, &entries, &props)?;
    Ok(AddedItem {
        library: path,
        catalog_id: id,
    })
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
    fn next_index_continues_after_the_highest() {
        let mut props = BTreeMap::new();
        props.insert("id".into(), "x".into());
        props.insert("name#3".into(), "a".into());
        props.insert("name#7".into(), "b".into());
        assert_eq!(next_index(&props), 8);
        assert_eq!(next_index(&BTreeMap::new()), 1);
    }
}
