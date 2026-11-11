//! Ruler guides: help lines in the plan for placing elements, drawn with the ruler mode of the
//! measuring tool. They are kept in the home as a property (`mySweetHome.guides`, a JSON
//! list), which Sweet Home 3D keeps without showing. They are not printed or exported.

use super::annotate::DashStyle;
use super::{new_id, parse_color, target_ids};
use crate::registry::{CommandError, Registry};
use msh_model::{Home, Property};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Home property holding the guides.
pub const GUIDES_PROPERTY: &str = "mySweetHome.guides";

/// One guide: a line from start to end on a level (cm, like the plan).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct Guide {
    pub id: String,
    pub level: Option<String>,
    pub x_start: f32,
    pub y_start: f32,
    pub x_end: f32,
    pub y_end: f32,
    /// Line color as "#RRGGBB" (default: the ruler color of the preferences when drawn)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// SOLID, DOT, DASH, DASH_DOT or DASH_DOT_DOT (default: DASH)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dash_style: Option<String>,
}

/// Normalizes a color to "#RRGGBB".
fn color_string(s: &str) -> Result<String, CommandError> {
    Ok(format!("#{:06X}", parse_color(s)?.0 & 0x00FF_FFFF))
}

/// The guides of a home (none if the property is missing or unreadable).
pub fn guides(home: &Home) -> Vec<Guide> {
    home.properties
        .iter()
        .find(|p| p.name == GUIDES_PROPERTY)
        .and_then(|p| serde_json::from_str(&p.value).ok())
        .unwrap_or_default()
}

/// Stores the guides of a home; no guides remove the property.
fn set_guides(home: &mut Home, guides: &[Guide]) {
    home.properties.retain(|p| p.name != GUIDES_PROPERTY);
    if !guides.is_empty() {
        home.properties.push(Property {
            name: GUIDES_PROPERTY.into(),
            value: serde_json::to_string(guides).unwrap_or_default(),
            kind: None,
            ..Default::default()
        });
    }
}

/// Deletes a guide; returns `true` if there was one with that ID.
pub(super) fn delete(home: &mut Home, id: &str) -> bool {
    let mut list = guides(home);
    let before = list.len();
    list.retain(|g| g.id != id);
    if list.len() == before {
        return false;
    }
    set_guides(home, &list);
    true
}

/// Moves the guides with the given IDs; returns how many were moved.
pub(super) fn move_guides(home: &mut Home, ids: &[String], dx: f32, dy: f32) -> usize {
    let mut list = guides(home);
    let mut moved = 0;
    for g in list.iter_mut().filter(|g| ids.contains(&g.id)) {
        g.x_start += dx;
        g.y_start += dy;
        g.x_end += dx;
        g.y_end += dy;
        moved += 1;
    }
    if moved > 0 {
        set_guides(home, &list);
    }
    moved
}

