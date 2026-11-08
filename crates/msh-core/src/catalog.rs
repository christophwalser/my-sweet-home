//! Access to the installed furniture and texture catalogs, and embedding of
//! catalog resources into a document.

use crate::catalog_settings::{CatalogSettings, ItemKind};
use crate::document::Document;
use crate::registry::CommandError;
use msh_catalog::{CatalogKind, FurnitureItem, TextureItem, find_all_libraries, open_library};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

/// A furniture item together with its library file.
#[derive(Debug, Clone)]
pub struct FurnitureEntry {
    pub library: PathBuf,
    pub library_name: Option<String>,
    pub library_license: Option<String>,
    pub item: FurnitureItem,
}

/// A texture item together with its library file.
#[derive(Debug, Clone)]
pub struct TextureEntry {
    pub library: PathBuf,
    pub item: TextureItem,
}

/// All catalogs of this machine, loaded on first use and reloaded after libraries
/// were added or removed.
#[derive(Default)]
pub struct CatalogIndex {
    pub furniture: Vec<FurnitureEntry>,
    pub textures: Vec<TextureEntry>,
}

static INDEX: RwLock<Option<Arc<CatalogIndex>>> = RwLock::new(None);

/// Language of catalog names used by commands (override with `MSH_CATALOG_LANG`).
fn catalog_lang() -> String {
    std::env::var("MSH_CATALOG_LANG").unwrap_or_else(|_| "en".into())
}

impl CatalogIndex {
    /// The catalog index, loading all libraries on first use.
    pub fn get() -> Arc<CatalogIndex> {
        if let Some(index) = INDEX.read().ok().and_then(|g| g.clone()) {
            return index;
        }
        let index = Arc::new(Self::load());
        if let Ok(mut g) = INDEX.write() {
            *g = Some(index.clone());
        }
        index
    }

    /// Forgets the loaded libraries; the next [`CatalogIndex::get`] reads them again.
    pub fn reload() {
        if let Ok(mut g) = INDEX.write() {
            *g = None;
        }
    }

    fn load() -> CatalogIndex {
        {
            let lang = catalog_lang();
            let mut index = CatalogIndex::default();
            // Hidden libraries are left out; categories chosen by the user replace the
            // library's own
            let settings = CatalogSettings::load();
            for path in find_all_libraries(&[]) {
                if settings.is_hidden(&path) {
                    continue;
                }
                let Ok(mut catalogs) = open_library(&path, Some(&lang)) else {
                    continue;
                };
                for c in &mut catalogs {
                    for f in &mut c.furniture {
                        if let Some(cat) = settings.category(ItemKind::Furniture, f.id.as_deref()) {
                            f.category = cat.to_owned();
                        }
                    }
                    for t in &mut c.textures {
                        if let Some(cat) = settings.category(ItemKind::Textures, t.id.as_deref()) {
                            t.category = cat.to_owned();
                        }
                    }
                }
                for c in catalogs {
                    match c.kind {
                        CatalogKind::Furniture => {
                            index.furniture.extend(c.furniture.into_iter().map(|item| {
                                FurnitureEntry {
                                    library: path.clone(),
                                    library_name: c.name.clone(),
                                    library_license: c.license.clone(),
                                    item,
                                }
                            }))
                        }
                        CatalogKind::Textures => {
                            index
                                .textures
                                .extend(c.textures.into_iter().map(|item| TextureEntry {
                                    library: path.clone(),
                                    item,
                                }))
                        }
                    }
                }
            }
            index
        }
    }

    /// Finds a furniture item by catalog ID (first match wins).
    pub fn furniture_by_id(&self, id: &str) -> Option<&FurnitureEntry> {
        self.furniture
            .iter()
            .find(|f| f.item.id.as_deref() == Some(id))
    }

    /// Finds a texture by catalog ID.
    pub fn texture_by_id(&self, id: &str) -> Option<&TextureEntry> {
        self.textures
            .iter()
            .find(|t| t.item.id.as_deref() == Some(id))
    }
}

/// Resource names of an embedded catalog item.
pub(crate) struct EmbeddedResources {
    pub model: Option<String>,
    pub icon: Option<String>,
    pub plan_icon: Option<String>,
    /// Total size of the model files in bytes
    pub model_size: Option<i64>,
}

/// Copies the model, icon and plan icon of a catalog item into the document.
pub(crate) fn embed_furniture_resources(
    doc: &mut Document,
    entry: &FurnitureEntry,
) -> Result<EmbeddedResources, CommandError> {
    let lib = &entry.library;
    let item = &entry.item;
    let read = |res: &str| {
        msh_catalog::read_resource(lib, res).map_err(|e| CommandError::failed(e.to_string()))
    };

    let mut model_size = None;
    let model = match &item.model {
        None => None,
        Some(model) => {
            let index = doc.next_content_index();
            if item.multi_part_model {
                // All files of the model folder, keeping the folder structure
                let (dir, file) = model.rsplit_once('/').unwrap_or(("", model));
                let parts = msh_catalog::read_resource_dir(lib, dir)
                    .map_err(|e| CommandError::failed(e.to_string()))?;
                let mut size = 0;
                for (rel, data) in parts {
                    size += data.len();
                    doc.add_content(format!("{index}/{rel}"), data);
                }
                model_size = Some(size as i64);
                Some(format!("{index}/{file}"))
            } else {
                let data = read(model)?;
                model_size = Some(data.len() as i64);
                Some(doc.add_content(index.to_string(), data))
            }
        }
    };
    let icon = match &item.icon {
        Some(icon) => {
            let data = read(icon)?;
            let index = doc.next_content_index();
            Some(doc.add_content(index.to_string(), data))
        }
        None => None,
    };
    let plan_icon = match &item.plan_icon {
        Some(p) => {
            let data = read(p)?;
            let index = doc.next_content_index();
            Some(doc.add_content(index.to_string(), data))
        }
        None => None,
    };
    Ok(EmbeddedResources {
        model,
        icon,
        plan_icon,
        model_size,
    })
}

/// Copies a texture image into the document and returns its resource name.
pub(crate) fn embed_texture(
    doc: &mut Document,
    entry: &TextureEntry,
) -> Result<String, CommandError> {
    let data = msh_catalog::read_resource(&entry.library, &entry.item.image)
        .map_err(|e| CommandError::failed(e.to_string()))?;
    let index = doc.next_content_index();
    Ok(doc.add_content(index.to_string(), data))
}
