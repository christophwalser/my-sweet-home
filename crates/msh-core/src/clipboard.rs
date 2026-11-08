//! Copy, paste and duplicate.
//!
//! A [`Clipboard`] holds copies of elements together with the resources they
//! reference (models, icons, textures), so it can be pasted into the same home or
//! into another home opened later in the same session.

use crate::commands::new_id;
use crate::document::Document;
use msh_format::ContentEntry;
use msh_model::{DimensionLine, Furniture, Label, Polyline, Room, Texture, Wall};
use std::collections::{HashMap, HashSet};

/// Copied elements with the resources they need.
#[derive(Debug, Clone, Default)]
pub struct Clipboard {
    pub walls: Vec<Wall>,
    pub rooms: Vec<Room>,
    pub furniture: Vec<Furniture>,
    pub polylines: Vec<Polyline>,
    pub dimension_lines: Vec<DimensionLine>,
    pub labels: Vec<Label>,
    /// Resources referenced by the copied elements (all entries of a multi-part model)
    pub contents: Vec<ContentEntry>,
}

impl Clipboard {
    /// Copies the elements with the given IDs. Furniture inside groups can be copied
    /// on its own; a copied group includes its children.
    pub fn copy(doc: &Document, ids: &[String]) -> Self {
        let ids: HashSet<&str> = ids.iter().map(String::as_str).collect();
        let has = |id: &Option<String>| id.as_deref().is_some_and(|i| ids.contains(i));
        let home = doc.home();
        let mut clip = Clipboard {
            walls: home
                .walls
                .iter()
                .filter(|w| ids.contains(w.attrs.id.as_str()))
                .cloned()
                .collect(),
            rooms: home
                .rooms
                .iter()
                .filter(|r| has(&r.attrs.id))
                .cloned()
                .collect(),
            polylines: home
                .polylines
                .iter()
                .filter(|p| has(&p.attrs.id))
                .cloned()
                .collect(),
            dimension_lines: home
                .dimension_lines
                .iter()
                .filter(|d| has(&d.attrs.id))
                .cloned()
                .collect(),
            labels: home
                .labels
                .iter()
                .filter(|l| has(&l.attrs.id))
                .cloned()
                .collect(),
            ..Default::default()
        };
        fn collect(
            items: &[Furniture],
            has: &dyn Fn(&Option<String>) -> bool,
            out: &mut Vec<Furniture>,
        ) {
            for item in items {
                let id = match item {
                    Furniture::Piece(p) => &p.attrs.id,
                    Furniture::Group(g) => &g.attrs.id,
                };
                if has(id) {
                    out.push(item.clone());
                } else if let Furniture::Group(g) = item {
                    collect(&g.items, has, out);
                }
            }
        }
        collect(&home.furniture, &has, &mut clip.furniture);

        let mut tops = HashSet::new();
        clip.for_each_content_ref(&mut |name| {
            tops.insert(top_segment(name).to_owned());
        });
        clip.contents = doc
            .file
            .contents
            .iter()
            .filter(|c| tops.contains(top_segment(&c.name)))
            .cloned()
            .collect();
        clip
    }

    pub fn is_empty(&self) -> bool {
        self.walls.is_empty()
            && self.rooms.is_empty()
            && self.furniture.is_empty()
            && self.polylines.is_empty()
            && self.dimension_lines.is_empty()
            && self.labels.is_empty()
    }

