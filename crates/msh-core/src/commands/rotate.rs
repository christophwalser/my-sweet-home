//! Rotating the selection.

use super::edit::carried_openings;
use super::guide::{guides, set_guides};
use crate::registry::{CommandError, Registry};
use msh_model::{Furniture, Home};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;
use std::f32::consts::TAU;

#[derive(Deserialize, JsonSchema)]
struct RotateParams {
    /// IDs of walls, rooms, furniture, labels, dimension lines, polylines or rulers
    ids: Vec<String>,
    /// Angle in degrees, clockwise in the plan
    angle_deg: f32,
    /// Point to rotate around in cm (default: the center of the elements' bounding box)
    x: Option<f32>,
    y: Option<f32>,
}

/// Rotation around a point, clockwise in the plan (y points down).
struct Rotation {
    cx: f32,
    cy: f32,
    sin: f32,
    cos: f32,
    angle: f32,
}

impl Rotation {
    fn point(&self, x: &mut f32, y: &mut f32) {
        let (dx, dy) = (*x - self.cx, *y - self.cy);
        *x = self.cx + dx * self.cos - dy * self.sin;
        *y = self.cy + dx * self.sin + dy * self.cos;
    }

    /// Rotates a vector (an offset from a point that is rotated itself).
    fn vector(&self, x: &mut Option<f32>, y: &mut Option<f32>) {
        if x.is_none() && y.is_none() {
            return;
        }
        let (dx, dy) = (x.unwrap_or(0.0), y.unwrap_or(0.0));
        *x = Some(dx * self.cos - dy * self.sin);
        *y = Some(dx * self.sin + dy * self.cos);
    }

    fn turned(&self, angle: f32) -> f32 {
        (angle + self.angle).rem_euclid(TAU)
    }
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "edit_rotate",
        "Rotates elements by an angle (clockwise) around a point, by default the center of their \
         bounding box. Furniture turns with it, texts stay upright. Doors and windows in a rotated \
         wall follow it, and walls joined to a rotated wall keep their connection: their touching \
         end moves along.",
        true,
        |doc, p: RotateParams| {
            if !p.angle_deg.is_finite() {
                return Err(CommandError::failed("angle_deg must be a number"));
            }
            if p.x.is_some_and(|v| !v.is_finite()) || p.y.is_some_and(|v| !v.is_finite()) {
                return Err(CommandError::failed("x and y must be numbers"));
            }
            let home = doc.home_mut();
            let ids: HashSet<&str> = p.ids.iter().map(String::as_str).collect();
            let (bx, by) = bounding_center(home, &ids)
                .ok_or_else(|| CommandError::failed(format!("no element found for {:?}", p.ids)))?;
            let angle = p.angle_deg.to_radians();
            let rot = Rotation {
                cx: p.x.unwrap_or(bx),
                cy: p.y.unwrap_or(by),
                sin: angle.sin(),
                cos: angle.cos(),
                angle,
            };
            let rotated = rotate_elements(home, &ids, &rot);
            Ok(json!({
                "rotated": rotated,
                "x": round2(rot.cx),
                "y": round2(rot.cy),
            }))
        },
    );
}

fn round2(v: f32) -> f32 {
    (v * 100.0).round() / 100.0
}

