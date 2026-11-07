//! Möbel- und Texturbibliotheken von Sweet Home 3D.
//!
//! Eine Bibliothek ist ein ZIP (`.sh3f`, `.sh3t` oder `.jar`) mit einer
//! Properties-Datei (`PluginFurnitureCatalog.properties`,
//! `DefaultTexturesCatalog.properties`, …) und den Ressourcen. Einträge sind
//! durchnummeriert: `name#1`, `model#1`, `width#1`, …. Übersetzungen liegen in
//! `…_de.properties` usw. und überschreiben einzelne Schlüssel.

pub mod properties;

use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("E/A-Fehler bei {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("ZIP-Fehler bei {path}: {message}")]
    Zip { path: PathBuf, message: String },
    #[error("{path} enthält keinen Möbel- oder Texturkatalog")]
    NoCatalog { path: PathBuf },
    #[error("Ressource '{resource}' nicht gefunden in {path}")]
    ResourceNotFound { path: PathBuf, resource: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogKind {
    Furniture,
    Textures,
}

/// Ein Katalog aus einer Bibliotheksdatei.
#[derive(Debug, Clone, Serialize)]
pub struct Catalog {
    /// Bibliotheksdatei
    pub source: PathBuf,
    /// Pfad der Properties-Datei im ZIP
    pub properties_entry: String,
    pub kind: CatalogKind,
    pub id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub license: Option<String>,
    pub provider: Option<String>,
    pub furniture: Vec<FurnitureItem>,
    pub textures: Vec<TextureItem>,
    /// Einträge, die nicht gelesen werden konnten (Index, Grund)
    pub skipped: Vec<(u32, String)>,
}

/// Ein Möbelstück im Katalog.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FurnitureItem {
    pub index: u32,
    pub id: Option<String>,
    pub name: String,
    pub category: String,
    pub tags: Vec<String>,
    pub creator: Option<String>,
    pub license: Option<String>,
    pub creation_date: Option<String>,
    /// Pfad im ZIP (ohne führenden `/`)
    pub icon: Option<String>,
    pub plan_icon: Option<String>,
    pub model: Option<String>,
    /// Modell besteht aus mehreren Dateien im selben Ordner
    pub multi_part_model: bool,
    pub width: f32,
    pub depth: f32,
    pub height: f32,
    pub elevation: f32,
    pub movable: bool,
    pub door_or_window: bool,
    /// Weitere Schlüssel ohne `#N` (z. B. `doorOrWindowCutOutShape`, `lightSourceX`)
    pub extra: BTreeMap<String, String>,
}

/// Eine Textur im Katalog.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextureItem {
    pub index: u32,
    pub id: Option<String>,
    pub name: String,
    pub category: String,
    pub creator: Option<String>,
    /// Pfad im ZIP (ohne führenden `/`)
    pub image: String,
    pub width: f32,
    pub height: f32,
    pub extra: BTreeMap<String, String>,
}

/// Liest alle Kataloge einer Bibliotheksdatei.
///
/// `locale` ist z. B. `"de"` oder `"de_CH"`; übersetzte Namen und Kategorien
/// werden dann bevorzugt.
pub fn open_library(path: &Path, locale: Option<&str>) -> Result<Vec<Catalog>, CatalogError> {
    let file = std::fs::File::open(path).map_err(|source| CatalogError::Io {
        path: path.to_owned(),
        source,
    })?;
    let mut zip =
        zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|e| CatalogError::Zip {
            path: path.to_owned(),
            message: e.to_string(),
        })?;

    let names: Vec<String> = zip.file_names().map(str::to_owned).collect();
    let mains: Vec<&String> = names
        .iter()
        .filter(|n| main_catalog_kind(n).is_some())
        .collect();
    if mains.is_empty() {
        return Err(CatalogError::NoCatalog {
            path: path.to_owned(),
        });
    }

    let mut catalogs = Vec::new();
    for main in mains {
        let kind = main_catalog_kind(main).expect("gefiltert");
        let mut props = read_properties(&mut zip, main, path)?;
        for loc in locale_variants(locale) {
            let localized = main.replace(".properties", &format!("_{loc}.properties"));
            if names.contains(&localized) {
                props.extend(read_properties(&mut zip, &localized, path)?);
            }
        }
        catalogs.push(build_catalog(path, main, kind, &props));
    }
    Ok(catalogs)
}

