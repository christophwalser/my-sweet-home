//! Resource access for the frontend through the custom `msh` URI scheme.
//!
//! URLs (on Windows the scheme is served as `http://msh.localhost/…`):
//! - `/doc/{docId}/{entry}` – resource inside an opened `.sh3d` file. If the
//!   entry is not part of the file (e.g. example projects that reference the
//!   Sweet Home 3D catalog by class path), the libraries are searched.
//! - `/lib/{libIndex}/{entry}` – resource inside a library file.
//!
//! Relative references inside models (OBJ → MTL → textures) resolve naturally
//! because the URL mirrors the ZIP folder structure.

use crate::state::AppState;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};

type Archive = zip::ZipArchive<BufReader<File>>;

/// Opened library archives plus an index from entry name to library.
#[derive(Default)]
pub struct LibraryStore {
    pub paths: Vec<PathBuf>,
    archives: Mutex<HashMap<usize, Arc<Mutex<Archive>>>>,
    entry_index: OnceLock<HashMap<String, usize>>,
}

impl LibraryStore {
    pub fn new(paths: Vec<PathBuf>) -> Self {
        Self {
            paths,
            ..Default::default()
        }
    }

    fn archive(&self, index: usize) -> Option<Arc<Mutex<Archive>>> {
        let mut archives = self.archives.lock().ok()?;
        if let Some(a) = archives.get(&index) {
            return Some(a.clone());
        }
        let path = self.paths.get(index)?;
        let file = File::open(path).ok()?;
        let archive = zip::ZipArchive::new(BufReader::new(file)).ok()?;
        let a = Arc::new(Mutex::new(archive));
        archives.insert(index, a.clone());
        Some(a)
    }

    /// Reads an entry from library `index`.
    pub fn read(&self, index: usize, entry: &str) -> Option<Vec<u8>> {
        let archive = self.archive(index)?;
        let mut archive = archive.lock().ok()?;
        let mut file = archive.by_name(entry.trim_start_matches('/')).ok()?;
        let mut data = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut data).ok()?;
        Some(data)
    }

    /// Finds an entry in any library (first match wins).
    pub fn find(&self, entry: &str) -> Option<Vec<u8>> {
        let index = self.entry_index.get_or_init(|| self.build_index());
        let lib = *index.get(entry.trim_start_matches('/'))?;
        self.read(lib, entry)
    }

    fn build_index(&self) -> HashMap<String, usize> {
        let mut map = HashMap::new();
        for i in (0..self.paths.len()).rev() {
            if let Some(archive) = self.archive(i)
                && let Ok(archive) = archive.lock()
            {
                for name in archive.file_names() {
                    map.insert(name.to_owned(), i);
                }
            }
        }
        map
    }
}

/// Handles a request of the `msh` URI scheme.
pub fn handle<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = percent_decode(request.uri().path());
    let mut parts = path.trim_start_matches('/').splitn(3, '/');
    let (kind, id, entry) = (parts.next(), parts.next(), parts.next());
    let state = app.state::<AppState>();

    let data = match (kind, id.and_then(|i| i.parse::<usize>().ok()), entry) {
        (Some("doc"), Some(doc_id), Some(entry)) => state
            .doc_content(doc_id as u32, entry)
            .or_else(|| state.libraries().find(entry)),
        (Some("lib"), Some(lib), Some(entry)) => state.libraries().read(lib, entry),
        _ => None,
    };

    // Resources of a home can change while it is edited; library files do not
    let cache = if kind == Some("doc") {
        "no-cache"
    } else {
        "max-age=3600"
    };
    let builder = Response::builder()
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", cache);
    match data {
        Some(bytes) => builder
            .status(StatusCode::OK)
            .header("Content-Type", content_type(entry.unwrap_or(""), &bytes))
            .body(bytes),
        None => builder.status(StatusCode::NOT_FOUND).body(Vec::new()),
    }
    .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn content_type(name: &str, data: &[u8]) -> &'static str {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("obj" | "mtl") => "text/plain",
        Some("dae") => "model/vnd.collada+xml",
        _ if data.starts_with(&[0x89, b'P', b'N', b'G']) => "image/png",
        _ if data.starts_with(&[0xFF, 0xD8, 0xFF]) => "image/jpeg",
        _ => "application/octet-stream",
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16)
        {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(
            percent_decode("/doc/1/a%20b/%C3%A4.obj"),
            "/doc/1/a b/ä.obj"
        );
        assert_eq!(percent_decode("/plain"), "/plain");
    }
}
