//! Tauri commands called by the frontend.
//!
//! These are read-only viewer commands (phase P2). Editing commands come from
//! the `msh-core` command registry in phase P3.

use crate::state::{AppState, OpenDoc};
use msh_catalog::{CatalogKind, open_library};
use msh_format::Sh3dDocument;
use msh_geometry::WallShape;
use msh_model::Home;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub fn app_info() -> msh_core::AppInfo {
    msh_core::app_info()
}

/// File passed on the command line (e.g. `msh-app.exe house.sh3d`).
#[tauri::command]
pub fn startup_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-') && Path::new(a).is_file())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedHome {
    pub id: u32,
    pub path: PathBuf,
    pub home: Home,
    pub wall_shapes: Vec<WallShape>,
}

/// Opens a `.sh3d` file or a standalone `Home.xml`.
#[tauri::command]
pub async fn open_home(path: String, state: State<'_, AppState>) -> CmdResult<OpenedHome> {
    let path = PathBuf::from(path);
    let p = path.clone();
    let doc = tauri::async_runtime::spawn_blocking(move || -> CmdResult<Sh3dDocument> {
        let is_xml = p.extension().is_some_and(|e| e.eq_ignore_ascii_case("xml"));
        if is_xml {
            let bytes = std::fs::read(&p).map_err(err)?;
            Ok(Sh3dDocument::new(
                msh_format::read_home_xml(&bytes).map_err(err)?,
            ))
        } else {
            Sh3dDocument::open(&p).map_err(err)
        }
    })
    .await
    .map_err(err)??;

    let home = doc.home.clone();
    let wall_shapes = msh_geometry::wall_shapes(&home);
    let id = state.add_doc(OpenDoc::new(doc));
    Ok(OpenedHome {
        id,
        path,
        home,
        wall_shapes,
    })
}

#[tauri::command]
pub fn close_home(id: u32, state: State<'_, AppState>) {
    state.close_doc(id);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDto {
    pub index: usize,
    pub path: PathBuf,
    pub name: Option<String>,
    pub kind: CatalogKind,
    pub license: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItemDto {
    pub library: usize,
    pub kind: CatalogKind,
    pub id: Option<String>,
    pub name: String,
    pub category: String,
    pub creator: Option<String>,
    pub license: Option<String>,
    pub tags: Vec<String>,
    /// Entry of the icon (furniture) or image (texture) inside the library
    pub icon: Option<String>,
    pub model: Option<String>,
    pub width: f32,
    pub depth: f32,
    pub height: f32,
    pub door_or_window: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDto {
    pub libraries: Vec<LibraryDto>,
    pub items: Vec<CatalogItemDto>,
    pub errors: Vec<String>,
}

/// Loads all furniture and texture catalogs found on this machine.
#[tauri::command]
pub async fn catalog_load(lang: String, state: State<'_, AppState>) -> CmdResult<CatalogDto> {
    let store = state.libraries();
    tauri::async_runtime::spawn_blocking(move || {
        let mut dto = CatalogDto {
            libraries: Vec::new(),
            items: Vec::new(),
            errors: Vec::new(),
        };
        for (index, path) in store.paths.iter().enumerate() {
            let catalogs = match open_library(path, Some(&lang)) {
                Ok(c) => c,
                Err(e) => {
                    dto.errors.push(e.to_string());
                    continue;
                }
            };
            for c in catalogs {
                if c.furniture.is_empty() && c.textures.is_empty() {
                    continue;
                }
                dto.libraries.push(LibraryDto {
                    index,
                    path: path.clone(),
                    name: c.name.clone(),
                    kind: c.kind,
                    license: c.license.clone(),
                });
                dto.items
                    .extend(c.furniture.into_iter().map(|f| CatalogItemDto {
                        library: index,
                        kind: CatalogKind::Furniture,
                        id: f.id,
                        name: f.name,
                        category: f.category,
                        creator: f.creator,
                        license: f.license.or_else(|| c.license.clone()),
                        tags: f.tags,
                        icon: f.icon,
                        model: f.model,
                        width: f.width,
                        depth: f.depth,
                        height: f.height,
                        door_or_window: f.door_or_window,
                    }));
                dto.items
                    .extend(c.textures.into_iter().map(|t| CatalogItemDto {
                        library: index,
                        kind: CatalogKind::Textures,
                        id: t.id,
                        name: t.name,
                        category: t.category,
                        creator: t.creator,
                        license: c.license.clone(),
                        tags: Vec::new(),
                        icon: Some(t.image),
                        model: None,
                        width: t.width,
                        depth: 0.0,
                        height: t.height,
                        door_or_window: false,
                    }));
            }
        }
        dto
    })
    .await
    .map_err(err)
}
