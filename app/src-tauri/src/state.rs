//! Application state shared by commands and the resource protocol.

use crate::resources::LibraryStore;
use msh_format::Sh3dDocument;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

/// An opened project.
pub struct OpenDoc {
    pub doc: Sh3dDocument,
    index: HashMap<String, usize>,
}

impl OpenDoc {
    pub fn new(doc: Sh3dDocument) -> Self {
        let index = doc
            .contents
            .iter()
            .enumerate()
            .map(|(i, c)| (c.name.clone(), i))
            .collect();
        Self { doc, index }
    }

    /// Bytes of a resource inside the `.sh3d` file.
    pub fn content(&self, name: &str) -> Option<Vec<u8>> {
        self.index
            .get(name)
            .map(|&i| self.doc.contents[i].data.clone())
    }
}

#[derive(Default)]
pub struct AppState {
    docs: Mutex<HashMap<u32, Arc<OpenDoc>>>,
    next_id: AtomicU32,
    libraries: OnceLock<Arc<LibraryStore>>,
}

impl AppState {
    pub fn add_doc(&self, doc: OpenDoc) -> u32 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        if let Ok(mut docs) = self.docs.lock() {
            docs.insert(id, Arc::new(doc));
        }
        id
    }

    pub fn doc(&self, id: u32) -> Option<Arc<OpenDoc>> {
        self.docs.lock().ok()?.get(&id).cloned()
    }

    pub fn close_doc(&self, id: u32) {
        if let Ok(mut docs) = self.docs.lock() {
            docs.remove(&id);
        }
    }

    /// Library files on this machine, discovered on first use.
    pub fn libraries(&self) -> Arc<LibraryStore> {
        self.libraries
            .get_or_init(|| Arc::new(LibraryStore::new(msh_catalog::find_all_libraries(&[]))))
            .clone()
    }
}