/// Liest eine Ressource (Modell, Icon, Bild) aus einer Bibliotheksdatei.
pub fn read_resource(library: &Path, resource: &str) -> Result<Vec<u8>, CatalogError> {
    let file = std::fs::File::open(library).map_err(|source| CatalogError::Io {
        path: library.to_owned(),
        source,
    })?;
    let mut zip =
        zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|e| CatalogError::Zip {
            path: library.to_owned(),
            message: e.to_string(),
        })?;
    let name = resource.trim_start_matches('/');
    let mut entry = zip
        .by_name(name)
        .map_err(|_| CatalogError::ResourceNotFound {
            path: library.to_owned(),
            resource: resource.to_owned(),
        })?;
    let mut data = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut data)
        .map_err(|source| CatalogError::Io {
            path: library.to_owned(),
            source,
        })?;
    Ok(data)
}

fn main_catalog_kind(entry: &str) -> Option<CatalogKind> {
    let file = entry.rsplit('/').next().unwrap_or(entry);
    match file {
        "DefaultFurnitureCatalog.properties"
        | "PluginFurnitureCatalog.properties"
        | "ContributedFurnitureCatalog.properties" => Some(CatalogKind::Furniture),
        "DefaultTexturesCatalog.properties" | "PluginTexturesCatalog.properties" => {
            Some(CatalogKind::Textures)
        }
        _ => None,
    }
}

fn locale_variants(locale: Option<&str>) -> Vec<String> {
    let Some(loc) = locale.filter(|l| !l.is_empty()) else {
        return Vec::new();
    };
    let loc = loc.replace('-', "_");
    match loc.split_once('_') {
        Some((lang, _)) => vec![lang.to_owned(), loc.clone()],
        None => vec![loc],
    }
}

fn read_properties<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
    path: &Path,
) -> Result<BTreeMap<String, String>, CatalogError> {
    let mut entry = zip.by_name(name).map_err(|e| CatalogError::Zip {
        path: path.to_owned(),
        message: e.to_string(),
    })?;
    let mut bytes = Vec::new();
    entry
        .read_to_end(&mut bytes)
        .map_err(|source| CatalogError::Io {
            path: path.to_owned(),
            source,
        })?;
    Ok(properties::parse(&bytes))
}

fn build_catalog(
    source: &Path,
    entry: &str,
    kind: CatalogKind,
    props: &BTreeMap<String, String>,
) -> Catalog {
    // Schlüssel nach Index gruppieren: "width#12" -> (12, "width")
    let mut items: BTreeMap<u32, BTreeMap<String, String>> = BTreeMap::new();
    for (k, v) in props {
        if let Some((key, idx)) = k.rsplit_once('#')
            && let Ok(i) = idx.parse::<u32>()
        {
            items
                .entry(i)
                .or_default()
                .insert(key.to_owned(), v.clone());
        }
    }

    let header = |k: &str| props.get(k).cloned();
    let mut catalog = Catalog {
        source: source.to_owned(),
        properties_entry: entry.to_owned(),
        kind,
        id: header("id"),
        name: header("name"),
        description: header("description"),
        version: header("version"),
        license: header("license"),
        provider: header("provider"),
        furniture: Vec::new(),
        textures: Vec::new(),
        skipped: Vec::new(),
    };

    for (index, mut m) in items {
        if m.remove("ignored").as_deref() == Some("true") {
            continue;
        }
        let result = match kind {
            CatalogKind::Furniture => {
                furniture_item(index, &mut m).map(|i| catalog.furniture.push(i))
            }
            CatalogKind::Textures => texture_item(index, &mut m).map(|i| catalog.textures.push(i)),
        };
        if let Err(reason) = result {
            catalog.skipped.push((index, reason));
        }
    }
    catalog
}

