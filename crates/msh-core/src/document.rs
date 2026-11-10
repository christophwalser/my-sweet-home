//! An open project with undo/redo history.

use msh_format::{ContentEntry, Sh3dDocument};
use msh_model::{Furniture, Home, HomeAttrs};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Maximum number of undo steps kept in memory.
const MAX_UNDO: usize = 100;

/// Default wall height of new homes in cm (as in Sweet Home 3D).
pub const DEFAULT_WALL_HEIGHT: f32 = 250.0;

/// State of the home before a command, used for undo and redo.
#[derive(Clone)]
struct Snapshot {
    label: String,
    home: Home,
}

/// An open project: the home, its resources, file path and history.
pub struct Document {
    pub file: Sh3dDocument,
    pub path: Option<PathBuf>,
    pub modified: bool,
    /// Set when resources were added, so stale `ContentDigests` are not written
    contents_changed: bool,
    undo: Vec<Snapshot>,
    redo: Vec<Snapshot>,
    /// Copied elements (`edit_copy`); kept when another home is opened
    pub clipboard: Option<crate::clipboard::Clipboard>,
}

impl Default for Document {
    fn default() -> Self {
        Self::new_home(None, DEFAULT_WALL_HEIGHT)
    }
}

impl Document {
    /// New, empty home.
    pub fn new_home(name: Option<String>, wall_height: f32) -> Self {
        let home = Home {
            attrs: HomeAttrs {
                version: Some(7400),
                name,
                camera: Some("topCamera".into()),
                wall_height: Some(wall_height),
                ..Default::default()
            },
            furniture_visible_properties: ["NAME", "WIDTH", "DEPTH", "HEIGHT", "VISIBLE"]
                .map(String::from)
                .to_vec(),
            ..Default::default()
        };
        Self {
            file: Sh3dDocument::new(home),
            path: None,
            modified: false,
            contents_changed: false,
            undo: Vec::new(),
            redo: Vec::new(),
            clipboard: None,
        }
    }

    /// Opens a `.sh3d` file or a standalone `Home.xml`.
    pub fn open(path: &Path) -> Result<Self, msh_format::FormatError> {
        let is_xml = path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("xml"));
        let mut file = if is_xml {
            Sh3dDocument::new(msh_format::read_home_xml(&std::fs::read(path)?)?)
        } else {
            Sh3dDocument::open(path)?
        };
        ensure_ids(&mut file.home);
        Ok(Self {
            file,
            // A standalone Home.xml is saved as .sh3d next to it
            path: Some(if is_xml {
                path.with_extension("sh3d")
            } else {
                path.to_owned()
            }),
            modified: false,
            contents_changed: false,
            undo: Vec::new(),
            redo: Vec::new(),
            clipboard: None,
        })
    }

    pub fn home(&self) -> &Home {
        &self.file.home
    }

    pub fn home_mut(&mut self) -> &mut Home {
        &mut self.file.home
    }

    /// Saves to `path` (or the current path). Unreferenced resources are dropped.
    pub fn save(&mut self, path: Option<&Path>) -> Result<PathBuf, msh_format::FormatError> {
        let target = path
            .map(Path::to_owned)
            .or_else(|| self.path.clone())
            .ok_or_else(|| {
                msh_format::FormatError::Structure("no file path given for saving".into())
            })?;
        self.prune_contents();
        // Like Sweet Home 3D, the home is named after its file: after "Save as" the new one
        if let Some(file_name) = target.file_name() {
            self.file.home.attrs.name = Some(file_name.to_string_lossy().into_owned());
        }
        if self.contents_changed {
            // The digests no longer match the resources; Sweet Home 3D accepts files without them
            self.file.content_digests = None;
        }
        self.file.save(&target)?;
        self.path = Some(target.clone());
        self.modified = false;
        Ok(target)
    }

    /// Copy of the file for autosave: written elsewhere without changing the path or the
    /// modified state of the document.
    pub fn recovery_copy(&self) -> Sh3dDocument {
        let mut file = self.file.clone();
        if self.contents_changed {
            file.content_digests = None;
        }
        file
    }

    /// Records the current state before a modifying command.
    pub(crate) fn checkpoint(&mut self, label: &str) {
        self.undo.push(Snapshot {
            label: label.to_owned(),
            home: self.file.home.clone(),
        });
        if self.undo.len() > MAX_UNDO {
            self.undo.remove(0);
        }
        self.redo.clear();
    }

    /// Drops the last checkpoint (command failed, state restored by caller).
    pub(crate) fn discard_checkpoint(&mut self) -> Option<Home> {
        self.undo.pop().map(|s| s.home)
    }

    /// Reverts the last command. Returns its label.
    pub fn undo(&mut self) -> Option<String> {
        let snap = self.undo.pop()?;
        let current = std::mem::replace(&mut self.file.home, snap.home);
        self.redo.push(Snapshot {
            label: snap.label.clone(),
            home: current,
        });
        self.modified = true;
        Some(snap.label)
    }

    /// Re-applies the last undone command. Returns its label.
    pub fn redo(&mut self) -> Option<String> {
        let snap = self.redo.pop()?;
        let current = std::mem::replace(&mut self.file.home, snap.home);
        self.undo.push(Snapshot {
            label: snap.label.clone(),
            home: current,
        });
        self.modified = true;
        Some(snap.label)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// Adds a resource and returns its entry name.
    pub(crate) fn add_content(&mut self, name: String, data: Vec<u8>) -> String {
        self.file.contents.push(ContentEntry {
            name: name.clone(),
            data,
        });
        self.contents_changed = true;
        name
    }

    /// Next free numeric resource prefix (`0`, `1`, … as Sweet Home 3D uses).
    pub(crate) fn next_content_index(&self) -> u32 {
        self.file
            .contents
            .iter()
            .filter_map(|c| c.name.split('/').next()?.parse::<u32>().ok())
            .max()
            .map_or(0, |n| n + 1)
    }

    /// Removes resources that nothing in the home references any more.
    fn prune_contents(&mut self) {
        let refs = referenced_contents(&self.file.home);
        let before = self.file.contents.len();
        self.file.contents.retain(|c| {
            let top = c.name.split('/').next().unwrap_or(&c.name);
            refs.contains(c.name.as_str()) || refs.iter().any(|r| r.split('/').next() == Some(top))
        });
        if self.file.contents.len() != before {
            self.contents_changed = true;
        }
    }
}