    /// IDs of the copied top-level elements.
    fn ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.walls.iter().map(|w| w.attrs.id.clone()).collect();
        ids.extend(self.rooms.iter().filter_map(|r| r.attrs.id.clone()));
        ids.extend(self.furniture.iter().filter_map(|f| match f {
            Furniture::Piece(p) => p.attrs.id.clone(),
            Furniture::Group(g) => g.attrs.id.clone(),
        }));
        ids.extend(self.polylines.iter().filter_map(|p| p.attrs.id.clone()));
        ids.extend(
            self.dimension_lines
                .iter()
                .filter_map(|d| d.attrs.id.clone()),
        );
        ids.extend(self.labels.iter().filter_map(|l| l.attrs.id.clone()));
        ids
    }

    /// Pastes the elements into `doc` on `level`, moved by (dx, dy), with new IDs.
    /// If `offset` is `None`, the copies are moved by 20 cm when the originals are
    /// still in the home (so they do not hide each other), otherwise they keep their
    /// position. Returns the IDs of the new elements.
    pub fn paste(
        &self,
        doc: &mut Document,
        level: Option<String>,
        offset: Option<(f32, f32)>,
    ) -> Vec<String> {
        let (dx, dy) = offset.unwrap_or_else(|| {
            let existing = crate::document::all_ids(doc.home());
            if self.ids().iter().any(|id| existing.contains(id)) {
                (20.0, 20.0)
            } else {
                (0.0, 0.0)
            }
        });
        let mut clip = self.clone();
        let renamed = clip.merge_contents_into(doc);
        if !renamed.is_empty() {
            clip.for_each_content_ref_mut(&mut |name| {
                let top = top_segment(name);
                if let Some(new_top) = renamed.get(top) {
                    *name = format!("{new_top}{}", &name[top.len()..]);
                }
            });
        }

        let mut new_ids = Vec::new();
        // Walls: new IDs, joins kept only between copied walls
        let wall_ids: HashMap<String, String> = clip
            .walls
            .iter()
            .map(|w| (w.attrs.id.clone(), new_id("wall")))
            .collect();
        for mut w in clip.walls {
            let a = &mut w.attrs;
            a.id = wall_ids[&a.id].clone();
            a.wall_at_start = a
                .wall_at_start
                .as_ref()
                .and_then(|j| wall_ids.get(j).cloned());
            a.wall_at_end = a
                .wall_at_end
                .as_ref()
                .and_then(|j| wall_ids.get(j).cloned());
            a.level = level.clone();
            a.x_start += dx;
            a.y_start += dy;
            a.x_end += dx;
            a.y_end += dy;
            new_ids.push(a.id.clone());
            doc.home_mut().walls.push(w);
        }
        for mut r in clip.rooms {
            let id = new_id("room");
            r.attrs.id = Some(id.clone());
            r.attrs.level = level.clone();
            for p in &mut r.points {
                p.x += dx;
                p.y += dy;
            }
            new_ids.push(id);
            doc.home_mut().rooms.push(r);
        }
        for mut f in clip.furniture {
            renew_furniture(&mut f, dx, dy);
            match &mut f {
                Furniture::Piece(p) => {
                    p.attrs.level = level.clone();
                    new_ids.extend(p.attrs.id.clone());
                }
                Furniture::Group(g) => {
                    g.attrs.level = level.clone();
                    new_ids.extend(g.attrs.id.clone());
                }
            }
            doc.home_mut().furniture.push(f);
        }
        for mut p in clip.polylines {
            let id = new_id("polyline");
            p.attrs.id = Some(id.clone());
            p.attrs.level = level.clone();
            for pt in &mut p.points {
                pt.x += dx;
                pt.y += dy;
            }
            new_ids.push(id);
            doc.home_mut().polylines.push(p);
        }
        for mut d in clip.dimension_lines {
            let id = new_id("dimensionLine");
            let a = &mut d.attrs;
            a.id = Some(id.clone());
            a.level = level.clone();
            a.x_start += dx;
            a.y_start += dy;
            a.x_end += dx;
            a.y_end += dy;
            new_ids.push(id);
            doc.home_mut().dimension_lines.push(d);
        }
        for mut l in clip.labels {
            let id = new_id("label");
            l.attrs.id = Some(id.clone());
            l.attrs.level = level.clone();
            l.attrs.x += dx;
            l.attrs.y += dy;
            new_ids.push(id);
            doc.home_mut().labels.push(l);
        }
        new_ids
    }

    /// The clipboard with its resources added to `doc` and its references renamed where
    /// names were taken (for applying styles of the copied elements).
    pub fn merged_into(&self, doc: &mut Document) -> Self {
        let mut clip = self.clone();
        let renamed = clip.merge_contents_into(doc);
        if !renamed.is_empty() {
            clip.for_each_content_ref_mut(&mut |name| {
                let top = top_segment(name);
                if let Some(new_top) = renamed.get(top) {
                    *name = format!("{new_top}{}", &name[top.len()..]);
                }
            });
        }
        clip
    }

    /// Adds the clipboard resources to `doc`. Resources that already exist with the
    /// same data are reused; name conflicts get a new numeric prefix. Returns the
    /// renamed top-level prefixes (old → new).
    fn merge_contents_into(&self, doc: &mut Document) -> HashMap<String, String> {
        let mut groups: HashMap<&str, Vec<&ContentEntry>> = HashMap::new();
        for c in &self.contents {
            groups.entry(top_segment(&c.name)).or_default().push(c);
        }
        let mut renamed = HashMap::new();
        let mut tops: Vec<&str> = groups.keys().copied().collect();
        tops.sort_unstable();
        for top in tops {
            let entries = &groups[top];
            let existing: Vec<&ContentEntry> = doc
                .file
                .contents
                .iter()
                .filter(|c| top_segment(&c.name) == top)
                .collect();
            if existing.is_empty() {
                for e in entries {
                    doc.add_content(e.name.clone(), e.data.clone());
                }
                continue;
            }
            let same = existing.len() == entries.len()
                && entries.iter().all(|e| {
                    existing
                        .iter()
                        .any(|x| x.name == e.name && x.data == e.data)
                });
            if same {
                continue;
            }
            let new_top = doc.next_content_index().to_string();
            for e in entries {
                let name = format!("{new_top}{}", &e.name[top.len()..]);
                doc.add_content(name, e.data.clone());
            }
            renamed.insert(top.to_owned(), new_top);
        }
        renamed
    }

    fn for_each_content_ref(&self, f: &mut dyn FnMut(&str)) {
        let mut clip = self.clone();
        clip.for_each_content_ref_mut(&mut |s| f(s));
    }

    /// Calls `f` for every resource name referenced by the copied elements.
    fn for_each_content_ref_mut(&mut self, f: &mut dyn FnMut(&mut String)) {
        fn tex(t: &mut Texture, f: &mut dyn FnMut(&mut String)) {
            f(&mut t.image);
        }
        fn walk(items: &mut [Furniture], f: &mut dyn FnMut(&mut String)) {
            for item in items {
                match item {
                    Furniture::Piece(p) => {
                        let a = &mut p.attrs;
                        for s in [&mut a.model, &mut a.icon, &mut a.plan_icon]
                            .into_iter()
                            .flatten()
                        {
                            f(s);
                        }
                        if let Some(t) = &mut p.texture {
                            tex(t, f);
                        }
                        for m in &mut p.materials {
                            if let Some(t) = &mut m.texture {
                                tex(t, f);
                            }
                        }
                    }
                    Furniture::Group(g) => walk(&mut g.items, f),
                }
            }
        }
        walk(&mut self.furniture, f);
        for w in &mut self.walls {
            for t in &mut w.textures {
                tex(t, f);
            }
            for b in &mut w.baseboards {
                if let Some(t) = &mut b.texture {
                    tex(t, f);
                }
            }
        }
        for r in &mut self.rooms {
            for t in &mut r.textures {
                tex(t, f);
            }
        }
    }
}

/// New IDs for a piece or group (recursively) and offset by (dx, dy).
fn renew_furniture(item: &mut Furniture, dx: f32, dy: f32) {
    match item {
        Furniture::Piece(p) => {
            let prefix = match p.kind {
                msh_model::PieceKind::DoorOrWindow => "doorOrWindow",
                msh_model::PieceKind::Light => "light",
                _ => "pieceOfFurniture",
            };
            p.attrs.id = Some(new_id(prefix));
            p.attrs.x += dx;
            p.attrs.y += dy;
        }
        Furniture::Group(g) => {
            g.attrs.id = Some(new_id("furnitureGroup"));
            g.attrs.x = g.attrs.x.map(|x| x + dx);
            g.attrs.y = g.attrs.y.map(|y| y + dy);
            for child in &mut g.items {
                renew_furniture(child, dx, dy);
            }
        }
    }
}

/// First path segment of a resource name (`1/door.obj` → `1`).
fn top_segment(name: &str) -> &str {
    name.split('/').next().unwrap_or(name)
}
