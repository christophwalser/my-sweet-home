//! Application state shared by commands, the resource protocol and the pipe server.

use crate::resources::LibraryStore;
use msh_core::{Document, Registry};
use msh_geometry::WallShape;
use msh_model::Home;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::oneshot;

/// Event sent to the frontend whenever the open home changed.
pub const HOME_CHANGED_EVENT: &str = "home-changed";
/// Event sent after libraries were imported or removed: the frontend reloads the catalog.
pub const CATALOG_CHANGED_EVENT: &str = "catalog-changed";

/// The home shown in the window.
pub struct ActiveDoc {
    /// Changes when another home is opened or created, so the frontend reloads resources
    pub id: u32,
    pub doc: Document,
}

/// Everything the frontend needs to display the home.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HomeView {
    pub id: u32,
    pub path: Option<PathBuf>,
    pub home: Home,
    pub wall_shapes: Vec<WallShape>,
    pub modified: bool,
    pub can_undo: bool,
    pub can_redo: bool,
}

impl HomeView {
    pub fn of(active: &ActiveDoc) -> Self {
        let home = active.doc.home().clone();
        Self {
            id: active.id,
            path: active.doc.path.clone(),
            wall_shapes: msh_geometry::wall_shapes(&home),
            home,
            modified: active.doc.modified,
            can_undo: active.doc.can_undo(),
            can_redo: active.doc.can_redo(),
        }
    }
}

type CaptureSender = oneshot::Sender<Result<String, String>>;

pub struct AppState {
    pub registry: Registry,
    active: Mutex<Option<ActiveDoc>>,
    next_id: AtomicU32,
    libraries: Mutex<Option<Arc<LibraryStore>>>,
    captures: Mutex<HashMap<u64, CaptureSender>>,
    next_capture: AtomicU64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            registry: Registry::standard(),
            active: Mutex::new(None),
            next_id: AtomicU32::new(0),
            libraries: Mutex::new(None),
            captures: Mutex::new(HashMap::new()),
            next_capture: AtomicU64::new(1),
        }
    }
}

impl AppState {
    fn new_id(&self) -> u32 {
        self.next_id.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// View of the current home, if one is open.
    pub fn current(&self) -> Option<HomeView> {
        self.active.lock().ok()?.as_ref().map(HomeView::of)
    }

    /// Bytes of a resource inside the home with the given ID.
    pub fn doc_content(&self, id: u32, name: &str) -> Option<Vec<u8>> {
        let guard = self.active.lock().ok()?;
        let active = guard.as_ref().filter(|a| a.id == id)?;
        active
            .doc
            .file
            .contents
            .iter()
            .find(|c| c.name == name)
            .map(|c| c.data.clone())
    }

    /// Library files on this machine, discovered on first use.
    pub fn libraries(&self) -> Arc<LibraryStore> {
        let mut guard = self.libraries.lock().unwrap_or_else(|e| e.into_inner());
        guard
            .get_or_insert_with(|| {
                Arc::new(LibraryStore::new(msh_catalog::find_all_libraries(&[])))
            })
            .clone()
    }

    /// Discovers the library files again (after an import or removal).
    pub fn reload_libraries(&self) {
        *self.libraries.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// Registers a pending 3D capture and returns its ID and receiver.
    pub fn new_capture(&self) -> (u64, oneshot::Receiver<Result<String, String>>) {
        let id = self.next_capture.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        if let Ok(mut c) = self.captures.lock() {
            c.insert(id, tx);
        }
        (id, rx)
    }

    /// Completes a pending 3D capture with a data URL or an error.
    pub fn finish_capture(&self, id: u64, result: Result<String, String>) {
        if let Some(tx) = self.captures.lock().ok().and_then(|mut c| c.remove(&id)) {
            let _ = tx.send(result);
        }
    }
}

/// Executes a registry command on the open home (creating an empty home if
/// none is open) and notifies the frontend if the home changed.
pub fn execute<R: Runtime>(app: &AppHandle<R>, name: &str, params: Value) -> Result<Value, String> {
    let state = app.state::<AppState>();
    let spec = state
        .registry
        .get(name)
        .ok_or_else(|| format!("unknown command '{name}'"))?;
    let (result, view) = {
        let mut guard = state.active.lock().map_err(|e| e.to_string())?;
        let active = guard.get_or_insert_with(|| ActiveDoc {
            id: state.new_id(),
            doc: Document::default(),
        });
        let result = state
            .registry
            .execute(&mut active.doc, name, params)
            .map_err(|e| e.to_string())?;
        let replaced = matches!(name, "home_new" | "home_open");
        if replaced {
            active.id = state.new_id();
        }
        let changed =
            replaced || spec.modifies || matches!(name, "edit_undo" | "edit_redo" | "home_save");
        (result, changed.then(|| HomeView::of(active)))
    };
    if let Some(view) = view {
        let _ = app.emit(HOME_CHANGED_EVENT, view);
    }
    if matches!(name, "library_import" | "library_remove") {
        state.reload_libraries();
        let _ = app.emit(CATALOG_CHANGED_EVENT, ());
    }
    Ok(result)
}
