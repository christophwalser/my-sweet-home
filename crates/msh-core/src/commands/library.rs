//! Furniture and texture libraries: list, import and remove.
//!
//! Imported libraries are copied into the user's library folders of Sweet Home 3D
//! (`%APPDATA%\eTeks\Sweet Home 3D\furniture` and `\textures`), so both applications
//! use them. Removing moves a library to a `removed` folder next to them (it can be
//! restored by moving it back). Any library can be hidden from the catalog, and items can be
//! given another category; both are stored in My Sweet Home's catalog settings.

use crate::catalog::CatalogIndex;
use crate::catalog_settings::{CatalogSettings, ItemKind};
use crate::registry::{CommandError, Registry};
use msh_catalog::{
    CatalogKind, find_all_libraries, is_user_library, open_library, user_library_dir,
};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

#[derive(Deserialize, JsonSchema)]
struct NoParams {}

#[derive(Deserialize, JsonSchema)]
struct ImportParams {
    /// Path of a furniture (.sh3f) or texture (.sh3t) library file
    path: PathBuf,
    /// Replace a library with the same file name in the user folder
    replace: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
struct VisibleParams {
    /// Path of a library (see library_list)
    path: PathBuf,
    /// Show (true) or hide (false) its items in the catalog
    visible: bool,
}

#[derive(Deserialize, JsonSchema, Default, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum KindParam {
    #[default]
    Furniture,
    Textures,
}

#[derive(Deserialize, JsonSchema)]
struct CategoryParams {
    /// Catalog ID of the item (see catalog_search)
    catalog_id: String,
    /// "furniture" (default) or "textures"
    kind: Option<KindParam>,
    /// New category; empty restores the library's own category
    category: String,
}

#[derive(Deserialize, JsonSchema)]
struct RemoveParams {
    /// Path of a library in the user's library folder (see library_list)
    path: PathBuf,
}

fn kind_name(kind: CatalogKind) -> &'static str {
    match kind {
        CatalogKind::Furniture => "furniture",
        CatalogKind::Textures => "textures",
    }
}

