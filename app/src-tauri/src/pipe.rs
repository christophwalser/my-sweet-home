//! Named pipe server for live control by the CLI and the MCP server.
//!
//! Protocol and pipe name are defined in the `msh-ipc` crate.

use crate::state::{self, AppState};
use msh_ipc::{PIPE_NAME, Request, Response};
use serde::Serialize;
use serde_json::{Value, json};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};

/// Event asking the frontend to capture the 3D view.
pub const CAPTURE_EVENT: &str = "capture-3d";

/// Event asking the frontend to render a photo of the 3D view.
pub const RENDER_PHOTO_EVENT: &str = "render-photo";
/// How long a client waits for a photo (path tracing at "best" quality takes minutes).
const PHOTO_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PhotoRequest {
    request_id: u64,
    width: u32,
    height: u32,
    quality: String,
    path: Option<String>,
}

/// Event asking the frontend to render a video along the camera path.
pub const RENDER_VIDEO_EVENT: &str = "render-video";
/// How long a client waits for a video (path traced videos take hours).
const VIDEO_TIMEOUT: Duration = Duration::from_secs(12 * 3600);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VideoRequest {
    request_id: u64,
    width: Option<u32>,
    height: Option<u32>,
    frame_rate: Option<u32>,
    quality: String,
    path: String,
}

/// Event asking the main window for the views of the furniture from above (plan exports).
pub const TOP_VIEWS_EVENT: &str = "render-top-views";
/// How long a plan export waits for the views from above (models may still be loading).
const TOP_VIEWS_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TopViewsRequest {
    request_id: u64,
}

/// Event asking the frontend to export the 3D view as OBJ.
pub const EXPORT_OBJ_EVENT: &str = "export-obj";

/// How long a client waits for the frontend to deliver a 3D capture.
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(30);
/// How long a client waits for an OBJ export (models may still be loading).
const EXPORT_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExportRequest {
    request_id: u64,
    path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CaptureRequest {
    request_id: u64,
    mode: Option<String>,
}

/// Starts the pipe server in the background.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = serve(app).await {
            // Typically another instance of the app already owns the pipe
            eprintln!("live control pipe not available: {e}");
        }
    });
}

async fn serve(app: AppHandle) -> std::io::Result<()> {
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .reject_remote_clients(true)
        .create(PIPE_NAME)?;
    loop {
        server.connect().await?;
        let connected = server;
        // Create the next instance before serving, so new clients can connect
        server = ServerOptions::new()
            .reject_remote_clients(true)
            .create(PIPE_NAME)?;
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            handle_client(app, connected).await;
        });
    }
}

async fn handle_client(app: AppHandle, pipe: NamedPipeServer) {
    let (reader, mut writer) = tokio::io::split(pipe);
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim_start_matches('\u{feff}');
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Request>(line) {
            Ok(req) => dispatch(&app, req).await,
            Err(e) => Response::err(0, format!("invalid request: {e}")),
        };
        let Ok(mut text) = serde_json::to_string(&response) else {
            break;
        };
        text.push('\n');
        if writer.write_all(text.as_bytes()).await.is_err() || writer.flush().await.is_err() {
            break;
        }
    }
}

async fn dispatch(app: &AppHandle, req: Request) -> Response {
    let id = req.id;
    match req.method.as_str() {
        "execute" => {
            let Some(command) = req.params["command"].as_str().map(str::to_owned) else {
                return Response::err(id, "missing \"command\"");
            };
            let mut params = req.params.get("params").cloned().unwrap_or(Value::Null);
            // A printed home includes the 3D view, which only the frontend can render
            if command == "export_document"
                && params["view_3d"] != Value::Bool(false)
                && params["view_3d_image"].is_null()
                && let Ok(image) = capture_3d(app, None).await
                && let Some(obj) = params.as_object_mut()
            {
                obj.insert("view_3d_image".into(), image["image_base64"].clone());
            }
            // Plans show the furniture from above, which only the frontend can render
            let plan_wanted = command == "export_plan"
                || (command == "export_document" && params["plan"] != Value::Bool(false));
            if plan_wanted
                && params["furniture_icons"] != "catalog"
                && params["top_views"].is_null()
                && let Ok(views) = top_views(app).await
                && let Some(obj) = params.as_object_mut()
            {
                obj.insert("top_views".into(), views);
            }
            let a = app.clone();
            match tauri::async_runtime::spawn_blocking(move || state::execute(&a, &command, params))
                .await
            {
                Ok(Ok(v)) => Response::ok(id, v),
                Ok(Err(e)) => Response::err(id, e),
                Err(e) => Response::err(id, e.to_string()),
            }
        }
        "capture_3d" => match capture_3d(app, req.params["mode"].as_str().map(str::to_owned)).await
        {
            Ok(v) => Response::ok(id, v),
            Err(e) => Response::err(id, e),
        },
        "render_photo" => match render_photo(app, &req.params).await {
            Ok(v) => Response::ok(id, v),
            Err(e) => Response::err(id, e),
        },
        "render_video" => match render_video(app, &req.params).await {
            Ok(v) => Response::ok(id, v),
            Err(e) => Response::err(id, e),
        },
        "export_obj" => match export_obj(app, req.params["path"].as_str()).await {
            Ok(v) => Response::ok(id, v),
            Err(e) => Response::err(id, e),
        },
        "status" => {
            let state = app.state::<AppState>();
            let current = state.current();
            Response::ok(
                id,
                json!({
                    "app": msh_core::app_info(),
                    "home": current.as_ref().map(|c| json!({
                        "name": c.home.attrs.name,
                        "path": c.path,
                        "modified": c.modified,
                    })),
                }),
            )
        }
        other => Response::err(id, format!("unknown method '{other}'")),
    }
}

