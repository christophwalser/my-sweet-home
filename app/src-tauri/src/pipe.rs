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

/// How long a client waits for the frontend to deliver a 3D capture.
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(30);

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
            let params = req.params.get("params").cloned().unwrap_or(Value::Null);
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

/// Asks the frontend to render the 3D view and waits for the PNG.
async fn capture_3d(app: &AppHandle, mode: Option<String>) -> Result<Value, String> {
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
