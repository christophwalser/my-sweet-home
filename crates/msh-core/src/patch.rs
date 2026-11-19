//! Changes between two states of a home.
//!
//! A window that shows a home gets the whole home once and after each command only what
//! changed: the fields of the home that differ and, for its lists of elements, the changed
//! or added elements (and the order of the IDs if elements were added, removed or moved).
//! That keeps the transfer and the work of the window small, however large the home is.

use msh_geometry::WallShape;
use msh_model::{Furniture, Home};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Changes of a list whose elements have IDs.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ListPatch {
    /// IDs of all elements in their new order, if elements were added, removed or moved
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<Vec<String>>,
    /// The changed and the added elements
    pub changed: Vec<Value>,
}

/// What differs between two states of a home (and of the outlines of its walls).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeChanges {
    /// Changed fields of the home with their new values (also lists whose elements cannot be
    /// told apart by an ID)
    pub fields: Map<String, Value>,
    /// Changed lists of elements by the name of their field
    pub lists: BTreeMap<&'static str, ListPatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wall_shapes: Option<ListPatch>,
}

impl HomeChanges {
    pub fn is_empty(&self) -> bool {
        self.fields.is_empty() && self.lists.is_empty() && self.wall_shapes.is_none()
    }
}

/// JSON value of a part of the home, with the numbers the whole home is sent with.
///
/// Through text, not `to_value`: that widens `f32` to `f64`, so a window would get
/// 1.5707963705062866 in a patch where the whole home said 1.5707964, and take an unchanged
/// value (the camera of the 3D view, for one) for a changed one.
fn value<T: Serialize>(v: &T) -> Value {
    serde_json::to_string(v)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(Value::Null)
}

/// Patch of a list, `Err` with the whole list if its elements have no unique IDs, `None`
/// if nothing changed.
fn list_patch<T: PartialEq + Serialize>(
    prev: &[T],
    next: &[T],
    id: impl Fn(&T) -> Option<&str>,
) -> Option<Result<ListPatch, Value>> {
    if prev == next {
        return None;
    }
    let ids: Option<Vec<&str>> = next.iter().map(&id).collect();
    let mut seen = HashSet::new();
    let Some(ids) = ids.filter(|ids| ids.iter().all(|i| seen.insert(*i))) else {
        return Some(Err(value(&next)));
    };
    let before: HashMap<&str, &T> = prev.iter().filter_map(|e| id(e).map(|i| (i, e))).collect();
    let changed = next
        .iter()
        .zip(&ids)
        .filter(|(e, i)| before.get(*i).is_none_or(|p| *p != *e))
        .map(|(e, _)| value(e))
        .collect();
    let same_order =
        prev.len() == next.len() && prev.iter().zip(&ids).all(|(p, i)| id(p) == Some(*i));
    Some(Ok(ListPatch {
        order: (!same_order).then(|| ids.iter().map(|i| (*i).to_owned()).collect()),
        changed,
    }))
}

/// The changes that turn `prev` (with the wall outlines `prev_shapes`) into `next`.
pub fn home_changes(
    prev: &Home,
    next: &Home,
    prev_shapes: &[WallShape],
    next_shapes: &[WallShape],
) -> HomeChanges {
    let mut out = HomeChanges::default();
    macro_rules! field {
        ($($f:ident),*) => { $(
            if prev.$f != next.$f {
                out.fields.insert(stringify!($f).into(), value(&next.$f));
            }
        )* };
    }
    field!(
        attrs,
        properties,
        furniture_visible_properties,
        environment,
        background_image,
        print,
        compass,
        cameras,
        extra_children
    );
    macro_rules! list {
        ($f:ident, $id:expr) => {
            match list_patch(&prev.$f, &next.$f, $id) {
                Some(Ok(patch)) => {
                    out.lists.insert(stringify!($f), patch);
                }
                Some(Err(all)) => {
                    out.fields.insert(stringify!($f).into(), all);
                }
                None => {}
            }
        };
    }
    list!(levels, |l| Some(l.attrs.id.as_str()));
    list!(furniture, |f| match f {
        Furniture::Piece(p) => p.attrs.id.as_deref(),
        Furniture::Group(g) => g.attrs.id.as_deref(),
    });
    list!(walls, |w| Some(w.attrs.id.as_str()));
    list!(rooms, |r| r.attrs.id.as_deref());
    list!(polylines, |p| p.attrs.id.as_deref());
    list!(dimension_lines, |d| d.attrs.id.as_deref());
    list!(labels, |l| l.attrs.id.as_deref());
    out.wall_shapes = match list_patch(prev_shapes, next_shapes, |s| Some(s.id.as_str())) {
        Some(Ok(patch)) => Some(patch),
        // Outlines without unique IDs: all of them, in order
        Some(Err(_)) => Some(ListPatch {
            order: Some(next_shapes.iter().map(|s| s.id.clone()).collect()),
            changed: next_shapes.iter().map(value).collect(),
        }),
        None => None,
    };
    out
}