/// Asks the frontend to render a photo and waits for it (written to `path` if given).
async fn render_photo(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let state = app.state::<AppState>();
    if state.current().is_none() {
        return Err("no home is open in the app".into());
    }
    let quality = params["quality"].as_str().unwrap_or("good").to_string();
    if !matches!(quality.as_str(), "draft" | "good" | "best") {
        return Err(format!("unknown quality '{quality}' (draft, good or best)"));
    }
    let size =
        |key: &str, default: u64| params[key].as_u64().unwrap_or(default).clamp(16, 8000) as u32;
    let path = match params["path"].as_str() {
        Some(p) => Some(
            std::path::absolute(p)
                .map_err(|e| e.to_string())?
                .display()
                .to_string(),
        ),
        None => None,
    };
    let (request_id, rx) = state.new_capture();
    app.emit(
        RENDER_PHOTO_EVENT,
        PhotoRequest {
            request_id,
            width: size("width", 1600),
            height: size("height", 1200),
            quality,
            path,
        },
    )
    .map_err(|e| e.to_string())?;
    let result = tokio::time::timeout(PHOTO_TIMEOUT, rx)
        .await
        .map_err(|_| "the app did not finish the photo in time".to_string())?
        .map_err(|_| "the photo was cancelled".to_string())??;
    serde_json::from_str(&result).map_err(|e| e.to_string())
}

/// Asks the frontend to render a video along the camera path of the home and waits
/// until it is written to `path`.
async fn render_video(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let state = app.state::<AppState>();
    let Some(current) = state.current() else {
        return Err("no home is open in the app".into());
    };
    let points = msh_core::camera_path_len(&current.home);
    if points < 2 {
        return Err(format!(
            "the camera path has {points} key point(s), at least two are needed \
             (add them with camera_path_add)"
        ));
    }
    let quality = params["quality"].as_str().unwrap_or("draft").to_string();
    if !matches!(quality.as_str(), "draft" | "good" | "best") {
        return Err(format!("unknown quality '{quality}' (draft, good or best)"));
    }
    let path = params["path"].as_str().ok_or("missing \"path\"")?;
    let path = std::path::absolute(path)
        .map_err(|e| e.to_string())?
        .display()
        .to_string();
    let size = |key: &str| params[key].as_u64().map(|v| v.clamp(16, 3840) as u32);
    let (request_id, rx) = state.new_capture();
    app.emit(
        RENDER_VIDEO_EVENT,
        VideoRequest {
            request_id,
            width: size("width"),
            height: size("height"),
            frame_rate: params["frame_rate"].as_u64().map(|v| v.clamp(1, 60) as u32),
            quality,
            path,
        },
    )
    .map_err(|e| e.to_string())?;
    let result = tokio::time::timeout(VIDEO_TIMEOUT, rx)
        .await
        .map_err(|_| "the app did not finish the video in time".to_string())?
        .map_err(|_| "the video was cancelled".to_string())??;
    serde_json::from_str(&result).map_err(|e| e.to_string())
}

/// Asks the main window for the views of the furniture from above.
async fn top_views(app: &AppHandle) -> Result<Value, String> {
    let state = app.state::<AppState>();
    if state.current().is_none() {
        return Err("no home is open in the app".into());
    }
    let (request_id, rx) = state.new_capture();
    app.emit(TOP_VIEWS_EVENT, TopViewsRequest { request_id })
        .map_err(|e| e.to_string())?;
    let result = tokio::time::timeout(TOP_VIEWS_TIMEOUT, rx)
        .await
        .map_err(|_| "the app did not render the views from above in time".to_string())?
        .map_err(|_| "rendering the views from above was cancelled".to_string())??;
    serde_json::from_str(&result).map_err(|e| e.to_string())
}

/// Asks the frontend to export the 3D view as OBJ and waits for the written files.
pub async fn export_obj(app: &AppHandle, path: Option<&str>) -> Result<Value, String> {
    let path = path.ok_or("missing \"path\"")?;
    let path = std::path::absolute(path).map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    if state.current().is_none() {
        return Err("no home is open in the app".into());
    }
    let (request_id, rx) = state.new_capture();
    app.emit(
        EXPORT_OBJ_EVENT,
        ExportRequest {
            request_id,
            path: path.display().to_string(),
        },
    )
    .map_err(|e| e.to_string())?;
    let result = tokio::time::timeout(EXPORT_TIMEOUT, rx)
        .await
        .map_err(|_| "the app did not finish the OBJ export in time".to_string())?
        .map_err(|_| "the export was cancelled".to_string())??;
    serde_json::from_str(&result).map_err(|e| e.to_string())
}

/// Asks the frontend to render the 3D view and waits for the PNG.
pub async fn capture_3d(app: &AppHandle, mode: Option<String>) -> Result<Value, String> {
    let state = app.state::<AppState>();
    if state.current().is_none() {
        return Err("no home is open in the app".into());
    }
    let (request_id, rx) = state.new_capture();
    app.emit(CAPTURE_EVENT, CaptureRequest { request_id, mode })
        .map_err(|e| e.to_string())?;
    let data_url = tokio::time::timeout(CAPTURE_TIMEOUT, rx)
        .await
        .map_err(|_| "the app did not deliver the 3D image in time".to_string())?
        .map_err(|_| "capture was cancelled".to_string())??;
    let base64 = data_url
        .split_once(",")
        .map(|(_, b)| b.to_owned())
        .ok_or("invalid image data")?;
    Ok(json!({ "mime_type": "image/png", "image_base64": base64 }))
}
