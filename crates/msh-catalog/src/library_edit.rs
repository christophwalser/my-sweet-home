//! Editing furniture and texture libraries: items, categories, names, and an undo history.
//!
//! A library is read completely (main properties, translations `…_de.properties` and all
//! resources), changed in memory and written back atomically. Every change made through
//! [`record`] keeps the file contents before and after, so it can be undone and redone.

use crate::properties;
use crate::user_library::{escape, new_catalog_id};
use crate::{CatalogError, CatalogKind, is_user_library};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Keys whose value is a resource of the library (a path inside the ZIP).
const RESOURCE_KEYS: [&str; 4] = ["icon", "planIcon", "model", "image"];

/// A library loaded for editing.
#[derive(Debug, Clone)]
pub struct EditableLibrary {
    pub path: PathBuf,
    pub kind: CatalogKind,
    /// Entry name of the main properties file
    main: String,
    /// Keys of the main properties file (`name`, `name#3`, …)
    pub props: BTreeMap<String, String>,
    /// Translations by locale (`de`, `fr`, …)
    pub localized: BTreeMap<String, BTreeMap<String, String>>,
    /// All other files of the ZIP, in their order
    files: Vec<(String, Vec<u8>)>,
}

fn io_err(path: &Path) -> impl Fn(std::io::Error) -> CatalogError + '_ {
    move |source| CatalogError::Io {
        path: path.to_owned(),
        source,
    }
}

fn zip_err(path: &Path) -> impl Fn(zip::result::ZipError) -> CatalogError + '_ {
    move |e| CatalogError::Zip {
        path: path.to_owned(),
        message: e.to_string(),
    }
}

/// Properties file name of a kind for new libraries.
fn main_entry(kind: CatalogKind) -> &'static str {
    match kind {
        CatalogKind::Furniture => "PluginFurnitureCatalog.properties",
        CatalogKind::Textures => "PluginTexturesCatalog.properties",
    }
}

