//! Tauri commands called by the frontend.
//!
//! Changes to the home go through `execute`, which runs a command of the
//! `msh-core` registry — the same commands the CLI and the MCP server use.

use crate::state::{self, AppState, HomeView};
use msh_catalog::{CatalogKind, open_library};
use serde::Serialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

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

/// The open home, if any (used when the frontend starts or reloads).
#[tauri::command]
pub fn current_home(state: State<'_, AppState>) -> Option<HomeView> {
    state.current()
}

/// Opens a `.sh3d` file or a standalone `Home.xml`.
#[tauri::command]
pub async fn open_home(path: String, app: AppHandle) -> CmdResult<HomeView> {
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        state::execute(&a, "home_open", json!({ "path": path }))
    })
    .await
    .map_err(err)??;
    app_state(&app)
        .current()
        .ok_or_else(|| "no home open".into())
}

/// Runs a registry command (e.g. `edit_undo`, `home_save`) on the open home.
#[tauri::command]
pub async fn execute(command: String, params: Value, app: AppHandle) -> CmdResult<Value> {
    tauri::async_runtime::spawn_blocking(move || state::execute(&app, &command, params))
        .await
        .map_err(err)?
}

/// Result of a 3D capture requested over the pipe: a PNG data URL or an error.
#[tauri::command]
pub fn capture_result(
    request_id: u64,
    data: Option<String>,
    error: Option<String>,
    state: State<'_, AppState>,
) {
    let result = match (data, error) {
        (Some(d), _) => Ok(d),
        (None, e) => Err(e.unwrap_or_else(|| "capture failed".into())),
    };
    state.finish_capture(request_id, result);
}

fn app_state(app: &AppHandle) -> tauri::State<'_, AppState> {
    use tauri::Manager;
    app.state::<AppState>()
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