fn take_req(m: &mut BTreeMap<String, String>, k: &str) -> Result<String, String> {
    m.remove(k).ok_or_else(|| format!("'{k}' fehlt"))
}

fn take_f32(m: &mut BTreeMap<String, String>, k: &str) -> Result<f32, String> {
    let v = take_req(m, k)?;
    v.trim()
        .parse()
        .map_err(|_| format!("'{k}' ist keine Zahl: {v}"))
}

fn take_bool(m: &mut BTreeMap<String, String>, k: &str, default: bool) -> bool {
    m.remove(k)
        .map_or(default, |v| v.trim().eq_ignore_ascii_case("true"))
}

fn resource_path(v: String) -> String {
    v.trim_start_matches('/').to_owned()
}

fn furniture_item(index: u32, m: &mut BTreeMap<String, String>) -> Result<FurnitureItem, String> {
    Ok(FurnitureItem {
        index,
        id: m.remove("id"),
        name: take_req(m, "name")?,
        category: take_req(m, "category")?,
        tags: m
            .remove("tags")
            .map(|t| {
                t.split(',')
                    .map(|s| s.trim().to_owned())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default(),
        creator: m.remove("creator"),
        license: m.remove("license"),
        creation_date: m.remove("creationDate"),
        icon: m.remove("icon").map(resource_path),
        plan_icon: m.remove("planIcon").map(resource_path),
        model: m.remove("model").map(resource_path),
        multi_part_model: take_bool(m, "multiPartModel", false),
        width: take_f32(m, "width")?,
        depth: take_f32(m, "depth")?,
        height: take_f32(m, "height")?,
        elevation: m
            .remove("elevation")
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(0.0),
        movable: take_bool(m, "movable", true),
        door_or_window: take_bool(m, "doorOrWindow", false),
        extra: std::mem::take(m),
    })
}

fn texture_item(index: u32, m: &mut BTreeMap<String, String>) -> Result<TextureItem, String> {
    Ok(TextureItem {
        index,
        id: m.remove("id"),
        name: take_req(m, "name")?,
        category: take_req(m, "category")?,
        creator: m.remove("creator"),
        image: resource_path(take_req(m, "image")?),
        width: take_f32(m, "width")?,
        height: take_f32(m, "height")?,
        extra: std::mem::take(m),
    })
}

/// Bekannte Speicherorte von Bibliotheken auf diesem Rechner (nur Windows).
///
/// `extra_dirs` erlaubt zusätzliche Ordner, z. B. den Ressourcenordner der
/// Store-Version, dessen Pfad nur über die Paketverwaltung ermittelbar ist.
pub fn find_libraries(extra_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut dirs: Vec<PathBuf> = Vec::new();

    for base in [
        std::env::var_os("ProgramFiles"),
        std::env::var_os("ProgramFiles(x86)"),
    ]
    .into_iter()
    .flatten()
    {
        let lib = PathBuf::from(base).join("Sweet Home 3D").join("lib");
        for jar in ["Furniture.jar", "Textures.jar"] {
            let p = lib.join(jar);
            if p.is_file() {
                found.push(p);
            }
        }
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let user = PathBuf::from(appdata).join("eTeks").join("Sweet Home 3D");
        dirs.push(user.join("furniture"));
        dirs.push(user.join("textures"));
    }
    dirs.extend(extra_dirs.iter().cloned());

    for dir in dirs {
        let Ok(rd) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut files: Vec<PathBuf> = rd
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "sh3f" | "sh3t"))
            })
            .collect();
        files.sort();
        found.extend(files);
    }
    found
}