fn kind_of_entry(name: &str) -> Option<CatalogKind> {
    let file = name.rsplit('/').next().unwrap_or(name);
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

/// Text of a properties file as written by My Sweet Home.
fn properties_text(props: &BTreeMap<String, String>) -> String {
    let mut text = String::from("# Created by My Sweet Home\n");
    for (k, v) in props {
        text.push_str(&escape(k, true));
        text.push('=');
        text.push_str(&escape(v, false));
        text.push('\n');
    }
    text
}

/// Splits `key#N` into the key and the item index.
fn split_key(k: &str) -> Option<(&str, u32)> {
    let (key, idx) = k.rsplit_once('#')?;
    Some((key, idx.parse().ok()?))
}

/// Whether the library may be changed: it lies in the user's library folders (libraries of
/// the installation stay read-only) and its file is not write protected.
pub fn is_editable(path: &Path) -> bool {
    is_user_library(path) && std::fs::metadata(path).is_ok_and(|m| !m.permissions().readonly())
}

impl EditableLibrary {
    /// Reads a library file.
    pub fn open(path: &Path) -> Result<Self, CatalogError> {
        let file = std::fs::File::open(path).map_err(io_err(path))?;
        let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(zip_err(path))?;
        let mut all = Vec::new();
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(zip_err(path))?;
            if f.is_dir() {
                continue;
            }
            let mut data = Vec::new();
            f.read_to_end(&mut data).map_err(io_err(path))?;
            all.push((f.name().to_owned(), data));
        }
        let (main, kind) = all
            .iter()
            .find_map(|(n, _)| kind_of_entry(n).map(|k| (n.clone(), k)))
            .ok_or_else(|| CatalogError::NoCatalog {
                path: path.to_owned(),
            })?;
        let stem = main.trim_end_matches(".properties").to_owned();
        let mut props = BTreeMap::new();
        let mut localized = BTreeMap::new();
        let mut files = Vec::new();
        for (name, data) in all {
            if name == main {
                props = properties::parse(&data);
            } else if let Some(loc) = name
                .strip_prefix(&format!("{stem}_"))
                .and_then(|r| r.strip_suffix(".properties"))
            {
                localized.insert(loc.to_owned(), properties::parse(&data));
            } else {
                files.push((name, data));
            }
        }
        Ok(Self {
            path: path.to_owned(),
            kind,
            main,
            props,
            localized,
            files,
        })
    }

    /// A new, empty library (not written yet).
    pub fn new(path: &Path, kind: CatalogKind, name: &str) -> Self {
        let mut props = BTreeMap::new();
        let id = new_catalog_id().replace('#', ".");
        props.insert("id".to_owned(), id);
        props.insert("name".to_owned(), name.to_owned());
        props.insert("version".to_owned(), "1.0".to_owned());
        props.insert("provider".to_owned(), "My Sweet Home".to_owned());
        Self {
            path: path.to_owned(),
            kind,
            main: main_entry(kind).to_owned(),
            props,
            localized: BTreeMap::new(),
            files: Vec::new(),
        }
    }

    /// The library file as bytes.
    pub fn to_bytes(&self) -> Result<Vec<u8>, CatalogError> {
        let path = &self.path;
        let mut out = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut out);
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            zip.start_file(self.main.as_str(), options)
                .map_err(zip_err(path))?;
            zip.write_all(properties_text(&self.props).as_bytes())
                .map_err(io_err(path))?;
            let stem = self.main.trim_end_matches(".properties");
            for (loc, map) in &self.localized {
                zip.start_file(format!("{stem}_{loc}.properties"), options)
                    .map_err(zip_err(path))?;
                zip.write_all(properties_text(map).as_bytes())
                    .map_err(io_err(path))?;
            }
            for (name, data) in &self.files {
                zip.start_file(name.as_str(), options)
                    .map_err(zip_err(path))?;
                zip.write_all(data).map_err(io_err(path))?;
            }
            zip.finish().map_err(zip_err(path))?;
        }
        Ok(out.into_inner())
    }

    /// Writes the library atomically.
    pub fn save(&self) -> Result<(), CatalogError> {
        write_file(&self.path, &self.to_bytes()?)
    }

    /// Indexes of the items, ascending.
    pub fn indexes(&self) -> Vec<u32> {
        let set: BTreeSet<u32> = self
            .props
            .keys()
            .filter_map(|k| split_key(k).map(|(_, i)| i))
            .collect();
        set.into_iter().collect()
    }

    pub fn has_item(&self, index: u32) -> bool {
        self.props.contains_key(&format!("name#{index}"))
    }

    /// Keys (without `#N`) and values of an item in the main properties.
    pub fn item(&self, index: u32) -> BTreeMap<String, String> {
        item_of(&self.props, index)
    }

    /// Translated keys of an item for `locale`.
    pub fn item_localized(&self, index: u32, locale: &str) -> BTreeMap<String, String> {
        self.localized
            .get(locale)
            .map(|m| item_of(m, index))
            .unwrap_or_default()
    }

    /// Value of a key as shown in `locale` (translation first).
    pub fn shown(&self, index: u32, key: &str, locale: Option<&str>) -> Option<String> {
        let k = format!("{key}#{index}");
        locale
            .and_then(|l| self.localized.get(l))
            .and_then(|m| m.get(&k))
            .or_else(|| self.props.get(&k))
            .cloned()
    }

    /// Name of the library as shown in `locale`.
    pub fn name(&self, locale: Option<&str>) -> Option<String> {
        locale
            .and_then(|l| self.localized.get(l))
            .and_then(|m| m.get("name"))
            .or_else(|| self.props.get("name"))
            .cloned()
    }

    /// Renames the library (in the main properties and in a translation that has a name).
    pub fn set_name(&mut self, name: &str) {
        self.props.insert("name".into(), name.to_owned());
        for map in self.localized.values_mut() {
            if map.contains_key("name") {
                map.insert("name".into(), name.to_owned());
            }
        }
    }

    /// Sets (or with `None` removes) a key of an item. With `locale`, a translation of the key
    /// is changed where the item has one, otherwise the main value.
    pub fn set(&mut self, index: u32, key: &str, value: Option<&str>, locale: Option<&str>) {
        let k = format!("{key}#{index}");
        let target = match locale.and_then(|l| self.localized.get_mut(l)) {
            Some(map) if map.contains_key(&k) => map,
            _ => &mut self.props,
        };
        match value {
            Some(v) => {
                target.insert(k, v.to_owned());
            }
            None => {
                target.remove(&k);
            }
        }
    }

    /// Categories as shown in `locale`, sorted.
    pub fn categories(&self, locale: Option<&str>) -> Vec<String> {
        let set: BTreeSet<String> = self
            .indexes()
            .into_iter()
            .filter_map(|i| self.shown(i, "category", locale))
            .collect();
        set.into_iter().collect()
    }

    /// Moves an item to the category shown as `category` in `locale`. If another item of the
    /// library shows that category through a translation, its untranslated name is used so
    /// that all languages stay consistent; otherwise the name is taken as it is.
    pub fn move_to_category(&mut self, index: u32, category: &str, locale: Option<&str>) {
        let category = category.trim();
        let k = format!("category#{index}");
        let mapped = locale.and_then(|l| self.localized.get(l)).and_then(|m| {
            m.iter()
                .find(|(key, v)| key.starts_with("category#") && v.as_str() == category)
                .and_then(|(key, _)| self.props.get(key).cloned())
        });
        match mapped {
            Some(main) => {
                self.props.insert(k.clone(), main);
                if let Some(map) = locale.and_then(|l| self.localized.get_mut(l)) {
                    map.insert(k, category.to_owned());
                }
            }
            None => {
                self.props.insert(k.clone(), category.to_owned());
                for map in self.localized.values_mut() {
                    map.remove(&k);
                }
            }
        }
    }

    /// Resources of an item: (key, path inside the ZIP without leading `/`).
    fn resources(&self, index: u32) -> Vec<(String, String)> {
        RESOURCE_KEYS
            .iter()
            .filter_map(|key| {
                let v = self.props.get(&format!("{key}#{index}"))?;
                Some(((*key).to_owned(), v.trim_start_matches('/').to_owned()))
            })
            .collect()
    }

    /// Files belonging to a resource: the file itself, or for a multi-part model all files of
    /// its folder.
    fn resource_files(&self, index: u32, key: &str, path: &str) -> Vec<String> {
        let multi = key == "model"
            && self
                .props
                .get(&format!("multiPartModel#{index}"))
                .is_some_and(|v| v.trim().eq_ignore_ascii_case("true"));
        match (multi, path.rsplit_once('/')) {
            (true, Some((dir, _))) => {
                let prefix = format!("{dir}/");
                self.files
                    .iter()
                    .filter(|(n, _)| n.starts_with(&prefix))
                    .map(|(n, _)| n.clone())
                    .collect()
            }
            _ => self
                .files
                .iter()
                .filter(|(n, _)| n == path)
                .map(|(n, _)| n.clone())
                .collect(),
        }
    }

    /// Removes an item with its keys, translations and the resources no other item uses.
    pub fn remove_item(&mut self, index: u32) {
        let mut doomed: BTreeSet<String> = BTreeSet::new();
        for (key, path) in self.resources(index) {
            doomed.extend(self.resource_files(index, &key, &path));
        }
        let suffix = format!("#{index}");
        self.props.retain(|k, _| !k.ends_with(&suffix));
        for map in self.localized.values_mut() {
            map.retain(|k, _| !k.ends_with(&suffix));
        }
        // Files still used by other items stay
        let others: Vec<u32> = self.indexes();
        for i in others {
            for (key, path) in self.resources(i) {
                for f in self.resource_files(i, &key, &path) {
                    doomed.remove(&f);
                }
            }
        }
        self.files.retain(|(n, _)| !doomed.contains(n));
    }

    /// Next free item index.
    pub fn next_index(&self) -> u32 {
        self.indexes().last().map_or(1, |i| i + 1)
    }

    /// Adds a file to the library (replacing one with the same name).
    pub fn push_file(&mut self, name: String, data: Vec<u8>) {
        self.files.retain(|(n, _)| n != &name);
        self.files.push((name, data));
    }

    /// Replaces a resource of an item (e.g. a new icon) with `data` under `file`.
    pub fn set_resource(&mut self, index: u32, key: &str, file: &str, data: Vec<u8>) {
        let name = self.free_name(&format!("{index}/{file}"));
        self.props
            .insert(format!("{key}#{index}"), format!("/{name}"));
        self.push_file(name, data);
    }

    /// A file name not used in the library yet (`dir/name`, `dir/name-2`, …).
    pub(crate) fn free_name(&self, wanted: &str) -> String {
        if !self.files.iter().any(|(n, _)| n == wanted) {
            return wanted.to_owned();
        }
        let (stem, ext) = match wanted.rsplit_once('.') {
            Some((s, e)) if !s.is_empty() => (s.to_owned(), format!(".{e}")),
            _ => (wanted.to_owned(), String::new()),
        };
        (2..)
            .map(|n| format!("{stem}-{n}{ext}"))
            .find(|c| !self.files.iter().any(|(n, _)| n == c))
            .unwrap_or_else(|| wanted.to_owned())
    }

    /// Copies an item of `source` (which may be this library) into this library with a new
    /// catalog ID and its own copies of the resources. Returns the new index.
    pub fn copy_item_from(&mut self, source: &EditableLibrary, index: u32) -> u32 {
        let n = self.next_index();
        let mut values = source.item(index);
        for (key, path) in source.resources(index) {
            let files = source.resource_files(index, &key, &path);
            let multi = files.len() > 1 || files.first().is_some_and(|f| f != &path);
            let base_dir = path.rsplit_once('/').map(|(d, _)| d.to_owned());
            let mut new_main = None;
            for f in &files {
                let Some((_, data)) = source.files.iter().find(|(name, _)| name == f) else {
                    continue;
                };
                let rel = match (&base_dir, multi) {
                    (Some(d), true) => f.strip_prefix(&format!("{d}/")).unwrap_or(f).to_owned(),
                    _ => f.rsplit('/').next().unwrap_or(f).to_owned(),
                };
                let target = if multi {
                    format!("{n}/{key}/{rel}")
                } else {
                    self.free_name(&format!("{n}/{rel}"))
                };
                if f == &path {
                    new_main = Some(target.clone());
                }
                self.files.push((target, data.clone()));
            }
            if let Some(m) = new_main {
                values.insert(key, format!("/{m}"));
            }
        }
        values.insert("id".into(), new_catalog_id());
        for (k, v) in values {
            self.props.insert(format!("{k}#{n}"), v);
        }
        for (loc, map) in &source.localized {
            let translated = item_of(map, index);
            if translated.is_empty() {
                continue;
            }
            let target = self.localized.entry(loc.clone()).or_default();
            for (k, v) in translated {
                target.insert(format!("{k}#{n}"), v);
            }
        }
        n
    }
}

