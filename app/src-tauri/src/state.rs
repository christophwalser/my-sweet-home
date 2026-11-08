//! Application state shared by commands, the resource protocol and the pipe server.
//!
//! Each home has its own window (as in Sweet Home 3D): the documents are kept by the
//! label of their window ("main", "home-2", ...). A separate 3D window of a home has the
//! label "view3d-<home window>". The CLI and the MCP server control the home of the window
//! that was focused last.

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

/// The home shown in a window.
pub struct ActiveDoc {
    /// Changes when another home is opened or created, so the frontend reloads resources
    pub id: u32,
    pub doc: Document,
    /// Counts camera moves by commands (camera_set, viewpoint_go), so the 3D view
    /// moves even when the same point of view is chosen again
    pub camera_moves: u32,
    /// Counts changes of the home; autosave writes a copy when it differs from `autosaved`
    pub revision: u64,
    pub autosaved: u64,
    /// Name of the recovery files of this home (see `autosave`)
    pub recovery_key: String,
}

impl ActiveDoc {
    fn new(id: u32, doc: Document) -> Self {
        Self {
            id,
            doc,
            camera_moves: 0,
            revision: 0,
            autosaved: 0,
            recovery_key: uuid::Uuid::new_v4().to_string(),
        }
    }
}

/// Prefix of the labels of separate 3D windows.
pub const VIEW3D_PREFIX: &str = "view3d-";

/// Label of the home window a window belongs to (its own label for home windows).
pub fn home_label(window_label: &str) -> String {
    window_label
        .strip_prefix(VIEW3D_PREFIX)
        .unwrap_or(window_label)
        .to_owned()
}

/// Sends an event to a home window and its separate 3D window.
pub fn emit_home<R: Runtime, S: Serialize + Clone>(
    app: &AppHandle<R>,
    label: &str,
    event: &str,
    payload: S,
) -> Result<(), String> {
    app.emit_to(label, event, payload.clone())
        .map_err(|e| e.to_string())?;
    app.emit_to(format!("{VIEW3D_PREFIX}{label}").as_str(), event, payload)
        .map_err(|e| e.to_string())
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
    pub camera_moves: u32,
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
            camera_moves: active.camera_moves,
        }
    }
}

type CaptureSender = oneshot::Sender<Result<String, String>>;

pub struct AppState {
    pub registry: Registry,
    /// Documents by the label of their window
    docs: Mutex<HashMap<String, ActiveDoc>>,
    /// Home window focused last (target of the CLI and the MCP server)
    focused: Mutex<String>,
    /// Files to open in windows that are being created
    pending_open: Mutex<HashMap<String, PathBuf>>,
    /// Recovered homes to open in windows that are being created
    pending_recovery: Mutex<HashMap<String, String>>,
    /// Copied elements, shared by all homes (copy in one window, paste in another)
    clipboard: Mutex<Option<msh_core::clipboard::Clipboard>>,
    next_window: AtomicU32,
    next_id: AtomicU32,
    libraries: Mutex<Option<Arc<LibraryStore>>>,
    captures: Mutex<HashMap<u64, CaptureSender>>,
    /// Models collected for the furniture import preview, served under /stage/{id}/
    stages: Mutex<HashMap<u32, msh_core::model_package::ModelPackage>>,
    next_capture: AtomicU64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            registry: Registry::standard(),
            docs: Mutex::new(HashMap::new()),
            focused: Mutex::new("main".into()),
            pending_open: Mutex::new(HashMap::new()),
            pending_recovery: Mutex::new(HashMap::new()),
            clipboard: Mutex::new(None),
            next_window: AtomicU32::new(1),
            next_id: AtomicU32::new(0),
            libraries: Mutex::new(None),
            captures: Mutex::new(HashMap::new()),
            stages: Mutex::new(HashMap::new()),
            next_capture: AtomicU64::new(1),
        }
    }
}

