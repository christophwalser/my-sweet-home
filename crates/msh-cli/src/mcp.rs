//! MCP server (Model Context Protocol) on stdin/stdout.
//!
//! Implements the JSON-RPC 2.0 methods `initialize`, `ping`, `tools/list` and
//! `tools/call` with newline-delimited messages. Every registry command is
//! offered as a tool; its JSON schema is the tool's input schema.
//!
//! Two backends:
//! - local (default): one document in memory; `home_save` writes it
//! - live (`--live`): every tool call is forwarded to the running app, so the
//!   changes appear in its window; an extra tool `view_3d_image` returns a
//!   screenshot of the app's 3D view

use anyhow::Result;
use msh_core::{Document, Registry};
use serde_json::{Value, json};
use std::io::{BufRead, Write};
use std::path::PathBuf;

/// Protocol version used if the client does not request one.
const DEFAULT_PROTOCOL_VERSION: &str = "2025-06-18";

/// Name of the live-only tool for 3D screenshots.
const VIEW_3D_TOOL: &str = "view_3d_image";
/// Name of the live-only tool for the OBJ export of the 3D view.
const EXPORT_OBJ_TOOL: &str = "export_obj";
/// Name of the live-only tool for photos of the 3D view.
const PHOTO_TOOL: &str = "render_photo";
/// Name of the live-only tool for videos along the camera path.
const VIDEO_TOOL: &str = "render_video";
/// Number of tools that only exist in live mode.
const LIVE_TOOLS: usize = 4;

enum Backend {
    Local(Box<Document>),
    Live(msh_ipc::Client),
}

impl Backend {
    fn execute(&mut self, registry: &Registry, name: &str, args: Value) -> Result<Value, String> {
        match self {
            Backend::Local(doc) => registry.execute(doc, name, args).map_err(|e| e.to_string()),
            Backend::Live(client) => if name == VIEW_3D_TOOL {
                client.call("capture_3d", args)
            } else if name == EXPORT_OBJ_TOOL {
                client.call("export_obj", args)
            } else if name == PHOTO_TOOL {
                client.call("render_photo", args)
            } else if name == VIDEO_TOOL {
                client.call("render_video", args)
            } else {
                client.execute(name, args)
            }
            .map_err(|e| e.to_string()),
        }
    }

    fn is_live(&self) -> bool {
        matches!(self, Backend::Live(_))
    }
}

pub fn serve(registry: &Registry, file: Option<PathBuf>, live: bool) -> Result<()> {
    let mut backend = if live {
        let mut client = msh_ipc::Client::connect()?;
        if let Some(p) = &file {
            client.execute("home_open", json!({ "path": p }))?;
        }
        Backend::Live(client)
    } else {
        Backend::Local(Box::new(match &file {
            Some(p) if p.exists() => Document::open(p)?,
            Some(p) => {
                let mut d = Document::default();
                d.path = Some(p.clone());
                d
            }
            None => Document::default(),
        }))
    };
    eprintln!(
        "my-sweet-home MCP server ready ({} tools, {})",
        registry.list().len() + if live { LIVE_TOOLS } else { 0 },
        if live {
            "live: controlling the running app"
        } else {
            "local document"
        }
    );

    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        // Some shells prepend a UTF-8 byte order mark when piping
        let line = line.trim_start_matches('\u{feff}');
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(line) {
            Ok(msg) => handle(registry, &mut backend, &msg),
            Err(e) => Some(error_response(
                Value::Null,
                -32700,
                &format!("parse error: {e}"),
            )),
        };
        if let Some(resp) = response {
            writeln!(stdout, "{}", serde_json::to_string(&resp)?)?;
            stdout.flush()?;
        }
    }
    Ok(())
}

/// Handles one message; returns `None` for notifications.
fn handle(registry: &Registry, backend: &mut Backend, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg["method"].as_str().unwrap_or("");
    let params = &msg["params"];
    // Notifications (no id) never get a response
    let id = id?;
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": params["protocolVersion"].as_str().unwrap_or(DEFAULT_PROTOCOL_VERSION),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "my-sweet-home", "version": env!("CARGO_PKG_VERSION") },
            "instructions": instructions(backend.is_live()),
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_list(registry, backend.is_live()) })),
        "tools/call" => Ok(call_tool(registry, backend, params)),
        _ => Err((-32601, format!("method not found: {method}"))),
    };
    Some(match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err((code, message)) => error_response(id, code, &message),
    })
}