fn item_of(map: &BTreeMap<String, String>, index: u32) -> BTreeMap<String, String> {
    map.iter()
        .filter_map(|(k, v)| {
            let (key, i) = split_key(k)?;
            (i == index).then(|| (key.to_owned(), v.clone()))
        })
        .collect()
}

/// Writes a file atomically (temporary file, then rename).
fn write_file(path: &Path, data: &[u8]) -> Result<(), CatalogError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(io_err(path))?;
    }
    let tmp = path.with_extension("msh-tmp");
    std::fs::write(&tmp, data).map_err(io_err(path))?;
    std::fs::rename(&tmp, path).map_err(io_err(path))
}

/// A file name for a new library from its name (in the user's folder of that kind).
pub fn new_library_path(dir: &Path, kind: CatalogKind, name: &str) -> PathBuf {
    let ext = match kind {
        CatalogKind::Furniture => "sh3f",
        CatalogKind::Textures => "sh3t",
    };
    let clean: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || " -_".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let clean = clean.trim();
    let base = if clean.is_empty() { "Library" } else { clean };
    let mut path = dir.join(format!("{base}.{ext}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{base} {n}.{ext}"));
        n += 1;
    }
    path
}

// ---- Undo history ------------------------------------------------------------------------

/// One file before and after a change (`None`: the file did not exist).
#[derive(Debug, Clone)]
struct FileChange {
    path: PathBuf,
    before: Option<Vec<u8>>,
    after: Option<Vec<u8>>,
}

