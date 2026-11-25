//! Editing libraries: create and rename libraries, change, move, copy and remove their items,
//! add categories, and undo or redo these changes.
//!
//! Libraries in the user's library folders can be changed (also imported ones, shared with
//! Sweet Home 3D); the libraries of the installation are read-only, their items can be
//! copied into an own library and changed there.

use crate::catalog::CatalogIndex;
use crate::catalog_settings::{CatalogSettings, ItemKind};
use crate::registry::{CommandError, Registry};
use base64::Engine;
use msh_catalog::library_edit::{
    EditableLibrary, history_state, is_editable, new_library_path, record,
};
use msh_catalog::{CatalogKind, find_all_libraries, user_library_dir};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Keys that hold files of the library: they are changed by their own commands.
const RESOURCE_KEYS: [&str; 4] = ["icon", "planIcon", "model", "image"];

#[derive(Deserialize, JsonSchema, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum KindParam {
    Furniture,
    Textures,
}

impl From<KindParam> for CatalogKind {
    fn from(k: KindParam) -> Self {
        match k {
            KindParam::Furniture => CatalogKind::Furniture,
            KindParam::Textures => CatalogKind::Textures,
        }
    }
}

#[derive(Deserialize, JsonSchema)]
struct CreateParams {
    /// "furniture" or "textures"
    kind: KindParam,
    /// Name of the new library
    name: String,
}

#[derive(Deserialize, JsonSchema)]
struct RenameParams {
    /// Path of the library (see library_list)
    path: PathBuf,
    name: String,
}