impl AppState {
    fn new_id(&self) -> u32 {
        self.next_id.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Label of the home window focused last.
    pub fn focused(&self) -> String {
        self.focused
            .lock()
            .map(|f| f.clone())
            .unwrap_or_else(|_| "main".into())
    }

    /// Remembers the home window focused last.
    pub fn set_focused(&self, label: &str) {
        if let Ok(mut f) = self.focused.lock() {
            *f = home_label(label);
        }
    }

    /// Label for a new home window.
    pub fn new_window_label(&self) -> String {
        format!(
            "home-{}",
            self.next_window.fetch_add(1, Ordering::Relaxed) + 1
        )
    }

    /// Keeps a file to open in a window that is being created.
    pub fn set_pending_open(&self, label: &str, path: PathBuf) {
        if let Ok(mut p) = self.pending_open.lock() {
            p.insert(label.to_owned(), path);
        }
    }

    /// Keeps a recovered home to open in a window that is being created.
    pub fn set_pending_recovery(&self, label: &str, key: String) {
        if let Ok(mut p) = self.pending_recovery.lock() {
            p.insert(label.to_owned(), key);
        }
    }

    /// The recovered home a new window should open, if any.
    pub fn take_pending_recovery(&self, label: &str) -> Option<String> {
        self.pending_recovery.lock().ok()?.remove(label)
    }

    /// The file a new window should open, if any.
    pub fn take_pending_open(&self, label: &str) -> Option<PathBuf> {
        self.pending_open.lock().ok()?.remove(label)
    }

    /// View of the home of a window (or of the focused one), if one is open.
    pub fn current(&self, label: Option<&str>) -> Option<HomeView> {
        let label = label.map_or_else(|| self.focused(), home_label);
        self.docs.lock().ok()?.get(&label).map(HomeView::of)
    }

    /// Removes the home of a closed window; returns its recovery key.
    pub fn close_doc(&self, label: &str) -> Option<String> {
        self.docs.lock().ok()?.remove(label).map(|d| d.recovery_key)
    }

    /// Runs `f` with the documents (autosave, recovery).
    pub fn with_docs<T>(&self, f: impl FnOnce(&mut HashMap<String, ActiveDoc>) -> T) -> Option<T> {
        self.docs.lock().ok().map(|mut d| f(&mut d))
    }

    /// Puts a document into a window, replacing its home.
    pub fn install_doc(
        &self,
        label: &str,
        doc: Document,
        recovery_key: Option<String>,
    ) -> HomeView {
        let mut active = ActiveDoc::new(self.new_id(), doc);
        if let Some(key) = recovery_key {
            active.recovery_key = key;
        }
        // A recovered home is unsaved: autosave keeps writing it until it is saved
        active.revision = u64::from(active.doc.modified);
        let view = HomeView::of(&active);
        if let Ok(mut docs) = self.docs.lock() {
            docs.insert(home_label(label), active);
        }
        view
    }

    /// Bytes of a resource inside the home with the given ID.
    pub fn doc_content(&self, id: u32, name: &str) -> Option<Vec<u8>> {
        let guard = self.docs.lock().ok()?;
        let active = guard.values().find(|a| a.id == id)?;
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

    /// Keeps a collected model for the import preview (only the latest few) and returns its ID.
    pub fn stage_model(&self, package: msh_core::model_package::ModelPackage) -> u32 {
        let id = self.new_id();
        let mut stages = self.stages.lock().unwrap_or_else(|e| e.into_inner());
        // The preview needs only the current model; older ones are dropped
        stages.retain(|k, _| *k + 8 > id);
        stages.insert(id, package);
        id
    }

    /// A file of a staged model.
    pub fn staged_file(&self, id: u32, name: &str) -> Option<Vec<u8>> {
        let stages = self.stages.lock().ok()?;
        stages
            .get(&id)?
            .files
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, d)| d.clone())
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

/// Executes a registry command on the home of a window (`None`: the focused one),
/// creating an empty home if the window has none, and notifies that window if the home
/// changed.
pub fn execute<R: Runtime>(
    app: &AppHandle<R>,
    window: Option<&str>,
    name: &str,
    params: Value,
) -> Result<Value, String> {
    let state = app.state::<AppState>();
    let spec = state
        .registry
        .get(name)
        .ok_or_else(|| format!("unknown command '{name}'"))?;
    let label = window.map_or_else(|| state.focused(), home_label);
    let mut obsolete_recovery = None;
    let (result, view) = {
        let mut docs = state.docs.lock().map_err(|e| e.to_string())?;
        let active = docs
            .entry(label.clone())
            .or_insert_with(|| ActiveDoc::new(state.new_id(), Document::default()));
        // The clipboard is shared by all homes
        active.doc.clipboard = state.clipboard.lock().ok().and_then(|mut c| c.take());
        let result = state.registry.execute(&mut active.doc, name, params);
        if let Ok(mut c) = state.clipboard.lock() {
            *c = active.doc.clipboard.take();
        }
        let result = result.map_err(|e| e.to_string())?;
        if matches!(name, "camera_set" | "viewpoint_go") {
            active.camera_moves = active.camera_moves.wrapping_add(1);
        }
        let replaced = matches!(name, "home_new" | "home_open");
        if replaced {
            active.id = state.new_id();
            // The replaced home's recovery files are no longer needed
            obsolete_recovery = Some(std::mem::replace(
                &mut active.recovery_key,
                uuid::Uuid::new_v4().to_string(),
            ));
            active.revision = 0;
            active.autosaved = 0;
        }
        if spec.modifies || matches!(name, "edit_undo" | "edit_redo") {
            active.revision += 1;
        }
        if name == "home_save" {
            obsolete_recovery = Some(active.recovery_key.clone());
            active.autosaved = active.revision;
        }
        let changed =
            replaced || spec.modifies || matches!(name, "edit_undo" | "edit_redo" | "home_save");
        (result, changed.then(|| HomeView::of(active)))
    };
    if let Some(key) = obsolete_recovery {
        crate::autosave::remove_recovery(app, &key);
    }
    if let Some(view) = view {
        let _ = emit_home(app, &label, HOME_CHANGED_EVENT, view);
    }
    if matches!(
        name,
        "library_import"
            | "library_remove"
            | "library_set_visible"
            | "catalog_set_category"
            | "texture_import"
            | "furniture_import"
    ) {
        state.reload_libraries();
        let _ = app.emit(CATALOG_CHANGED_EVENT, ());
    }
    Ok(result)
}
