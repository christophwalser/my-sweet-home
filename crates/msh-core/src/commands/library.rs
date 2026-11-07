//! Furniture and texture libraries: list, import and remove.
//!
//! Imported libraries are copied into the user's library folders of Sweet Home 3D
//! (`%APPDATA%\eTeks\Sweet Home 3D\furniture` and `\textures`), so both applications
//! use them. Removing moves a library to a `removed` folder next to them (it can be
//! restored by moving it back).

use crate::catalog::CatalogIndex;
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
            })
        }
        Err(e) => json!({ "path": path, "error": e.to_string(), "user": is_user_library(path) }),
    }
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "library_list",
        "Lists the furniture and texture libraries found on this machine (Sweet Home 3D \
         installation, Store version and the user's libraries). user=true marks libraries \
         that can be removed.",
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
