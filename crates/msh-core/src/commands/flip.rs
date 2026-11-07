//! Mirroring the selection.

use crate::registry::{CommandError, Registry};
use msh_model::{Furniture, Home};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;
use std::f32::consts::PI;

#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Axis {
    /// Mirror left ↔ right (around a vertical line)
    Horizontal,
    /// Mirror top ↔ bottom (around a horizontal line)
    Vertical,
}

#[derive(Deserialize, JsonSchema)]
struct FlipParams {
    /// IDs of walls, rooms, furniture, labels, dimension lines or polylines
    ids: Vec<String>,
    axis: Axis,
}

/// Mirrors a coordinate pair around the center line.
struct Mirror {
    axis: Axis,
    center: f32,
}

impl Mirror {
    fn point(&self, x: &mut f32, y: &mut f32) {
        match self.axis {
            Axis::Horizontal => *x = 2.0 * self.center - *x,
            Axis::Vertical => *y = 2.0 * self.center - *y,
        }
    }

    /// Angle of a mirrored piece whose model is mirrored too (keeps its shape).
    fn angle(&self, angle: f32) -> f32 {
        let a = match self.axis {
            Axis::Horizontal => -angle,
            Axis::Vertical => PI - angle,
        };
        a.rem_euclid(2.0 * PI)
    }
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "edit_flip",
        "Mirrors elements horizontally (left ↔ right) or vertically (top ↔ bottom) around the \
         center of their bounding box. Furniture gets a mirrored model, so e.g. doors open to the \
         other side.",
        true,
        |doc, p: FlipParams| {
            let home = doc.home_mut();
            let ids: HashSet<&str> = p.ids.iter().map(String::as_str).collect();
            let center = selection_center(home, &ids, p.axis)
                .ok_or_else(|| CommandError::failed(format!("no element found for {:?}", p.ids)))?;
            let m = Mirror {
                axis: p.axis,
                center,
            };
            let has = |id: &Option<String>| id.as_deref().is_some_and(|i| ids.contains(i));
            let mut flipped = 0;
            for w in home
                .walls
                .iter_mut()
                .filter(|w| ids.contains(w.attrs.id.as_str()))
            {
                let a = &mut w.attrs;
                m.point(&mut a.x_start, &mut a.y_start);
                m.point(&mut a.x_end, &mut a.y_end);
                // Reverse the direction so the left and right sides keep their physical
                // sides (mirroring alone swaps them); arcs keep their extent that way
                std::mem::swap(&mut a.x_start, &mut a.x_end);
                std::mem::swap(&mut a.y_start, &mut a.y_end);
                std::mem::swap(&mut a.wall_at_start, &mut a.wall_at_end);
                if let Some(end) = a.height_at_end {
                    let start = a.height.unwrap_or(end);
                    a.height = Some(end);
                    a.height_at_end = Some(start);
                }
                flipped += 1;
            }
            for r in home.rooms.iter_mut().filter(|r| has(&r.attrs.id)) {
                for pt in &mut r.points {
                    m.point(&mut pt.x, &mut pt.y);
                }
                r.points.reverse();
                flipped += 1;
            }
            for pl in home.polylines.iter_mut().filter(|p| has(&p.attrs.id)) {
                for pt in &mut pl.points {
                    m.point(&mut pt.x, &mut pt.y);
                }
                flipped += 1;
            }
            for l in home.labels.iter_mut().filter(|l| has(&l.attrs.id)) {
                m.point(&mut l.attrs.x, &mut l.attrs.y);
                flipped += 1;
            }
            for d in home.dimension_lines.iter_mut().filter(|d| has(&d.attrs.id)) {
                let a = &mut d.attrs;
                m.point(&mut a.x_start, &mut a.y_start);
                m.point(&mut a.x_end, &mut a.y_end);
                // The offset side is mirrored as well
                a.offset = -a.offset;
                flipped += 1;
            }
            fn flip_furniture(item: &mut Furniture, m: &Mirror) {
                match item {
                    Furniture::Piece(p) => {
                        let a = &mut p.attrs;
                        m.point(&mut a.x, &mut a.y);
                        a.angle = Some(m.angle(a.angle.unwrap_or(0.0)));
                        a.model_mirrored = Some(!a.model_mirrored.unwrap_or(false));
                    }
                    Furniture::Group(g) => {
                        if let (Some(x), Some(y)) = (g.attrs.x.as_mut(), g.attrs.y.as_mut()) {
                            m.point(x, y);
                        }
                        g.attrs.angle = g.attrs.angle.map(|a| m.angle(a));
                        for child in &mut g.items {
                            flip_furniture(child, m);
                        }
                    }
                }
            }
            for f in home.furniture.iter_mut() {
                let id = match f {
                    Furniture::Piece(p) => &p.attrs.id,
                    Furniture::Group(g) => &g.attrs.id,
                };
                if has(id) {
                    flip_furniture(f, &m);
                    flipped += 1;
                }
            }
            Ok(json!({ "flipped": flipped }))
        },
    );
}

/// Center of the selection's bounding box along the mirror axis.
fn selection_center(home: &Home, ids: &HashSet<&str>, axis: Axis) -> Option<f32> {
    let (mut lo, mut hi) = (f32::MAX, f32::MIN);
    let mut add = |x: f32, y: f32| {
        let v = if axis == Axis::Horizontal { x } else { y };
        lo = lo.min(v);
        hi = hi.max(v);
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
    fn pieces(item: &Furniture, add: &mut dyn FnMut(f32, f32)) {
        match item {
            Furniture::Piece(p) => add(p.attrs.x, p.attrs.y),
            Furniture::Group(g) => g.items.iter().for_each(|c| pieces(c, add)),
        }
    }
    for f in &home.furniture {
        let id = match f {
            Furniture::Piece(p) => &p.attrs.id,
            Furniture::Group(g) => &g.attrs.id,
        };
        if has(id) {
            pieces(f, &mut add);
        }
    }
    (lo <= hi).then(|| (lo + hi) / 2.0)
}
