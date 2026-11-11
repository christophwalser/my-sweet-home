//! Furniture and texture libraries of Sweet Home 3D.
//!
//! A library is a ZIP (`.sh3f`, `.sh3t` or `.jar`) containing a properties
//! file (`PluginFurnitureCatalog.properties`,
//! `DefaultTexturesCatalog.properties`, …) and the resources. Entries are
//! numbered: `name#1`, `model#1`, `width#1`, …. Translations live in
//! `…_de.properties` etc. and override individual keys.

pub mod library_edit;
pub mod properties;
pub mod user_library;

use msh_format::limits::{SizeBudget, read_entry};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("I/O error in {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("ZIP error in {path}: {message}")]
    Zip { path: PathBuf, message: String },
    #[error("{path} contains no furniture or texture catalog")]
    NoCatalog { path: PathBuf },
    #[error("resource '{resource}' not found in {path}")]
    ResourceNotFound { path: PathBuf, resource: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogKind {
    Furniture,
    Textures,
}

/// A catalog from a library file.
#[derive(Debug, Clone, Serialize)]
pub struct Catalog {
    /// Library file
    pub source: PathBuf,
    /// Path of the properties file inside the ZIP
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
    /// Entries that could not be read (index, reason)
    pub skipped: Vec<(u32, String)>,
}

/// A piece of furniture in a catalog.
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
    /// Path inside the ZIP (without leading `/`)
    pub icon: Option<String>,
    pub plan_icon: Option<String>,
    pub model: Option<String>,
    /// The model consists of several files in the same folder
    pub multi_part_model: bool,
    pub width: f32,
    pub depth: f32,
    pub height: f32,
    pub elevation: f32,
    pub movable: bool,
    pub door_or_window: bool,
    /// Further keys without `#N` (e.g. `doorOrWindowCutOutShape`, `lightSourceX`)
    pub extra: BTreeMap<String, String>,
}

/// A texture in a catalog.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextureItem {
    pub index: u32,
    pub id: Option<String>,
    pub name: String,
    pub category: String,
    pub creator: Option<String>,
    /// Path inside the ZIP (without leading `/`)
    pub image: String,
    pub width: f32,
    pub height: f32,
    pub extra: BTreeMap<String, String>,
}

/// Reads all catalogs of a library file.
///
/// `locale` is e.g. `"de"` or `"de_CH"`; translated names and categories are
/// then preferred.
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

    let names: Vec<String> = zip.file_names().flatten().map(|n| n.into_owned()).collect();
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
        let kind = main_catalog_kind(main).expect("filtered above");
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

/// Reads a resource (model, icon, image) from a library file.
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
    let declared = entry.size();
    read_entry(&mut entry, declared).map_err(|source| CatalogError::Io {
        path: library.to_owned(),
        source,
    })
}

/// Reads all files below the folder `dir` of a library (e.g. the parts of a
/// multi-part model). Returns paths relative to `dir` with their content.
pub fn read_resource_dir(
    library: &Path,
    dir: &str,
) -> Result<Vec<(String, Vec<u8>)>, CatalogError> {
    let file = std::fs::File::open(library).map_err(|source| CatalogError::Io {
        path: library.to_owned(),
        source,
    })?;
    let mut zip =
        zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|e| CatalogError::Zip {
            path: library.to_owned(),
            message: e.to_string(),
        })?;
    let prefix = format!("{}/", dir.trim_start_matches('/').trim_end_matches('/'));
    let names: Vec<String> = zip
        .file_names()
        .flatten()
        .filter(|n| n.starts_with(&prefix) && !n.ends_with('/'))
        .map(|n| n.into_owned())
        .collect();
    let mut out = Vec::with_capacity(names.len());
    let mut budget = SizeBudget::default();
    for name in names {
        let mut entry = zip.by_name(&name).map_err(|e| CatalogError::Zip {
            path: library.to_owned(),
            message: e.to_string(),
        })?;
        let declared = entry.size();
        let data = budget
            .read_entry(&mut entry, declared)
            .map_err(|source| CatalogError::Io {
                path: library.to_owned(),
                source,
            })?;
        out.push((name[prefix.len()..].to_owned(), data));
    }
    Ok(out)
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
    let declared = entry.size();
    let bytes = read_entry(&mut entry, declared).map_err(|source| CatalogError::Io {
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
    // Group keys by index: "width#12" -> (12, "width")
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
    m.remove(k).ok_or_else(|| format!("'{k}' is missing"))
}

fn take_f32(m: &mut BTreeMap<String, String>, k: &str) -> Result<f32, String> {
    let v = take_req(m, k)?;
    v.trim()
        .parse()
        .map_err(|_| format!("'{k}' is not a number: {v}"))
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

/// Resources folder of the Microsoft Store version of Sweet Home 3D, if installed.
///
/// The install location of Store apps can only be determined through package
/// management, so this asks PowerShell (`Get-AppxPackage`), once per process: the
/// answer takes about a second and does not change while the app runs.
pub fn store_resources_dir() -> Option<PathBuf> {
    static DIR: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    DIR.get_or_init(query_store_resources_dir).clone()
}

fn query_store_resources_dir() -> Option<PathBuf> {
    let mut cmd = std::process::Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-AppxPackage -Name eTeks.SweetHome3D | Select-Object -First 1).InstallLocation",
    ]);
    // The app has no console, so Windows would open a console window for PowerShell
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    let loc = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    if loc.is_empty() {
        return None;
    }
    let dir = PathBuf::from(loc).join("Sweet Home 3D").join("resources");
    dir.is_dir().then_some(dir)
}

