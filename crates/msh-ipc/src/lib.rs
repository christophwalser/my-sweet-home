//! Live connection to the running My Sweet Home app.
//!
//! The app listens on the Windows named pipe [`PIPE_NAME`]. Clients (CLI with
//! `--live`, MCP server with `--live`) send newline-delimited JSON requests and
//! receive one JSON response per request:
//!
//! ```text
//! → {"id": 1, "method": "execute", "params": {"command": "wall_add", "params": {...}}}
//! ← {"id": 1, "result": {...}}            or  {"id": 1, "error": "message"}
//! ```
//!
//! Methods:
//! - `execute` – runs a registry command on the document shown in the app
//! - `capture_3d` – returns a PNG of the 3D view (`{"mode": "aerial" | "observer", "width": 1200}`)
//! - `status` – app name, version and the open home
//!
//! The pipe only accepts local clients of the same user session.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::time::Duration;

/// Name of the named pipe the app listens on.
pub const PIPE_NAME: &str = r"\\.\pipe\my-sweet-home";

/// A request from a client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

/// A response of the app.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    pub fn ok(id: u64, result: Value) -> Self {
        Self {
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn err(id: u64, error: impl Into<String>) -> Self {
        Self {
            id,
            result: None,
            error: Some(error.into()),
        }
    }
}

/// Errors of the client.
#[derive(Debug)]
pub enum ClientError {
    /// The app is not running (or not listening)
    NotRunning,
    Io(std::io::Error),
    /// The app answered with an error
    Remote(String),
    Protocol(String),
}

impl std::fmt::Display for ClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotRunning => write!(f, "My Sweet Home is not running (start the app first)"),
            Self::Io(e) => write!(f, "connection error: {e}"),
            Self::Remote(e) => write!(f, "{e}"),
            Self::Protocol(e) => write!(f, "protocol error: {e}"),
        }
    }
}

impl std::error::Error for ClientError {}

/// Synchronous client for the app's named pipe.
pub struct Client {
    reader: BufReader<File>,
    writer: File,
    next_id: u64,
}

/// Windows error code when all pipe instances are busy.
const ERROR_PIPE_BUSY: i32 = 231;

impl Client {
    /// Connects to the running app. Retries briefly if all pipe instances are busy.
    pub fn connect() -> Result<Self, ClientError> {
        let mut attempts = 0;
        let file = loop {
            match OpenOptions::new().read(true).write(true).open(PIPE_NAME) {
                Ok(f) => break f,
                Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && attempts < 50 => {
                    attempts += 1;
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    return Err(ClientError::NotRunning);
                }
                Err(e) => return Err(ClientError::Io(e)),
            }
        };
        let reader = BufReader::new(file.try_clone().map_err(ClientError::Io)?);
        Ok(Self {
            reader,
            writer: file,
            next_id: 1,
        })
    }

    /// Sends a request and waits for its response.
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, ClientError> {
        let id = self.next_id;
        self.next_id += 1;
        let req = Request {
            id,
            method: method.to_owned(),
            params,
        };
        let mut line =
            serde_json::to_string(&req).map_err(|e| ClientError::Protocol(e.to_string()))?;
        line.push('\n');
        self.writer
            .write_all(line.as_bytes())
            .map_err(ClientError::Io)?;
        self.writer.flush().map_err(ClientError::Io)?;

        let mut buf = String::new();
        if self.reader.read_line(&mut buf).map_err(ClientError::Io)? == 0 {
            return Err(ClientError::Protocol("connection closed by the app".into()));
        }
        let resp: Response =
            serde_json::from_str(&buf).map_err(|e| ClientError::Protocol(e.to_string()))?;
        if resp.id != id {
            return Err(ClientError::Protocol(format!(
                "unexpected response id {}",
                resp.id
            )));
        }
        match (resp.result, resp.error) {
            (_, Some(e)) => Err(ClientError::Remote(e)),
            (Some(r), None) => Ok(r),
            (None, None) => Ok(Value::Null),
        }
    }

    /// Runs a registry command in the app.
    pub fn execute(&mut self, command: &str, params: Value) -> Result<Value, ClientError> {
        self.call(
            "execute",
            serde_json::json!({ "command": command, "params": params }),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_roundtrip() {
        let r = Response::ok(3, serde_json::json!({ "id": "wall-1" }));
        let s = serde_json::to_string(&r).unwrap();
        assert_eq!(s, r#"{"id":3,"result":{"id":"wall-1"}}"#);
        let e: Response = serde_json::from_str(r#"{"id":4,"error":"boom"}"#).unwrap();
        assert_eq!(e.error.as_deref(), Some("boom"));
    }
}