fn instructions(live: bool) -> String {
    let mut s = msh_core::CONVENTIONS.to_owned();
    if live {
        s.push_str(
            "\nLive mode: every change is applied to the home shown in the running My Sweet Home app \
             and appears in its window immediately. Use view_3d_image to see the 3D view, \
             render_photo for a photo of it and render_video for a video along the camera path.",
        );
    }
    s
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn tool_list(registry: &Registry, live: bool) -> Vec<Value> {
    let mut tools: Vec<Value> = registry
        .list()
        .iter()
        .map(|c| {
            let mut schema = c.params_schema.clone();
            if let Some(o) = schema.as_object_mut() {
                o.remove("$schema");
                o.remove("title");
                o.entry("properties").or_insert_with(|| json!({}));
            }
            json!({
                "name": c.name,
                "description": c.description,
                "inputSchema": schema,
                "annotations": { "readOnlyHint": !c.modifies && !matches!(c.name, "home_new" | "home_open" | "home_save" | "edit_undo" | "edit_redo") },
            })
        })
        .collect();
    if live {
        tools.push(json!({
            "name": VIEW_3D_TOOL,
            "description": "Returns a screenshot of the 3D view of the running app (aerial view or virtual visit).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["aerial", "observer"],
                        "description": "\"aerial\" (default view from above) or \"observer\" (virtual visitor)",
                    },
                },
            },
            "annotations": { "readOnlyHint": true },
        }));
        tools.push(json!({
            "name": PHOTO_TOOL,
            "description": "Renders a photo of the current 3D view of the running app: \"draft\" (rasterized with sun shadows, seconds), \"good\" or \"best\" (GPU path tracing with soft shadows and indirect light; up to minutes). Returns the image, or writes it to path.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "width": { "type": "integer", "description": "Width in pixels (default 1600)" },
                    "height": { "type": "integer", "description": "Height in pixels (default 1200)" },
                    "quality": { "type": "string", "enum": ["draft", "good", "best"], "description": "Default \"good\"" },
                    "path": { "type": "string", "description": "PNG file to write instead of returning the image" },
                },
            },
            "annotations": { "readOnlyHint": true },
        }));
        tools.push(json!({
            "name": VIDEO_TOOL,
            "description": "Renders a video (MP4) along the camera path of the home in the running app and writes it to path. Add key points first with camera_path_add (at least two); camera_path_get shows the path, the video settings and the resulting duration. \"draft\" is rasterized (fast), \"good\" and \"best\" are path traced (slow: seconds per frame).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "MP4 file to write" },
                    "quality": { "type": "string", "enum": ["draft", "good", "best"], "description": "Default \"draft\"" },
                    "width": { "type": "integer", "description": "Width in pixels (default: video settings of the home)" },
                    "height": { "type": "integer", "description": "Height in pixels (default: from the aspect ratio)" },
                    "frame_rate": { "type": "integer", "description": "Frames per second (default: video settings of the home)" },
                },
                "required": ["path"],
            },
            "annotations": { "readOnlyHint": false },
        }));
        tools.push(json!({
            "name": EXPORT_OBJ_TOOL,
            "description": "Exports the walls, rooms and furniture shown in the 3D view of the running app as Wavefront OBJ file with MTL file and textures next to it (cm, y axis up).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "OBJ file to write" },
                },
                "required": ["path"],
            },
            "annotations": { "readOnlyHint": false },
        }));
    }
    tools
}

/// Executes a tool. Errors are reported as tool results with `isError`, as MCP specifies.
fn call_tool(registry: &Registry, backend: &mut Backend, params: &Value) -> Value {
    let name = params["name"].as_str().unwrap_or("");
    let args = params.get("arguments").cloned().unwrap_or(Value::Null);
    match backend.execute(registry, name, args) {
        Ok(result) => {
            if let (Some(data), Some(mime)) = (
                result.get("image_base64").and_then(Value::as_str),
                result.get("mime_type").and_then(Value::as_str),
            ) {
                let caption = if name == VIEW_3D_TOOL {
                    "3D view of the current home."
                } else {
                    "Plan image of the current home (grid: 1 m)."
                };
                json!({
                    "content": [
                        { "type": "image", "data": data, "mimeType": mime },
                        { "type": "text", "text": caption },
                    ],
                    "isError": false,
                })
            } else {
                json!({
                    "content": [{ "type": "text", "text": serde_json::to_string_pretty(&result).unwrap_or_default() }],
                    "structuredContent": result,
                    "isError": false,
                })
            }
        }
        Err(e) => json!({
            "content": [{ "type": "text", "text": e }],
            "isError": true,
        }),
    }
}