/// Gives every element an ID. Files of older Sweet Home 3D versions have no IDs
/// on furniture, rooms, labels, dimension lines and polylines; commands and
/// selection need them. Sweet Home 3D 7 writes and reads such IDs itself.
pub fn ensure_ids(home: &mut Home) {
    use crate::commands::new_id;
    fn walk(items: &mut [Furniture]) {
        for item in items {
            match item {
                Furniture::Piece(p) => {
                    if p.attrs.id.is_none() {
                        let prefix = match p.kind {
                            msh_model::PieceKind::DoorOrWindow => "doorOrWindow",
                            msh_model::PieceKind::Light => "light",
                            _ => "pieceOfFurniture",
                        };
                        p.attrs.id = Some(new_id(prefix));
                    }
                }
                Furniture::Group(g) => {
                    if g.attrs.id.is_none() {
                        g.attrs.id = Some(new_id("furnitureGroup"));
                    }
                    walk(&mut g.items);
                }
            }
        }
    }
    walk(&mut home.furniture);
    for r in &mut home.rooms {
        r.attrs.id.get_or_insert_with(|| new_id("room"));
    }
    for l in &mut home.labels {
        l.attrs.id.get_or_insert_with(|| new_id("label"));
    }
    for d in &mut home.dimension_lines {
        d.attrs.id.get_or_insert_with(|| new_id("dimensionLine"));
    }
    for p in &mut home.polylines {
        p.attrs.id.get_or_insert_with(|| new_id("polyline"));
    }
}

/// IDs of all elements of a home.
pub fn all_ids(home: &Home) -> HashSet<String> {
    let mut ids: HashSet<String> = home.walls.iter().map(|w| w.attrs.id.clone()).collect();
    fn walk(items: &[Furniture], ids: &mut HashSet<String>) {
        for item in items {
            match item {
                Furniture::Piece(p) => ids.extend(p.attrs.id.clone()),
                Furniture::Group(g) => {
                    ids.extend(g.attrs.id.clone());
                    walk(&g.items, ids);
                }
            }
        }
    }
    walk(&home.furniture, &mut ids);
    ids.extend(home.levels.iter().map(|l| l.attrs.id.clone()));
    ids.extend(home.rooms.iter().filter_map(|r| r.attrs.id.clone()));
    ids.extend(home.polylines.iter().filter_map(|p| p.attrs.id.clone()));
    ids.extend(
        home.dimension_lines
            .iter()
            .filter_map(|d| d.attrs.id.clone()),
    );
    ids.extend(home.labels.iter().filter_map(|l| l.attrs.id.clone()));
    ids
}

/// All resource names referenced by the home (models, icons, textures, images).
pub fn referenced_contents(home: &Home) -> HashSet<String> {
    let mut refs = HashSet::new();
    let mut add = |s: &Option<String>| {
        if let Some(s) = s {
            refs.insert(s.clone());
        }
    };
    fn walk(items: &[Furniture], add: &mut impl FnMut(&Option<String>)) {
        for item in items {
            match item {
                Furniture::Piece(p) => {
                    add(&p.attrs.model);
                    add(&p.attrs.icon);
                    add(&p.attrs.plan_icon);
                    if let Some(t) = &p.texture {
                        add(&Some(t.image.clone()));
                    }
                    for m in &p.materials {
                        if let Some(t) = &m.texture {
                            add(&Some(t.image.clone()));
                        }
                    }
                }
                Furniture::Group(g) => walk(&g.items, add),
            }
        }
    }
    walk(&home.furniture, &mut add);
    for w in &home.walls {
        for t in &w.textures {
            add(&Some(t.image.clone()));
        }
        for b in &w.baseboards {
            if let Some(t) = &b.texture {
                add(&Some(t.image.clone()));
            }
        }
    }
    for r in &home.rooms {
        for t in &r.textures {
            add(&Some(t.image.clone()));
        }
    }
    if let Some(e) = &home.environment {
        for t in &e.textures {
            add(&Some(t.image.clone()));
        }
    }
    if let Some(b) = &home.background_image {
        add(&Some(b.image.clone()));
    }
    for l in &home.levels {
        if let Some(b) = &l.background_image {
            add(&Some(b.image.clone()));
        }
    }
    for p in &home.properties {
        if p.kind.as_deref() == Some("CONTENT") {
            add(&Some(p.value.clone()));
        }
    }
    refs
}