#[derive(Deserialize, JsonSchema)]
struct ItemParams {
    /// Path of the library (see library_list)
    path: PathBuf,
    /// Index of the item in the library (see library_items)
    index: u32,
    /// Language of translated texts, e.g. "de" (default: the untranslated texts)
    lang: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct ItemsParams {
    /// Path of a library; without it all libraries of `kind` are searched
    path: Option<PathBuf>,
    /// "furniture" (default) or "textures"
    kind: Option<KindParam>,
    /// Words to search in name, category, tags and creator (all must match)
    query: Option<String>,
    /// Language of translated texts, e.g. "de"
    lang: Option<String>,
    /// Maximum number of results (default 200)
    limit: Option<usize>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateParams {
    /// Path of the library (see library_list)
    path: PathBuf,
    /// Index of the item in the library
    index: u32,
    /// Keys of Sweet Home 3D's library format to set, e.g. {"name": "Sofa", "width": "200",
    /// "doorOrWindow": "true", "doorOrWindowCutOutShape": "M0,0 ...", "lightSourceX": "0.5"};
    /// null removes a key. "category" moves the item. Resources (icon, model, image) and
    /// the catalog ID cannot be set here.
    set: BTreeMap<String, Option<String>>,
    /// Language of the texts being changed, e.g. "de": a translation the item has in that
    /// language is changed instead of the untranslated text
    lang: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateItemsParams {
    /// Path of the library (see library_list)
    path: PathBuf,
    /// Indexes of the items to change
    indexes: Vec<u32>,
    /// Keys to set in each of the items, as in library_update_item, e.g. {"creator": "Jane",
    /// "license": "CC0", "movable": "false"}; null removes a key
    set: BTreeMap<String, Option<String>>,
    /// Language of the texts being changed, e.g. "de"
    lang: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct MoveParams {
    /// Path of the library (see library_list)
    path: PathBuf,
    /// Indexes of the items to move
    indexes: Vec<u32>,
    /// Category as shown in `lang`; a new name creates the category
    category: String,
    /// Language the category name is given in, e.g. "de"
    lang: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct CopyParams {
    /// Library of the items (see library_list)
    from: PathBuf,
    /// Indexes of the items to copy
    indexes: Vec<u32>,
    /// Target library (default: the user's own library of that kind); the same library as
    /// `from` duplicates the items
    to: Option<PathBuf>,
    /// Name of the copies (only with one item), e.g. "Sofa (copy)"
    name: Option<String>,
    /// Names of the copies of several items, in the order of `indexes`
    names: Option<Vec<String>>,
    /// Language of `name` and `names`, e.g. "de"
    lang: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct RemoveParams {
    /// Path of the library (see library_list)
    path: PathBuf,
    /// Indexes of the items to remove
    indexes: Vec<u32>,
}

#[derive(Deserialize, JsonSchema)]
struct CategoryParams {
    /// Path of the library (see library_list)
    path: PathBuf,
    /// Name of the new category
    name: String,
}

#[derive(Deserialize, JsonSchema)]
struct CategoriesParams {
    /// Path of the library (see library_list)
    path: PathBuf,
    /// Language of the names, e.g. "de"
    lang: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct IconParams {
    /// Path of the library (see library_list)
    path: PathBuf,
    /// Index of the item
    index: u32,
    /// The new icon as PNG (base64)
    png_base64: String,
}

#[derive(Deserialize, JsonSchema)]
struct FromHomeParams {
    /// IDs of pieces of the home (groups are left out)
    ids: Vec<String>,
    /// Target library (default: the user's own furniture library)
    path: Option<PathBuf>,
    /// Category of the new items (default "From the home")
    category: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct NoParams {}

/// First path segment of a resource name of a home (`1/door.obj` â†’ `1`).
fn top_segment(name: &str) -> &str {
    name.split('/').next().unwrap_or(name)
}

/// Whether the home brings the model of a piece (furniture of the default catalog may only
/// refer to it).
fn has_model(doc: &crate::Document, piece: &msh_model::Piece) -> bool {
    piece.attrs.model.as_deref().is_some_and(|model| {
        let top = top_segment(model);
        doc.file
            .contents
            .iter()
            .any(|c| top_segment(&c.name) == top)
    })
}

/// Adds a piece of the home with its model and icon to `lib`; returns the new index.
fn add_piece(
    lib: &mut EditableLibrary,
    doc: &crate::Document,
    piece: &msh_model::Piece,
    category: &str,
) -> Option<u32> {
    let a = &piece.attrs;
    let model = a.model.as_deref()?;
    let n = lib.next_index();
    let contents = &doc.file.contents;
    let top = top_segment(model);
    let parts: Vec<_> = contents
        .iter()
        .filter(|c| top_segment(&c.name) == top)
        .collect();
    if parts.is_empty() {
        return None;
    }
    // A single model is one entry named like the segment; multi-part models keep their folder
    let multi = parts.len() > 1 || model.contains('/');
    let model_value = if multi {
        for c in &parts {
            let rel = c.name.strip_prefix(&format!("{top}/")).unwrap_or(&c.name);
            lib.push_file(format!("{n}/model/{rel}"), c.data.clone());
        }
        let rel = model.strip_prefix(&format!("{top}/")).unwrap_or(model);
        format!("/{n}/model/{rel}")
    } else {
        lib.push_file(format!("{n}/model.obj"), parts[0].data.clone());
        format!("/{n}/model.obj")
    };
    let mut put = |k: &str, v: String| {
        lib.props.insert(format!("{k}#{n}"), v);
    };
    put("id", msh_catalog::user_library::new_catalog_id());
    put("name", a.name.clone());
    put("category", category.to_owned());
    put("model", model_value);
    if multi {
        put("multiPartModel", "true".into());
    }
    put("width", a.width.to_string());
    put("depth", a.depth.to_string());
    put("height", a.height.to_string());
    put("elevation", a.elevation.unwrap_or(0.0).to_string());
    put("movable", a.movable.unwrap_or(true).to_string());
    let door = piece.kind == msh_model::PieceKind::DoorOrWindow;
    put("doorOrWindow", door.to_string());
    let opt = |v: &Option<String>| v.clone().filter(|s| !s.is_empty());
    for (k, v) in [
        ("creator", opt(&a.creator)),
        ("license", opt(&a.license)),
        ("description", opt(&a.description)),
        ("information", opt(&a.information)),
        ("price", opt(&a.price)),
        (
            "valueAddedTaxPercentage",
            opt(&a.value_added_tax_percentage),
        ),
        ("modelRotation", opt(&a.model_rotation)),
        ("staircaseCutOutShape", opt(&a.staircase_cut_out_shape)),
        (
            "wallThickness",
            door.then_some(a.wall_thickness)
                .flatten()
                .map(|v| v.to_string()),
        ),
        (
            "wallDistance",
            door.then_some(a.wall_distance)
                .flatten()
                .map(|v| v.to_string()),
        ),
    ] {
        if let Some(v) = v {
            put(k, v);
        }
    }
    if let Some(icon) = a.icon.as_deref()
        && let Some(c) = contents.iter().find(|c| c.name == icon)
    {
        lib.push_file(format!("{n}/icon.png"), c.data.clone());
        lib.props
            .insert(format!("icon#{n}"), format!("/{n}/icon.png"));
    }
    Some(n)
}

fn failed(e: impl std::fmt::Display) -> CommandError {
    CommandError::failed(e.to_string())
}

fn known_library(path: &Path) -> Result<(), CommandError> {
    if find_all_libraries(&[]).iter().any(|l| l == path) {
        Ok(())
    } else {
        Err(CommandError::failed(format!(
            "unknown library {} (see library_list)",
            path.display()
        )))
    }
}

fn open_editable(path: &Path) -> Result<EditableLibrary, CommandError> {
    known_library(path)?;
    if !is_editable(path) {
        return Err(CommandError::failed(format!(
            "{} is read-only (a library of the installation): copy its items into an own \
             library with library_copy_items",
            path.display()
        )));
    }
    EditableLibrary::open(path).map_err(failed)
}

fn kind_name(kind: CatalogKind) -> &'static str {
    match kind {
        CatalogKind::Furniture => "furniture",
        CatalogKind::Textures => "textures",
    }
}

fn item_kind(kind: CatalogKind) -> ItemKind {
    match kind {
        CatalogKind::Furniture => ItemKind::Furniture,
        CatalogKind::Textures => ItemKind::Textures,
    }
}

/// An item as JSON: its keys, the texts shown in `lang` and where it lives.
fn item_json(lib: &EditableLibrary, index: u32, lang: Option<&str>) -> Value {
    let values: Map<String, Value> = lib
        .item(index)
        .into_iter()
        .map(|(k, v)| (k, Value::String(v)))
        .collect();
    let translated: Map<String, Value> = lang
        .map(|l| lib.item_localized(index, l))
        .unwrap_or_default()
        .into_iter()
        .map(|(k, v)| (k, Value::String(v)))
        .collect();
    json!({
        "path": lib.path,
        "library": lib.name(lang),
        "editable": is_editable(&lib.path),
        "kind": kind_name(lib.kind),
        "index": index,
        "id": lib.item(index).get("id"),
        "name": lib.shown(index, "name", lang),
        "category": lib.shown(index, "category", lang),
        "values": values,
        "translated": translated,
    })
}

/// Drops categories chosen in the catalog settings for items whose file now says it itself.
fn clear_category_overrides(lib: &EditableLibrary, indexes: &[u32]) {
    let mut settings = CatalogSettings::load();
    let mut changed = false;
    for &i in indexes {
        if let Some(id) = lib.item(i).get("id")
            && settings.category(item_kind(lib.kind), Some(id)).is_some()
        {
            settings.set_category(item_kind(lib.kind), id, None);
            changed = true;
        }
    }
    if changed {
        let _ = settings.save();
    }
}

fn check_items(lib: &EditableLibrary, indexes: &[u32]) -> Result<(), CommandError> {
    if indexes.is_empty() {
        return Err(CommandError::failed("no items given"));
    }
    match indexes.iter().find(|&&i| !lib.has_item(i)) {
        Some(i) => Err(CommandError::failed(format!(
            "the library has no item {i} (see library_items)"
        ))),
        None => Ok(()),
    }
}

/// Refuses keys of items that have their own commands, invalid keys and an empty name or
/// category.
fn check_set(set: &BTreeMap<String, Option<String>>) -> Result<(), CommandError> {
    if let Some(k) = set
        .keys()
        .find(|k| k.as_str() == "id" || RESOURCE_KEYS.contains(&k.as_str()))
    {
        return Err(CommandError::failed(format!("'{k}' cannot be set here")));
    }
    if let Some(k) = set
        .keys()
        .find(|k| k.is_empty() || !k.chars().all(|c| c.is_ascii_alphanumeric()))
    {
        return Err(CommandError::failed(format!("invalid key '{k}'")));
    }
    for key in ["name", "category"] {
        match set.get(key) {
            Some(None) => {
                return Err(CommandError::failed(format!("'{key}' cannot be removed")));
            }
            Some(Some(v)) if v.trim().is_empty() => {
                return Err(CommandError::failed(format!("'{key}' cannot be empty")));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Sets checked keys of an item (see `check_set`).
fn set_keys(
    lib: &mut EditableLibrary,
    index: u32,
    set: &BTreeMap<String, Option<String>>,
    lang: Option<&str>,
) {
    for (key, value) in set {
        match (key.as_str(), value) {
            ("category", Some(c)) => lib.move_to_category(index, c, lang),
            (_, v) => lib.set(index, key, v.as_deref(), lang),
        }
    }
}

pub(super) fn history_json() -> Value {
    let (undo, redo) = history_state();
    json!({ "undo": undo, "redo": redo })
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "library_create",
        "Creates a new, empty furniture or texture library in the user's library folder \
         (shared with Sweet Home 3D). Returns its path.",
        false,
        |_doc, p: CreateParams| {
            let kind: CatalogKind = p.kind.into();
            let name = p.name.trim();
            if name.is_empty() {
                return Err(CommandError::failed("the name is empty"));
            }
            let dir = user_library_dir(kind)
                .ok_or_else(|| CommandError::failed("the user library folder is unknown"))?;
            let path = new_library_path(&dir, kind, name);
            let lib = EditableLibrary::new(&path, kind, name);
            record("create library", std::slice::from_ref(&path), || lib.save())
                .map_err(failed)?;
            CatalogIndex::reload();
            Ok(json!({ "path": path, "name": name, "kind": kind_name(kind), "history": history_json() }))
        },
    );
    r.add(
        "library_rename",
        "Renames a library (the name shown in the catalog and the editor; the file keeps its \
         name).",
        false,
        |_doc, p: RenameParams| {
            let mut lib = open_editable(&p.path)?;
            let name = p.name.trim();
            if name.is_empty() {
                return Err(CommandError::failed("the name is empty"));
            }
            record("rename library", std::slice::from_ref(&p.path), || {
                lib.set_name(name);
                lib.save()
            })
            .map_err(failed)?;
            CatalogIndex::reload();
            Ok(json!({ "path": p.path, "name": name, "history": history_json() }))
        },
    );
    r.add(
        "library_items",
        "Lists the items of a library, or searches all libraries of a kind (also hidden ones), \
         with their index, name, category and library. Use the index with library_item and \
         the other library_* commands.",
        false,
        |_doc, p: ItemsParams| {
            let lang = p.lang.as_deref();
            let kind: CatalogKind = p.kind.map_or(CatalogKind::Furniture, Into::into);
            let words: Vec<String> = p
                .query
                .unwrap_or_default()
                .to_lowercase()
                .split_whitespace()
                .map(str::to_owned)
                .collect();
            let limit = p.limit.unwrap_or(200);
            let paths = match &p.path {
                Some(path) => {
                    known_library(path)?;
                    vec![path.clone()]
                }
                None => find_all_libraries(&[]),
            };
            let mut items = Vec::new();
            'libs: for path in paths {
                let Ok(lib) = EditableLibrary::open(&path) else {
                    continue;
                };
                if p.path.is_none() && lib.kind != kind {
                    continue;
                }
                for i in lib.indexes() {
                    if !lib.has_item(i) {
                        continue;
                    }
                    let shown = |k: &str| lib.shown(i, k, lang).unwrap_or_default();
                    let hay = format!(
                        "{} {} {} {}",
                        shown("name"),
                        shown("category"),
                        shown("tags"),
                        shown("creator")
                    )
                    .to_lowercase();
                    if !words.iter().all(|w| hay.contains(w)) {
                        continue;
                    }
                    items.push(json!({
                        "path": path,
                        "library": lib.name(lang),
                        "index": i,
                        "id": lib.item(i).get("id"),
                        "name": shown("name"),
                        "category": shown("category"),
                    }));
                    if items.len() >= limit {
                        break 'libs;
                    }
                }
            }
            Ok(json!({ "items": items }))
        },
    );
    r.add(
        "library_item",
        "All keys of one library item (Sweet Home 3D's library format) and its texts in a \
         language.",
        false,
        |_doc, p: ItemParams| {
            known_library(&p.path)?;
            let lib = EditableLibrary::open(&p.path).map_err(failed)?;
            check_items(&lib, &[p.index])?;
            Ok(item_json(&lib, p.index, p.lang.as_deref()))
        },
    );
    r.add(
        "library_update_item",
        "Changes keys of a library item: name, tags, creator, license, price, size, elevation, \
         door or window settings, staircase cut-out, light sources, shelves, ... (Sweet Home \
         3D's library format). The catalog shows the change at once; library_undo reverts it.",
        false,
        |_doc, p: UpdateParams| {
            let mut lib = open_editable(&p.path)?;
            check_items(&lib, &[p.index])?;
            check_set(&p.set)?;
            let lang = p.lang.as_deref();
            record("change item", std::slice::from_ref(&p.path), || {
                set_keys(&mut lib, p.index, &p.set, lang);
                lib.save()
            })
            .map_err(failed)?;
            if p.set.contains_key("category") {
                clear_category_overrides(&lib, &[p.index]);
            }
            CatalogIndex::reload();
            let mut out = item_json(&lib, p.index, lang);
            out["history"] = history_json();
            Ok(out)
        },
    );
    r.add(
        "library_update_items",
        "Changes the same keys of several library items at once (creator, license, tags, \
         movable, ...; see library_update_item). One step for library_undo.",
        false,
        |_doc, p: UpdateItemsParams| {
            let mut lib = open_editable(&p.path)?;
            check_items(&lib, &p.indexes)?;
            check_set(&p.set)?;
            record("change items", std::slice::from_ref(&p.path), || {
                for &i in &p.indexes {
                    set_keys(&mut lib, i, &p.set, p.lang.as_deref());
                }
                lib.save()
            })
            .map_err(failed)?;
            if p.set.contains_key("category") {
                clear_category_overrides(&lib, &p.indexes);
            }
            CatalogIndex::reload();
            Ok(json!({ "path": p.path, "indexes": p.indexes, "history": history_json() }))
        },
    );
    r.add(
        "library_move_items",
        "Moves library items to another category of their library (a new name creates the \
         category).",
        false,
        |_doc, p: MoveParams| {
            let mut lib = open_editable(&p.path)?;
            check_items(&lib, &p.indexes)?;
            let category = p.category.trim();
            if category.is_empty() {
                return Err(CommandError::failed("the category is empty"));
            }
            record("move items", std::slice::from_ref(&p.path), || {
                for &i in &p.indexes {
                    lib.move_to_category(i, category, p.lang.as_deref());
                }
                lib.save()
            })
            .map_err(failed)?;
            clear_category_overrides(&lib, &p.indexes);
            CatalogIndex::reload();
            Ok(json!({ "path": p.path, "indexes": p.indexes, "category": category, "history": history_json() }))
        },
    );
    r.add(
        "library_copy_items",
        "Copies library items into another library (by default the user's own library), with \
         their models, icons and images; into the same library it duplicates them. Items of \
         read-only libraries are changed this way: copy, then change the copy. Returns the \
         indexes of the copies.",
        false,
        |_doc, p: CopyParams| {
            known_library(&p.from)?;
            let source = EditableLibrary::open(&p.from).map_err(failed)?;
            check_items(&source, &p.indexes)?;
            if let Some(names) = &p.names {
                if names.len() != p.indexes.len() {
                    return Err(CommandError::failed("give one name per item"));
                }
                if names.iter().any(|n| n.trim().is_empty()) {
                    return Err(CommandError::failed("a name is empty"));
                }
            }
            let to = match p.to {
                Some(t) => t,
                None => {
                    msh_catalog::user_library::default_library_path(source.kind).map_err(failed)?
                }
            };
            let mut target = if to.exists() {
                open_editable(&to)?
            } else if msh_catalog::user_library::is_default_library(&to) {
                let name = match source.kind {
                    CatalogKind::Furniture => "My furniture",
                    CatalogKind::Textures => "My textures",
                };
                EditableLibrary::new(&to, source.kind, name)
            } else {
                return Err(CommandError::failed("unknown target library"));
            };
            if target.kind != source.kind {
                return Err(CommandError::failed(
                    "furniture and textures cannot be mixed in one library",
                ));
            }
            let same = to == p.from;
            let mut created = Vec::new();
            record("copy items", std::slice::from_ref(&to), || {
                for (at, &i) in p.indexes.iter().enumerate() {
                    let src = if same { target.clone() } else { source.clone() };
                    let n = target.copy_item_from(&src, i)?;
                    let name = match (&p.names, &p.name) {
                        (Some(names), _) => names.get(at),
                        (None, Some(name)) if p.indexes.len() == 1 => Some(name),
                        _ => None,
                    };
                    if let Some(name) = name {
                        target.set(n, "name", Some(name.trim()), p.lang.as_deref());
                    }
                    created.push(n);
                }
                target.save()
            })
            .map_err(failed)?;
            CatalogIndex::reload();
            let items: Vec<Value> = created
                .iter()
                .map(|&n| item_json(&target, n, p.lang.as_deref()))
                .collect();
            Ok(json!({ "to": to, "indexes": created, "items": items, "history": history_json() }))
        },
    );
    r.add(
        "library_remove_items",
        "Removes items from a library with their models, icons and images (homes that use \
         them keep their own copies). library_undo brings them back.",
        false,
        |_doc, p: RemoveParams| {
            let mut lib = open_editable(&p.path)?;
            check_items(&lib, &p.indexes)?;
            record("remove items", std::slice::from_ref(&p.path), || {
                for &i in &p.indexes {
                    lib.remove_item(i);
                }
                lib.save()
            })
            .map_err(failed)?;
            CatalogIndex::reload();
            Ok(json!({ "path": p.path, "removed": p.indexes, "history": history_json() }))
        },
    );
    r.add(
        "library_add_category",
        "Adds a category to a library, so items can be moved there (it is shown in the \
         editor's category choices even while it is empty).",
        false,
        |_doc, p: CategoryParams| {
            let lib = open_editable(&p.path)?;
            let name = p.name.trim();
            if name.is_empty() {
                return Err(CommandError::failed("the name is empty"));
            }
            if lib
                .categories(None)
                .iter()
                .chain(lib.categories(Some("de")).iter())
                .any(|c| c.eq_ignore_ascii_case(name))
            {
                return Err(CommandError::failed(format!(
                    "the category {name} exists already"
                )));
            }
            let mut settings = CatalogSettings::load();
            if !settings.add_library_category(&p.path, name) {
                return Err(CommandError::failed(format!(
                    "the category {name} exists already"
                )));
            }
            settings.save().map_err(CommandError::failed)?;
            Ok(json!({ "path": p.path, "category": name }))
        },
    );
    r.add(
        "library_categories",
        "Categories of a library (with the ones created there that have no items yet).",
        false,
        |_doc, p: CategoriesParams| {
            known_library(&p.path)?;
            let lib = EditableLibrary::open(&p.path).map_err(failed)?;
            let mut list = lib.categories(p.lang.as_deref());
            for c in CatalogSettings::load().library_categories(&p.path) {
                if !list.iter().any(|x| x.eq_ignore_ascii_case(&c)) {
                    list.push(c);
                }
            }
            list.sort_by_key(|c| c.to_lowercase());
            Ok(json!({ "path": p.path, "categories": list }))
        },
    );
    r.add(
        "library_set_icon",
        "Replaces the catalog icon of a library item (PNG, e.g. rendered from the 3D view).",
        false,
        |_doc, p: IconParams| {
            let mut lib = open_editable(&p.path)?;
            check_items(&lib, &[p.index])?;
            let png = base64::engine::general_purpose::STANDARD
                .decode(p.png_base64.trim_start_matches("data:image/png;base64,"))
                .map_err(|e| CommandError::failed(format!("invalid icon: {e}")))?;
            if !png.starts_with(b"\x89PNG") {
                return Err(CommandError::failed("the icon is not a PNG image"));
            }
            record("change icon", std::slice::from_ref(&p.path), || {
                lib.set_resource(p.index, "icon", "icon.png", png);
                lib.save()
            })
            .map_err(failed)?;
            CatalogIndex::reload();
            Ok(json!({ "path": p.path, "index": p.index, "history": history_json() }))
        },
    );
    r.add(
        "library_add_from_home",
        "Adds pieces of the open home (with their models, icons and current size) as new items \
         to a library, e.g. to reuse a piece whose size or colors were changed. Pieces whose \
         model the home does not contain are skipped (their names are returned).",
        false,
        |doc, p: FromHomeParams| {
            let path = match p.path {
                Some(path) => path,
                None => msh_catalog::user_library::default_library_path(CatalogKind::Furniture)
                    .map_err(failed)?,
            };
            let mut lib = if path.exists() {
                open_editable(&path)?
            } else if msh_catalog::user_library::is_default_library(&path) {
                EditableLibrary::new(&path, CatalogKind::Furniture, "My furniture")
            } else {
                return Err(CommandError::failed("unknown target library"));
            };
            if lib.kind != CatalogKind::Furniture {
                return Err(CommandError::failed("the target is a texture library"));
            }
            let category = p.category.unwrap_or_else(|| "From the home".into());
            let mut pieces = Vec::new();
            doc.home().for_each_piece(|piece| {
                if piece.attrs.id.as_ref().is_some_and(|id| p.ids.contains(id)) {
                    pieces.push(piece.clone());
                }
            });
            if pieces.is_empty() {
                return Err(CommandError::failed(
                    "none of the IDs is a piece of the home",
                ));
            }
            let skipped: Vec<String> = pieces
                .iter()
                .filter(|p| !has_model(doc, p))
                .map(|p| p.attrs.name.clone())
                .collect();
            pieces.retain(|p| has_model(doc, p));
            if pieces.is_empty() {
                return Err(CommandError::failed(
                    "the home does not contain the models of these pieces: copy their items \
                     in the catalog instead",
                ));
            }
            let mut added = Vec::new();
            record("add from home", std::slice::from_ref(&path), || {
                for piece in &pieces {
                    if let Some(n) = add_piece(&mut lib, doc, piece, &category) {
                        added.push(n);
                    }
                }
                lib.save()
            })
            .map_err(failed)?;
            CatalogIndex::reload();
            Ok(json!({
                "path": path,
                "indexes": added,
                "skipped": skipped,
                "history": history_json(),
            }))
        },
    );
    r.add(
        "library_undo",
        "Undoes the last change of a library (items, names, categories, imports).",
        false,
        |_doc, _p: NoParams| {
            let label = msh_catalog::library_edit::undo().map_err(failed)?;
            CatalogIndex::reload();
            Ok(json!({ "undone": label, "history": history_json() }))
        },
    );
    r.add(
        "library_redo",
        "Redoes the last undone change of a library.",
        false,
        |_doc, _p: NoParams| {
            let label = msh_catalog::library_edit::redo().map_err(failed)?;
            CatalogIndex::reload();
            Ok(json!({ "redone": label, "history": history_json() }))
        },
    );
    r.add(
        "library_history",
        "Labels of the next library_undo and library_redo steps.",
        false,
        |_doc, _p: NoParams| Ok(history_json()),
    );
}
