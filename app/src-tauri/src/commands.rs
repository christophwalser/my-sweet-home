//! Tauri commands called by the frontend.
//!
//! Changes to the home go through `execute`, which runs a command of the
//! `msh-core` registry — the same commands the CLI and the MCP server use.

use crate::autosave::{self, RecoveryInfo};
use crate::state::{self, AppState, HOME_CHANGED_EVENT, HomeView};
use msh_catalog::{CatalogKind, open_library};
use serde::Serialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State, WebviewWindow};

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub fn app_info() -> msh_core::AppInfo {
    msh_core::app_info()
}

/// File the window should open when it starts: the one passed on the command line
/// (`msh-app.exe house.sh3d`) for the first window, the chosen one for new windows.
#[tauri::command]
pub fn startup_file(window: WebviewWindow, state: State<'_, AppState>) -> Option<String> {
    if let Some(path) = state.take_pending_open(window.label()) {
        return Some(path.display().to_string());
    }
    if window.label() != "main" {
        return None;
    }
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-') && Path::new(a).is_file())
}

/// The home of the window, if any (used when the frontend starts or reloads).
#[tauri::command]
pub fn current_home(window: WebviewWindow, state: State<'_, AppState>) -> Option<HomeView> {
    state.current(Some(window.label()))
}

/// Opens a `.sh3d` file or a standalone `Home.xml` in the window.
#[tauri::command]
pub async fn open_home(path: String, window: WebviewWindow, app: AppHandle) -> CmdResult<HomeView> {
    let a = app.clone();
    let label = window.label().to_owned();
    let l = label.clone();
    tauri::async_runtime::spawn_blocking(move || {
        state::execute(&a, Some(&l), "home_open", json!({ "path": path }))
    })
    .await
    .map_err(err)??;
    app_state(&app)
        .current(Some(&label))
        .ok_or_else(|| "no home open".into())
}

/// Runs a registry command (e.g. `edit_undo`, `home_save`) on the home of the window.
#[tauri::command]
pub async fn execute(
    command: String,
    params: Value,
    window: WebviewWindow,
    app: AppHandle,
) -> CmdResult<Value> {
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        state::execute(&app, Some(&label), &command, params)
    })
    .await
    .map_err(err)?
}

/// Opens a new window for another home: empty, with the file `path`, or with the
/// recovered home `recovery`.
#[tauri::command]
pub async fn new_window(
    path: Option<String>,
    recovery: Option<String>,
    app: AppHandle,
) -> CmdResult<String> {
    let state = app_state(&app);
    let label = state.new_window_label();
    if let Some(p) = path {
        state.set_pending_open(&label, PathBuf::from(p));
    }
    if let Some(key) = recovery {
        state.set_pending_recovery(&label, key);
    }
    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title("My Sweet Home")
        .inner_size(1280.0, 800.0)
        .min_inner_size(640.0, 480.0)
        .drag_and_drop(false)
        .build()
        .map_err(err)?;
    Ok(label)
}

/// Recovered home the window should open when it starts, if any.
#[tauri::command]
pub fn startup_recovery(window: WebviewWindow, state: State<'_, AppState>) -> Option<String> {
    state.take_pending_recovery(window.label())
}

/// Unsaved homes left by an earlier session (after a crash).
#[tauri::command]
pub fn recovery_list(app: AppHandle) -> Vec<RecoveryInfo> {
    autosave::list(&app)
}

/// Opens a recovered home in the window.
#[tauri::command]
pub async fn recovery_open(
    key: String,
    window: WebviewWindow,
    app: AppHandle,
) -> CmdResult<HomeView> {
    let label = window.label().to_owned();
    let a = app.clone();
    let k = key.clone();
    let doc = tauri::async_runtime::spawn_blocking(move || autosave::open(&a, &k))
        .await
        .map_err(err)??;
    let view = app_state(&app).install_doc(&label, doc, Some(key));
    let _ = state::emit_home(&app, &label, HOME_CHANGED_EVENT, view.clone());
    Ok(view)
}

