//! Move, delete, undo and redo.

use crate::registry::{CommandError, Registry};
use msh_model::{Furniture, Home};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;

#[derive(Deserialize, JsonSchema)]
struct DeleteParams {
    /// IDs of walls, rooms, furniture, levels, labels, dimension lines or polylines.
    /// Deleting a level also deletes everything on it.
    ids: Vec<String>,
}

#[derive(Deserialize, JsonSchema)]
struct MoveParams {
    /// IDs of walls, rooms, furniture, labels, dimension lines or polylines
    ids: Vec<String>,
    /// Offset in cm (x to the right, y down)
    dx: f32,
    dy: f32,
}

#[derive(Deserialize, JsonSchema)]
struct NoParams {}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "edit_move",
        "Moves elements by (dx, dy) cm. Walls joined to a moved wall keep their connection: \
         their touching end moves along.",
        true,
        |doc, p: MoveParams| {
            let moved = move_elements(doc.home_mut(), &p.ids, p.dx, p.dy);
            if moved == 0 {
                return Err(CommandError::failed(format!(
                    "no element found for {:?}",
                    p.ids
                )));
            }
            Ok(json!({ "moved": moved }))
        },
    );
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

/// Moves the elements with the given IDs; returns how many were moved.
fn move_elements(home: &mut Home, ids: &[String], dx: f32, dy: f32) -> usize {
    let ids: HashSet<&str> = ids.iter().map(String::as_str).collect();
    let mut moved = 0;
    let has = |id: &Option<String>| id.as_deref().is_some_and(|i| ids.contains(i));

    // Walls: selected walls move completely; the touching end of joined walls follows
    let moved_walls: HashSet<String> = home
        .walls
        .iter()
        .filter(|w| ids.contains(w.attrs.id.as_str()))
        .map(|w| w.attrs.id.clone())
        .collect();
    for w in &mut home.walls {
        let a = &mut w.attrs;
        if moved_walls.contains(&a.id) {
            a.x_start += dx;
            a.y_start += dy;
            a.x_end += dx;
            a.y_end += dy;
            moved += 1;
            continue;
        }
        if a.wall_at_start
            .as_ref()
            .is_some_and(|j| moved_walls.contains(j))
        {
            a.x_start += dx;
            a.y_start += dy;
        }
        if a.wall_at_end
            .as_ref()
            .is_some_and(|j| moved_walls.contains(j))
        {
            a.x_end += dx;
            a.y_end += dy;
        }
    }

    fn shift_furniture(item: &mut Furniture, dx: f32, dy: f32) {
        match item {
            Furniture::Piece(p) => {
                p.attrs.x += dx;
                p.attrs.y += dy;
            }
            Furniture::Group(g) => {
                g.attrs.x = g.attrs.x.map(|x| x + dx);
                g.attrs.y = g.attrs.y.map(|y| y + dy);
                for child in &mut g.items {
                    shift_furniture(child, dx, dy);
                }
            }
        }
    }
    fn walk(
        items: &mut [Furniture],
        has: &dyn Fn(&Option<String>) -> bool,
        dx: f32,
        dy: f32,
    ) -> usize {
        let mut n = 0;
        for item in items {
            let selected = match item {
                Furniture::Piece(p) => has(&p.attrs.id),
                Furniture::Group(g) => has(&g.attrs.id),
            };
            if selected {
                shift_furniture(item, dx, dy);
                n += 1;
            } else if let Furniture::Group(g) = item {
                n += walk(&mut g.items, has, dx, dy);
            }
        }
        n
    }
    moved += walk(&mut home.furniture, &has, dx, dy);

    for r in home.rooms.iter_mut().filter(|r| has(&r.attrs.id)) {
        r.points.iter_mut().for_each(|p| {
            p.x += dx;
            p.y += dy;
        });
        moved += 1;
    }
    for p in home.polylines.iter_mut().filter(|p| has(&p.attrs.id)) {
        p.points.iter_mut().for_each(|pt| {
            pt.x += dx;
            pt.y += dy;
        });
        moved += 1;
    }
    for l in home.labels.iter_mut().filter(|l| has(&l.attrs.id)) {
        l.attrs.x += dx;
        l.attrs.y += dy;
        moved += 1;
    }
    for d in home.dimension_lines.iter_mut().filter(|d| has(&d.attrs.id)) {
        d.attrs.x_start += dx;
        d.attrs.y_start += dy;
        d.attrs.x_end += dx;
        d.attrs.y_end += dy;
        moved += 1;
    }
    moved
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
