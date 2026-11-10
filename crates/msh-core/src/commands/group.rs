//! Furniture groups.

use super::new_id;
use crate::registry::{CommandError, Registry};
use msh_model::{Furniture, FurnitureGroup, GroupAttrs, Piece};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize, JsonSchema)]
struct GroupParams {
    /// IDs of at least two pieces or groups on the same level (top level, not inside a group)
    ids: Vec<String>,
    /// Name of the group (default "Group")
    name: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct UngroupParams {
    /// IDs of groups to dissolve; their pieces stay where they are
    ids: Vec<String>,
}

fn furniture_id(f: &Furniture) -> Option<&str> {
    match f {
        Furniture::Piece(p) => p.attrs.id.as_deref(),
        Furniture::Group(g) => g.attrs.id.as_deref(),
    }
}

fn furniture_level(f: &Furniture) -> Option<String> {
    match f {
        Furniture::Piece(p) => p.attrs.level.clone(),
        Furniture::Group(g) => g.attrs.level.clone(),
    }
}

/// Calls `f` for every piece inside `items` (recursively).
fn each_piece<'a>(items: &'a [Furniture], f: &mut impl FnMut(&'a Piece)) {
    for item in items {
        match item {
            Furniture::Piece(p) => f(p),
            Furniture::Group(g) => each_piece(&g.items, f),
        }
    }
}

/// Bounding box of the plan footprints and the vertical extent of the pieces.
fn extent(items: &[Furniture]) -> Option<([f32; 4], f32, f32)> {
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    let (mut bottom, mut top) = (f32::MAX, f32::MIN);
    let mut any = false;
    each_piece(items, &mut |p| {
        any = true;
        let a = &p.attrs;
        let w = a.width_in_plan.unwrap_or(a.width) / 2.0;
        let d = a.depth_in_plan.unwrap_or(a.depth) / 2.0;
        let (s, c) = a.angle.unwrap_or(0.0).sin_cos();
        for (x, y) in [(-w, -d), (w, -d), (w, d), (-w, d)] {
            let px = a.x + x * c - y * s;
            let py = a.y + x * s + y * c;
            min_x = min_x.min(px);
            min_y = min_y.min(py);
            max_x = max_x.max(px);
            max_y = max_y.max(py);
        }
        let elevation = a.elevation.unwrap_or(0.0);
        bottom = bottom.min(elevation);
        top = top.max(elevation + a.height_in_plan.unwrap_or(a.height));
    });
    any.then_some(([min_x, min_y, max_x, max_y], bottom, top))
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "furniture_group",
        "Groups pieces of furniture (or groups) so they are selected, moved and copied together. \
         Returns the ID of the new group.",
        true,
        |doc, p: GroupParams| {
            let distinct: std::collections::HashSet<&String> = p.ids.iter().collect();
            if distinct.len() < 2 {
                return Err(CommandError::failed("a group needs at least two pieces"));
            }
            let home = doc.home_mut();
            let mut members = Vec::new();
            let mut position = None;
            for id in &p.ids {
                let i = home
                    .furniture
                    .iter()
                    .position(|f| furniture_id(f) == Some(id.as_str()))
                    .ok_or_else(|| {
                        CommandError::failed(format!(
                            "'{id}' is not a piece or group on the top level"
                        ))
                    })?;
                position = Some(position.map_or(i, |pos: usize| pos.min(i)));
                members.push(i);
            }
            let level = furniture_level(&home.furniture[members[0]]);
            if members
                .iter()
                .any(|&i| furniture_level(&home.furniture[i]) != level)
            {
                return Err(CommandError::failed("the pieces are on different levels"));
            }
            // Take the members out, keeping their order in the home
            members.sort_unstable();
            members.dedup();
            let mut items = Vec::new();
            for &i in members.iter().rev() {
                items.push(home.furniture.remove(i));
            }
            items.reverse();
            let ([x0, y0, x1, y1], bottom, top) =
                extent(&items).ok_or_else(|| CommandError::failed("the group is empty"))?;
            let id = new_id("furnitureGroup");
            let group = FurnitureGroup {
                attrs: GroupAttrs {
                    id: Some(id.clone()),
                    level,
                    name: p.name.unwrap_or_else(|| "Group".into()),
                    x: Some((x0 + x1) / 2.0),
                    y: Some((y0 + y1) / 2.0),
                    elevation: Some(bottom),
                    angle: Some(0.0),
                    width: Some(x1 - x0),
                    depth: Some(y1 - y0),
                    height: Some(top - bottom),
                    ..Default::default()
                },
                items,
                properties: Vec::new(),
                text_style: None,
                extra_children: Vec::new(),
            };
            let at = position.unwrap_or(0).min(home.furniture.len());
            home.furniture.insert(at, Furniture::Group(Box::new(group)));
            Ok(json!({ "id": id }))
        },
    );
    r.add(
        "furniture_ungroup",
        "Dissolves furniture groups; their pieces stay in place. Returns the IDs of the pieces.",
        true,
        |doc, p: UngroupParams| {
            let home = doc.home_mut();
            let mut released = Vec::new();
            for id in &p.ids {
                let i = home
                    .furniture
                    .iter()
                    .position(|f| {
                        matches!(f, Furniture::Group(_)) && furniture_id(f) == Some(id.as_str())
                    })
                    .ok_or_else(|| {
                        CommandError::failed(format!("'{id}' is not a group on the top level"))
                    })?;
                let Furniture::Group(group) = home.furniture.remove(i) else {
                    unreachable!("checked above");
                };
                let level = group.attrs.level.clone();
                for (k, mut item) in group.items.into_iter().enumerate() {
                    match &mut item {
                        Furniture::Piece(p) => p.attrs.level = level.clone(),
                        Furniture::Group(g) => g.attrs.level = level.clone(),
                    }
                    released.extend(furniture_id(&item).map(String::from));
                    home.furniture.insert(i + k, item);
                }
            }
            Ok(json!({ "ids": released }))
        },
    );
}
