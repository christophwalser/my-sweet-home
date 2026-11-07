//! Delete, undo and redo.

use crate::registry::{CommandError, Registry};
use msh_model::{Furniture, Home};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize, JsonSchema)]
struct DeleteParams {
    /// IDs of walls, rooms, furniture, levels, labels, dimension lines or polylines.
    /// Deleting a level also deletes everything on it.
    ids: Vec<String>,
}

#[derive(Deserialize, JsonSchema)]
struct NoParams {}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "edit_delete",
        "Deletes elements by ID (any element type).",
        true,
        |doc, p: DeleteParams| {
            let home = doc.home_mut();
            let mut deleted = Vec::new();
            for id in &p.ids {
                if delete(home, id) {
                    deleted.push(id.clone());
                }
            }
            let missing: Vec<&String> = p.ids.iter().filter(|i| !deleted.contains(i)).collect();
            if deleted.is_empty() {
                return Err(CommandError::failed(format!(
                    "no element found for {missing:?}"
                )));
            }
            Ok(json!({ "deleted": deleted, "not_found": missing }))
        },
    );
    r.add(
        "edit_undo",
        "Undoes the last change.",
        false,
        |doc, _p: NoParams| match doc.undo() {
            Some(label) => Ok(json!({ "undone": label })),
            None => Err(CommandError::failed("nothing to undo")),
        },
    );
    r.add(
        "edit_redo",
        "Redoes the last undone change.",
        false,
        |doc, _p: NoParams| match doc.redo() {
            Some(label) => Ok(json!({ "redone": label })),
            None => Err(CommandError::failed("nothing to redo")),
        },
    );
}

/// Deletes one element; returns `true` if something was removed.
fn delete(home: &mut Home, id: &str) -> bool {
    let before = count(home);
    if home.levels.iter().any(|l| l.attrs.id == id) {
        let level = Some(id.to_owned());
        home.levels.retain(|l| l.attrs.id != id);
        home.walls.retain(|w| w.attrs.level != level);
        home.rooms.retain(|r| r.attrs.level != level);
        home.polylines.retain(|p| p.attrs.level != level);
        home.dimension_lines.retain(|d| d.attrs.level != level);
        home.labels.retain(|l| l.attrs.level != level);
        home.furniture.retain(|f| match f {
            Furniture::Piece(p) => p.attrs.level != level,
            Furniture::Group(g) => g.attrs.level != level,
        });
        if home.attrs.selected_level.as_deref() == Some(id) {
            home.attrs.selected_level = home.levels.first().map(|l| l.attrs.id.clone());
        }
    }
    home.walls.retain(|w| w.attrs.id != id);
    for w in &mut home.walls {
        if w.attrs.wall_at_start.as_deref() == Some(id) {
            w.attrs.wall_at_start = None;
        }
        if w.attrs.wall_at_end.as_deref() == Some(id) {
            w.attrs.wall_at_end = None;
        }
    }
    let some = |o: &Option<String>| o.as_deref() == Some(id);
    home.rooms.retain(|r| !some(&r.attrs.id));
    home.polylines.retain(|p| !some(&p.attrs.id));
    home.dimension_lines.retain(|d| !some(&d.attrs.id));
    home.labels.retain(|l| !some(&l.attrs.id));
    fn remove(items: &mut Vec<Furniture>, id: &str) {
        items.retain(|f| match f {
            Furniture::Piece(p) => p.attrs.id.as_deref() != Some(id),
            Furniture::Group(g) => g.attrs.id.as_deref() != Some(id),
        });
        for f in items.iter_mut() {
            if let Furniture::Group(g) = f {
                remove(&mut g.items, id);
            }
        }
    }
    remove(&mut home.furniture, id);
    count(home) != before
}

fn count(home: &Home) -> usize {
    home.levels.len()
        + home.walls.len()
        + home.rooms.len()
        + home.polylines.len()
        + home.dimension_lines.len()
        + home.labels.len()
        + home.piece_count()
        + home.furniture.len()
}