#[derive(Debug, Clone)]
struct Step {
    label: String,
    changes: Vec<FileChange>,
}

#[derive(Default)]
struct History {
    undo: Vec<Step>,
    redo: Vec<Step>,
}

static HISTORY: Mutex<History> = Mutex::new(History {
    undo: Vec::new(),
    redo: Vec::new(),
});

/// Steps kept for undo (library files can be large).
const MAX_STEPS: usize = 30;

fn read_opt(path: &Path) -> Option<Vec<u8>> {
    std::fs::read(path).ok()
}

/// Runs `change`, which may write the files `paths`, and records it for undo as `label`.
pub fn record<T>(
    label: &str,
    paths: &[PathBuf],
    change: impl FnOnce() -> Result<T, CatalogError>,
) -> Result<T, CatalogError> {
    let before: Vec<Option<Vec<u8>>> = paths.iter().map(|p| read_opt(p)).collect();
    let result = change()?;
    let changes = paths
        .iter()
        .zip(before)
        .map(|(p, b)| FileChange {
            path: p.clone(),
            before: b,
            after: read_opt(p),
        })
        .filter(|c| c.before != c.after)
        .collect::<Vec<_>>();
    if !changes.is_empty() {
        let mut h = HISTORY.lock().unwrap_or_else(|e| e.into_inner());
        h.undo.push(Step {
            label: label.to_owned(),
            changes,
        });
        if h.undo.len() > MAX_STEPS {
            h.undo.remove(0);
        }
        h.redo.clear();
    }
    Ok(result)
}