#[derive(Deserialize, JsonSchema)]
struct AddParams {
    x_start: f32,
    y_start: f32,
    x_end: f32,
    y_end: f32,
    /// Level ID (default: the selected level)
    level: Option<String>,
    /// Line color "#RRGGBB"
    color: Option<String>,
    /// Dash style (default DASH)
    dash_style: Option<DashStyle>,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateParams {
    id: Option<String>,
    ids: Option<Vec<String>>,
    /// Line color "#RRGGBB"
    color: Option<String>,
    dash_style: Option<DashStyle>,
    /// New start or end point in cm (moves that end of the guides)
    x_start: Option<f32>,
    y_start: Option<f32>,
    x_end: Option<f32>,
    y_end: Option<f32>,
}

#[derive(Deserialize, JsonSchema)]
struct ClearParams {
    /// Level ID, or "all" (default: the selected level)
    level: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct NoParams {}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "guide_add",
        "Adds a ruler guide: a help line in the plan for placing elements (not printed or \
         exported; delete it with edit_delete). Returns its ID.",
        true,
        |doc, p: AddParams| {
            let values = [p.x_start, p.y_start, p.x_end, p.y_end];
            if values.iter().any(|v| !v.is_finite()) {
                return Err(CommandError::failed("the coordinates must be numbers"));
            }
            if (p.x_end - p.x_start).hypot(p.y_end - p.y_start) < 0.1 {
                return Err(CommandError::failed("a guide needs two different points"));
            }
            let home = doc.home_mut();
            let level = match p.level {
                Some(l) => {
                    if !home.levels.iter().any(|x| x.attrs.id == l) {
                        return Err(CommandError::failed(format!("unknown level '{l}'")));
                    }
                    Some(l)
                }
                None if home.levels.is_empty() => None,
                None => home
                    .attrs
                    .selected_level
                    .clone()
                    .or_else(|| home.levels.first().map(|l| l.attrs.id.clone())),
            };
            let id = new_id("guide");
            let mut list = guides(home);
            list.push(Guide {
                id: id.clone(),
                level,
                x_start: p.x_start,
                y_start: p.y_start,
                x_end: p.x_end,
                y_end: p.y_end,
                color: p.color.as_deref().map(color_string).transpose()?,
                dash_style: p.dash_style.map(|d| d.as_str().into()),
            });
            set_guides(home, &list);
            Ok(json!({ "id": id }))
        },
    );
    r.add(
        "guide_update",
        "Changes the line color, dash style, start or end point of ruler guides.",
        true,
        |doc, p: UpdateParams| {
            let ids = target_ids(p.id, p.ids)?;
            let color = p.color.as_deref().map(color_string).transpose()?;
            let points = [p.x_start, p.y_start, p.x_end, p.y_end];
            if points.iter().flatten().any(|v| !v.is_finite()) {
                return Err(CommandError::failed("the coordinates must be numbers"));
            }
            let home = doc.home_mut();
            let mut list = guides(home);
            for id in &ids {
                if !list.iter().any(|g| &g.id == id) {
                    return Err(CommandError::failed(format!("unknown guide '{id}'")));
                }
            }
            for g in list.iter_mut().filter(|g| ids.contains(&g.id)) {
                if let Some(c) = &color {
                    g.color = Some(c.clone());
                }
                if let Some(d) = p.dash_style {
                    g.dash_style = Some(d.as_str().into());
                }
                g.x_start = p.x_start.unwrap_or(g.x_start);
                g.y_start = p.y_start.unwrap_or(g.y_start);
                g.x_end = p.x_end.unwrap_or(g.x_end);
                g.y_end = p.y_end.unwrap_or(g.y_end);
                if (g.x_end - g.x_start).hypot(g.y_end - g.y_start) < 0.1 {
                    return Err(CommandError::failed("a guide needs two different points"));
                }
            }
            set_guides(home, &list);
            Ok(json!({ "updated": ids }))
        },
    );
    r.add(
        "guide_list",
        "Lists the ruler guides of the home (ID, level, start and end in cm, color, dash style).",
        false,
        |doc, _: NoParams| Ok(json!({ "guides": guides(doc.home()) })),
    );
    r.add(
        "guide_clear",
        "Deletes all ruler guides of a level (default: the selected level) or of all levels.",
        true,
        |doc, p: ClearParams| {
            let home = doc.home_mut();
            let list = guides(home);
            let level = match p.level.as_deref() {
                Some("all") => None,
                Some(l) => Some(Some(l.to_owned())),
                None => Some(home.attrs.selected_level.clone()),
            };
            let kept: Vec<Guide> = match &level {
                None => Vec::new(),
                Some(l) => list.iter().filter(|g| &g.level != l).cloned().collect(),
            };
            let removed = list.len() - kept.len();
            if removed == 0 {
                return Err(CommandError::failed("no guides to delete"));
            }
            set_guides(home, &kept);
            Ok(json!({ "deleted": removed }))
        },
    );
}