fn rotate_elements(home: &mut Home, ids: &HashSet<&str>, rot: &Rotation) -> usize {
    let carried = carried_openings(home, ids);
    let has = |id: &Option<String>| {
        id.as_deref()
            .is_some_and(|i| ids.contains(i) || carried.contains(i))
    };
    let mut rotated = 0;

    for w in &mut home.walls {
        let a = &mut w.attrs;
        if ids.contains(a.id.as_str()) {
            rot.point(&mut a.x_start, &mut a.y_start);
            rot.point(&mut a.x_end, &mut a.y_end);
            rotated += 1;
            continue;
        }
        // The touching end of a joined wall follows
        if a.wall_at_start.as_deref().is_some_and(|j| ids.contains(j)) {
            rot.point(&mut a.x_start, &mut a.y_start);
        }
        if a.wall_at_end.as_deref().is_some_and(|j| ids.contains(j)) {
            rot.point(&mut a.x_end, &mut a.y_end);
        }
    }

    fn turn(item: &mut Furniture, rot: &Rotation) {
        match item {
            Furniture::Piece(p) => {
                let a = &mut p.attrs;
                rot.point(&mut a.x, &mut a.y);
                a.angle = Some(rot.turned(a.angle_or_default()));
            }
            Furniture::Group(g) => {
                if let (Some(x), Some(y)) = (g.attrs.x.as_mut(), g.attrs.y.as_mut()) {
                    rot.point(x, y);
                }
                g.attrs.angle = Some(rot.turned(g.attrs.angle.unwrap_or(0.0)));
                for child in &mut g.items {
                    turn(child, rot);
                }
            }
        }
    }
    fn walk(
        items: &mut [Furniture],
        has: &dyn Fn(&Option<String>) -> bool,
        rot: &Rotation,
    ) -> usize {
        let mut n = 0;
        for item in items {
            let selected = match item {
                Furniture::Piece(p) => has(&p.attrs.id),
                Furniture::Group(g) => has(&g.attrs.id),
            };
            if selected {
                turn(item, rot);
                n += 1;
            } else if let Furniture::Group(g) = item {
                n += walk(&mut g.items, has, rot);
            }
        }
        n
    }
    rotated += walk(&mut home.furniture, &has, rot);

    for r in home.rooms.iter_mut().filter(|r| has(&r.attrs.id)) {
        for pt in &mut r.points {
            rot.point(&mut pt.x, &mut pt.y);
        }
        // Name and area keep their place in the room; the texts stay upright
        let a = &mut r.attrs;
        rot.vector(&mut a.name_x_offset, &mut a.name_y_offset);
        rot.vector(&mut a.area_x_offset, &mut a.area_y_offset);
        rotated += 1;
    }
    for pl in home.polylines.iter_mut().filter(|p| has(&p.attrs.id)) {
        for pt in &mut pl.points {
            rot.point(&mut pt.x, &mut pt.y);
        }
        rotated += 1;
    }
    for l in home.labels.iter_mut().filter(|l| has(&l.attrs.id)) {
        rot.point(&mut l.attrs.x, &mut l.attrs.y);
        rotated += 1;
    }
    for d in home.dimension_lines.iter_mut().filter(|d| has(&d.attrs.id)) {
        let a = &mut d.attrs;
        rot.point(&mut a.x_start, &mut a.y_start);
        rot.point(&mut a.x_end, &mut a.y_end);
        rotated += 1;
    }
    let mut list = guides(home);
    let mut turned_guides = 0;
    for g in list.iter_mut().filter(|g| ids.contains(g.id.as_str())) {
        rot.point(&mut g.x_start, &mut g.y_start);
        rot.point(&mut g.x_end, &mut g.y_end);
        turned_guides += 1;
    }
    if turned_guides > 0 {
        set_guides(home, &list);
    }
    rotated + turned_guides
}

/// Center of the bounding box of the elements with the given IDs.
fn bounding_center(home: &Home, ids: &HashSet<&str>) -> Option<(f32, f32)> {
    let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    let mut add = |x: f32, y: f32| {
        x0 = x0.min(x);
        y0 = y0.min(y);
        x1 = x1.max(x);
        y1 = y1.max(y);
    };
    let has = |id: &Option<String>| id.as_deref().is_some_and(|i| ids.contains(i));
    for w in home
        .walls
        .iter()
        .filter(|w| ids.contains(w.attrs.id.as_str()))
    {
        add(w.attrs.x_start, w.attrs.y_start);
        add(w.attrs.x_end, w.attrs.y_end);
    }
    for r in home.rooms.iter().filter(|r| has(&r.attrs.id)) {
        r.points.iter().for_each(|p| add(p.x, p.y));
    }
    for pl in home.polylines.iter().filter(|p| has(&p.attrs.id)) {
        pl.points.iter().for_each(|p| add(p.x, p.y));
    }
    for l in home.labels.iter().filter(|l| has(&l.attrs.id)) {
        add(l.attrs.x, l.attrs.y);
    }
    for d in home.dimension_lines.iter().filter(|d| has(&d.attrs.id)) {
        add(d.attrs.x_start, d.attrs.y_start);
        add(d.attrs.x_end, d.attrs.y_end);
    }
    for g in guides(home).iter().filter(|g| ids.contains(g.id.as_str())) {
        add(g.x_start, g.y_start);
        add(g.x_end, g.y_end);
    }
    fn pieces(
        items: &[Furniture],
        has: &dyn Fn(&Option<String>) -> bool,
        inside: bool,
        add: &mut dyn FnMut(f32, f32),
    ) {
        for item in items {
            match item {
                Furniture::Piece(p) => {
                    if inside || has(&p.attrs.id) {
                        add(p.attrs.x, p.attrs.y);
                    }
                }
                Furniture::Group(g) => pieces(&g.items, has, inside || has(&g.attrs.id), add),
            }
        }
    }
    pieces(&home.furniture, &has, false, &mut add);
    (x0 <= x1).then(|| ((x0 + x1) / 2.0, (y0 + y1) / 2.0))
}