/// Summary of one library file.
fn describe(path: &Path) -> Value {
    let hidden = CatalogSettings::load().is_hidden(path);
    match open_library(path, Some("en")) {
        Ok(catalogs) => {
            let first = catalogs.first();
            json!({
                "path": path,
                "name": first.and_then(|c| c.name.clone()),
                "kind": first.map(|c| kind_name(c.kind)),
                "furniture": catalogs.iter().map(|c| c.furniture.len()).sum::<usize>(),
                "textures": catalogs.iter().map(|c| c.textures.len()).sum::<usize>(),
                "license": first.and_then(|c| c.license.clone()),
                "user": is_user_library(path),
                "hidden": hidden,
            })
        }
        Err(e) => json!({
            "path": path,
            "error": e.to_string(),
            "user": is_user_library(path),
            "hidden": hidden,
        }),
    }
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "library_list",
        "Lists the furniture and texture libraries found on this machine (Sweet Home 3D \
         installation, Store version and the user's libraries). user=true marks libraries \
         that can be removed, hidden=true libraries whose items are not shown in the catalog.",
        false,
        |_doc, _p: NoParams| {
            let libraries: Vec<Value> = find_all_libraries(&[])
                .iter()
                .map(|p| describe(p))
                .collect();
            Ok(json!({ "libraries": libraries }))
        },
    );
    r.add(
        "library_import",
        "Imports a furniture (.sh3f) or texture (.sh3t) library: it is copied into the user's \
         library folder shared with Sweet Home 3D, and its items appear in the catalog.",
        false,
        |_doc, p: ImportParams| {
            let catalogs = open_library(&p.path, Some("en"))
                .map_err(|e| CommandError::failed(format!("not a valid library: {e}")))?;
            let kind = catalogs
                .iter()
                .find(|c| !c.furniture.is_empty() || !c.textures.is_empty())
                .map(|c| c.kind)
                .ok_or_else(|| CommandError::failed("the library contains no items"))?;
            let dir = user_library_dir(kind)
                .ok_or_else(|| CommandError::failed("the user library folder is unknown"))?;
            let file_name = p
                .path
                .file_name()
                .ok_or_else(|| CommandError::failed("the path has no file name"))?;
            let target = dir.join(file_name);
            if target == p.path {
                return Err(CommandError::failed(
                    "the library is already in the user folder",
                ));
            }
            if target.exists() && p.replace != Some(true) {
                return Err(CommandError::failed(format!(
                    "a library named {} exists already (use replace=true)",
                    file_name.to_string_lossy()
                )));
            }
            std::fs::create_dir_all(&dir).map_err(|e| CommandError::failed(e.to_string()))?;
            std::fs::copy(&p.path, &target).map_err(|e| CommandError::failed(e.to_string()))?;
            CatalogIndex::reload();
            Ok(describe(&target))
        },
    );
    r.add(
        "library_set_visible",
        "Shows or hides a library's items in the catalog. The library file stays where it is; \
         homes that use its items are not affected.",
        false,
        |_doc, p: VisibleParams| {
            if !find_all_libraries(&[]).iter().any(|l| l == &p.path) {
                return Err(CommandError::failed("unknown library (see library_list)"));
            }
            let mut settings = CatalogSettings::load();
            settings.set_hidden(&p.path, !p.visible);
            settings.save().map_err(CommandError::failed)?;
            CatalogIndex::reload();
            Ok(describe(&p.path))
        },
    );
    r.add(
        "catalog_set_category",
        "Moves a catalog item (furniture or texture) to another category of the catalog. An \
         empty category restores the library's own. Works for all libraries, as the choice is \
         stored in My Sweet Home's catalog settings, not in the library file.",
        false,
        |_doc, p: CategoryParams| {
            let kind = match p.kind.unwrap_or_default() {
                KindParam::Furniture => ItemKind::Furniture,
                KindParam::Textures => ItemKind::Textures,
            };
            let category_of = |index: &CatalogIndex| match kind {
                ItemKind::Furniture => index
                    .furniture_by_id(&p.catalog_id)
                    .map(|f| f.item.category.clone()),
                ItemKind::Textures => index
                    .texture_by_id(&p.catalog_id)
                    .map(|t| t.item.category.clone()),
            };
            if category_of(&CatalogIndex::get()).is_none() {
                return Err(CommandError::failed(format!(
                    "no catalog item with ID {} (see catalog_search)",
                    p.catalog_id
                )));
            }
            let mut settings = CatalogSettings::load();
            settings.set_category(kind, &p.catalog_id, Some(&p.category));
            settings.save().map_err(CommandError::failed)?;
            CatalogIndex::reload();
            let category = category_of(&CatalogIndex::get());
            Ok(json!({ "catalog_id": p.catalog_id, "category": category }))
        },
    );
    r.add(
        "library_remove",
        "Removes a library from the user's library folder. The file is moved to a 'removed' \
         folder next to it, so it can be restored.",
        false,
        |_doc, p: RemoveParams| {
            if !is_user_library(&p.path) {
                return Err(CommandError::failed(
                    "only libraries in the user's library folder can be removed",
                ));
            }
            let parent = p
                .path
                .parent()
                .and_then(Path::parent)
                .ok_or_else(|| CommandError::failed("invalid library path"))?;
            let removed = parent.join("removed");
            std::fs::create_dir_all(&removed).map_err(|e| CommandError::failed(e.to_string()))?;
            let name = p.path.file_name().unwrap_or_default();
            let mut target = removed.join(name);
            let mut n = 1;
            while target.exists() {
                target = removed.join(format!("{}.{n}", name.to_string_lossy()));
                n += 1;
            }
            std::fs::rename(&p.path, &target).map_err(|e| CommandError::failed(e.to_string()))?;
            CatalogIndex::reload();
            Ok(json!({ "removed": p.path, "moved_to": target }))
        },
    );
}