fn apply(changes: &[FileChange], forward: bool) -> Result<(), CatalogError> {
    for c in changes {
        match if forward { &c.after } else { &c.before } {
            Some(data) => write_file(&c.path, data)?,
            None => {
                if c.path.exists() {
                    std::fs::remove_file(&c.path).map_err(io_err(&c.path))?;
                }
            }
        }
    }
    Ok(())
}

/// Undoes the last recorded change; returns its label (None: nothing to undo).
pub fn undo() -> Result<Option<String>, CatalogError> {
    let mut h = HISTORY.lock().unwrap_or_else(|e| e.into_inner());
    let Some(step) = h.undo.pop() else {
        return Ok(None);
    };
    apply(&step.changes, false)?;
    let label = step.label.clone();
    h.redo.push(step);
    Ok(Some(label))
}

/// Redoes the last undone change; returns its label.
pub fn redo() -> Result<Option<String>, CatalogError> {
    let mut h = HISTORY.lock().unwrap_or_else(|e| e.into_inner());
    let Some(step) = h.redo.pop() else {
        return Ok(None);
    };
    apply(&step.changes, true)?;
    let label = step.label.clone();
    h.undo.push(step);
    Ok(Some(label))
}

/// Labels of the next undo and redo steps.
pub fn history_state() -> (Option<String>, Option<String>) {
    let h = HISTORY.lock().unwrap_or_else(|e| e.into_inner());
    (
        h.undo.last().map(|s| s.label.clone()),
        h.redo.last().map(|s| s.label.clone()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lib_with_items(dir: &Path) -> EditableLibrary {
        let mut lib = EditableLibrary::new(&dir.join("Test.sh3f"), CatalogKind::Furniture, "Test");
        for (n, name, cat) in [(1, "Chair", "Chairs"), (2, "Table", "Tables")] {
            lib.props.insert(format!("id#{n}"), format!("test#{n}"));
            lib.props.insert(format!("name#{n}"), name.into());
            lib.props.insert(format!("category#{n}"), cat.into());
            lib.props
                .insert(format!("icon#{n}"), format!("/{n}/icon.png"));
            lib.props
                .insert(format!("model#{n}"), format!("/{n}/model/m.obj"));
            lib.props
                .insert(format!("multiPartModel#{n}"), "true".into());
            for k in ["width", "depth", "height"] {
                lib.props.insert(format!("{k}#{n}"), "50".into());
            }
            lib.files.push((format!("{n}/icon.png"), vec![n as u8]));
            lib.files
                .push((format!("{n}/model/m.obj"), b"v 0 0 0".to_vec()));
            lib.files
                .push((format!("{n}/model/m.mtl"), b"newmtl a".to_vec()));
        }
        let de = lib.localized.entry("de".into()).or_default();
        de.insert("category#1".into(), "Stühle".into());
        de.insert("category#2".into(), "Tische".into());
        lib
    }

    #[test]
    fn round_trip_keeps_items_translations_and_files() {
        let dir = std::env::temp_dir().join(format!("msh-libedit-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let lib = lib_with_items(&dir);
        lib.save().unwrap();
        let back = EditableLibrary::open(&lib.path).unwrap();
        assert_eq!(back.indexes(), vec![1, 2]);
        assert_eq!(
            back.shown(1, "category", Some("de")).as_deref(),
            Some("Stühle")
        );
        assert_eq!(back.files.len(), 6);
        // The reader of the catalog sees the same
        let catalogs = crate::open_library(&lib.path, Some("de")).unwrap();
        assert_eq!(catalogs[0].furniture.len(), 2);
        assert_eq!(catalogs[0].furniture[0].category, "Stühle");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn move_copy_and_remove() {
        let dir = std::env::temp_dir();
        let mut lib = lib_with_items(&dir);
        // A category another item shows through a translation keeps both languages
        lib.move_to_category(1, "Tische", Some("de"));
        assert_eq!(lib.props["category#1"], "Tables");
        assert_eq!(lib.localized["de"]["category#1"], "Tische");
        // A new category replaces the translations
        lib.move_to_category(2, "Garten", Some("de"));
        assert_eq!(lib.props["category#2"], "Garten");
        assert!(!lib.localized["de"].contains_key("category#2"));

        let source = lib.clone();
        let n = lib.copy_item_from(&source, 1);
        assert_eq!(n, 3);
        assert_ne!(lib.props["id#3"], lib.props["id#1"]);
        assert_eq!(lib.props["model#3"], "/3/model/m.obj");
        assert!(lib.files.iter().any(|(f, _)| f == "3/model/m.mtl"));
        assert_eq!(lib.localized["de"]["category#3"], "Tische");

        lib.remove_item(1);
        assert!(!lib.has_item(1));
        assert!(!lib.files.iter().any(|(f, _)| f.starts_with("1/")));
        assert!(lib.files.iter().any(|(f, _)| f == "3/icon.png"));
    }

    #[test]
    fn undo_and_redo_restore_files() {
        let dir = std::env::temp_dir().join(format!("msh-libundo-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("Undo.sh3f");
        let lib = lib_with_items(&dir);
        let mut lib = EditableLibrary {
            path: path.clone(),
            ..lib
        };
        record("create", std::slice::from_ref(&path), || lib.save()).unwrap();
        record("rename", std::slice::from_ref(&path), || {
            lib.set_name("Renamed");
            lib.save()
        })
        .unwrap();
        assert_eq!(
            EditableLibrary::open(&path).unwrap().name(None).as_deref(),
            Some("Renamed")
        );
        assert_eq!(undo().unwrap().as_deref(), Some("rename"));
        assert_eq!(
            EditableLibrary::open(&path).unwrap().name(None).as_deref(),
            Some("Test")
        );
        assert_eq!(redo().unwrap().as_deref(), Some("rename"));
        assert_eq!(
            EditableLibrary::open(&path).unwrap().name(None).as_deref(),
            Some("Renamed")
        );
        undo().unwrap();
        undo().unwrap();
        assert!(!path.exists(), "undoing the creation removes the file");
        std::fs::remove_dir_all(&dir).ok();
    }
}