/// Folder of the user's libraries of a kind, shared with Sweet Home 3D
/// (`%APPDATA%\eTeks\Sweet Home 3D\furniture` or `\textures`).
pub fn user_library_dir(kind: CatalogKind) -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let base = PathBuf::from(appdata).join("eTeks").join("Sweet Home 3D");
    Some(base.join(match kind {
        CatalogKind::Furniture => "furniture",
        CatalogKind::Textures => "textures",
    }))
}

/// Whether `path` lies in one of the user's library folders (so it may be removed).
pub fn is_user_library(path: &Path) -> bool {
    [CatalogKind::Furniture, CatalogKind::Textures]
        .into_iter()
        .filter_map(user_library_dir)
        .any(|dir| path.parent().is_some_and(|p| p == dir))
}

/// All library files on this machine: Sweet Home 3D installation, user
/// libraries, Store version and `extra_dirs`.
pub fn find_all_libraries(extra_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut dirs = extra_dirs.to_vec();
    if let Some(store) = store_resources_dir() {
        dirs.push(store.join("furniture"));
        dirs.push(store.join("textures"));
    }
    find_libraries(&dirs)
}

/// File names of Sweet Home 3D's default catalogs.
pub const DEFAULT_CATALOG_FILES: [&str; 2] = ["Furniture.jar", "Textures.jar"];

/// Folder of a default catalog provided with My Sweet Home, if it exists: the folder
/// named by `MSH_CATALOG_DIR`, otherwise `catalog` next to the executable (e.g. in a
/// portable setup; the installer does not bundle a catalog).
pub fn bundled_catalog_dir() -> Option<PathBuf> {
    let dir = match std::env::var_os("MSH_CATALOG_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => std::env::current_exe().ok()?.parent()?.join("catalog"),
    };
    dir.is_dir().then_some(dir)
}

/// Known library locations on this machine (Windows only).
///
/// The bundled default catalog comes first; a Sweet Home 3D installation only adds the
/// default catalog files the bundle does not have, so no item appears twice.
/// `extra_dirs` adds further folders, e.g. the resources folder of the Store
/// version, whose path can only be determined through package management.
pub fn find_libraries(extra_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut dirs: Vec<PathBuf> = Vec::new();

    let mut lib_dirs: Vec<PathBuf> = bundled_catalog_dir().into_iter().collect();
    lib_dirs.extend(
        [
            std::env::var_os("ProgramFiles"),
            std::env::var_os("ProgramFiles(x86)"),
        ]
        .into_iter()
        .flatten()
        .map(|base| PathBuf::from(base).join("Sweet Home 3D").join("lib")),
    );
    for jar in DEFAULT_CATALOG_FILES {
        if let Some(p) = lib_dirs.iter().map(|d| d.join(jar)).find(|p| p.is_file()) {
            found.push(p);
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