/// Deletes recovered homes the user does not want back.
#[tauri::command]
pub fn recovery_discard(keys: Vec<String>, app: AppHandle) {
    for key in keys {
        autosave::remove_recovery(&app, &key);
    }
}

/// Writes the files of an OBJ export: the OBJ at `path`, the MTL and the texture
/// images (base64 PNG) next to it. Returns the written paths.
#[tauri::command]
pub fn write_obj_files(
    path: String,
    obj: String,
    mtl: String,
    textures: std::collections::HashMap<String, String>,
) -> Result<Vec<String>, String> {
    use base64::Engine;
    let obj_path = std::path::PathBuf::from(&path);
    let dir = obj_path
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_default();
    let write = |p: &std::path::Path, data: &[u8]| {
        std::fs::write(p, data).map_err(|e| format!("cannot write {}: {e}", p.display()))
    };
    let mut written = Vec::new();
    write(&obj_path, obj.as_bytes())?;
    written.push(obj_path.display().to_string());
    let mtl_path = obj_path.with_extension("mtl");
    write(&mtl_path, mtl.as_bytes())?;
    written.push(mtl_path.display().to_string());
    for (name, data) in textures {
        // Texture names come from the exporter ("texture_N.png"); never leave the folder
        let file = std::path::Path::new(&name)
            .file_name()
            .ok_or_else(|| format!("invalid texture name '{name}'"))?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|e| e.to_string())?;
        let p = dir.join(file);
        write(&p, &bytes)?;
        written.push(p.display().to_string());
    }
    Ok(written)
}

/// Writes an image given as data URL (e.g. a photo) to a file.
#[tauri::command]
pub fn save_image(path: String, data_url: String) -> Result<(), String> {
    use base64::Engine;
    let data = data_url
        .split_once(',')
        .map_or(data_url.as_str(), |(_, b)| b);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("cannot write {path}: {e}"))
}

/// Reads a file chosen by the user (e.g. a background image or PDF) as raw bytes.
#[tauri::command]
pub fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("cannot read {path}: {e}"))
}

/// Writes binary data sent as raw request body (e.g. a video) to the file named by the
/// percent-encoded `path` header.
#[tauri::command]
pub fn save_file(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected binary data".into());
    };
    let header = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing path")?;
    let path = percent_encoding::percent_decode_str(header)
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    std::fs::write(path.as_ref(), data).map_err(|e| format!("cannot write {path}: {e}"))
}

/// PNG (base64) of the 3D view, rendered by the window that shows it.
#[tauri::command]
pub async fn capture_3d_image(
    window: WebviewWindow,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let image = crate::pipe::capture_3d(&app, Some(window.label()), None).await?;
    image["image_base64"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "no image".to_string())
}

/// Exports the 3D view as OBJ (from the export dialog); the window showing the 3D
/// view builds and writes the files.
#[tauri::command]
pub async fn export_obj(
    path: String,
    window: WebviewWindow,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    crate::pipe::export_obj(&app, Some(window.label()), Some(&path)).await
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedModel {
    pub id: u32,
    /// Main model file, served at msh://stage/{id}/{main}
    pub main: String,
    /// Size along x, y (up) and z in cm, if it could be computed (OBJ, glTF)
    pub size_cm: Option<[f32; 3]>,
    pub files: Vec<String>,
}

/// Collects a 3D model with its files for the furniture import preview.
#[tauri::command]
pub async fn model_stage(path: PathBuf, state: State<'_, AppState>) -> CmdResult<StagedModel> {
    let package = tauri::async_runtime::spawn_blocking(move || {
        msh_core::model_package::collect(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    let main = package.main.clone();
    let size_cm = package.size_cm;
    let files = package.files.iter().map(|(n, _)| n.clone()).collect();
    let id = state.stage_model(package);
    Ok(StagedModel {
        id,
        main,
        size_cm,
        files,
    })
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
