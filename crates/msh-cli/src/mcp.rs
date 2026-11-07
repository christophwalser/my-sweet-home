//! MCP server (Model Context Protocol) on stdin/stdout.
//!
//! Implements the JSON-RPC 2.0 methods `initialize`, `ping`, `tools/list` and
//! `tools/call` with newline-delimited messages. Every registry command is
//! offered as a tool; its JSON schema is the tool's input schema. The server
//! keeps one document in memory across calls; `home_save` writes it.

use anyhow::Result;
use msh_core::{Document, Registry};
use serde_json::{Value, json};
use std::io::{BufRead, Write};
use std::path::PathBuf;

/// Protocol version used if the client does not request one.
const DEFAULT_PROTOCOL_VERSION: &str = "2025-06-18";

pub fn serve(registry: &Registry, file: Option<PathBuf>) -> Result<()> {
    let mut doc = match &file {
        Some(p) if p.exists() => Document::open(p)?,
        Some(p) => {
            let mut d = Document::default();
            d.path = Some(p.clone());
            d
        }
        None => Document::default(),
    };
    eprintln!(
        "my-sweet-home MCP server ready ({} tools)",
        registry.list().len()
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
            Ok(msg) => handle(registry, &mut doc, &msg),
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
fn handle(registry: &Registry, doc: &mut Document, msg: &Value) -> Option<Value> {
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
            "instructions": msh_core::CONVENTIONS,
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_list(registry) })),
        "tools/call" => Ok(call_tool(registry, doc, params)),
        _ => Err((-32601, format!("method not found: {method}"))),
    };
    Some(match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err((code, message)) => error_response(id, code, &message),
    })
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn tool_list(registry: &Registry) -> Vec<Value> {
    registry
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
        .collect()
}

/// Executes a tool. Errors are reported as tool results with `isError`, as MCP specifies.
fn call_tool(registry: &Registry, doc: &mut Document, params: &Value) -> Value {
    let name = params["name"].as_str().unwrap_or("");
    let args = params.get("arguments").cloned().unwrap_or(Value::Null);
    match registry.execute(doc, name, args) {
        Ok(result) => {
            if let (Some(data), Some(mime)) = (
                result.get("image_base64").and_then(Value::as_str),
                result.get("mime_type").and_then(Value::as_str),
            ) {
                json!({
                    "content": [
                        { "type": "image", "data": data, "mimeType": mime },
                        { "type": "text", "text": "Plan image of the current home (cm grid: 1 m)." },
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
            "content": [{ "type": "text", "text": e.to_string() }],
            "isError": true,
        }),
    }
}
