//! Joining, detaching and splitting walls.

use super::new_id;
use crate::registry::{CommandError, Registry};
use msh_model::{Home, WallAttrs};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize, JsonSchema)]
struct JoinParams {
    /// IDs of the two walls to connect
    ids: Vec<String>,
}

#[derive(Deserialize, JsonSchema)]
struct DetachParams {
    /// IDs of the walls whose connections are removed
    ids: Vec<String>,
}

#[derive(Deserialize, JsonSchema)]
struct SplitParams {
    id: String,
    /// Point [x, y] where the wall is split (projected onto its axis); default: the middle
    at: Option<[f32; 2]>,
}

type P = [f32; 2];

fn start(a: &WallAttrs) -> P {
    [a.x_start, a.y_start]
}

fn end(a: &WallAttrs) -> P {
    [a.x_end, a.y_end]
}

fn dist(a: P, b: P) -> f32 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

/// Position of `p` along the wall axis: 0 at the start, 1 at the end.
fn param(a: &WallAttrs, p: P) -> f32 {
    let d = [a.x_end - a.x_start, a.y_end - a.y_start];
    let len2 = d[0] * d[0] + d[1] * d[1];
    if len2 == 0.0 {
        return 0.0;
    }
    ((p[0] - a.x_start) * d[0] + (p[1] - a.y_start) * d[1]) / len2
}

fn is_straight(a: &WallAttrs) -> bool {
    a.arc_extent.is_none_or(|e| e.abs() < 1e-4)
}

fn index_of(home: &Home, id: &str) -> Result<usize, CommandError> {
    home.walls
        .iter()
        .position(|w| w.attrs.id == id)
        .ok_or_else(|| CommandError::failed(format!("unknown wall '{id}'")))
}

/// Removes every reference to `id` from the joins of other walls.
fn forget(home: &mut Home, id: &str) {
    for w in &mut home.walls {
        if w.attrs.wall_at_start.as_deref() == Some(id) {
            w.attrs.wall_at_start = None;
        }
        if w.attrs.wall_at_end.as_deref() == Some(id) {
            w.attrs.wall_at_end = None;
        }
    }
}

/// Clears the join at one end of wall `index` (and the reference back from the other wall).
fn clear_end(home: &mut Home, index: usize, at_start: bool) {
    let id = home.walls[index].attrs.id.clone();
    let old = if at_start {
        home.walls[index].attrs.wall_at_start.take()
    } else {
        home.walls[index].attrs.wall_at_end.take()
    };
    if let Some(other) = old
        && let Some(o) = home.walls.iter_mut().find(|w| w.attrs.id == other)
    {
        if o.attrs.wall_at_start.as_deref() == Some(id.as_str()) {
            o.attrs.wall_at_start = None;
        }
        if o.attrs.wall_at_end.as_deref() == Some(id.as_str()) {
            o.attrs.wall_at_end = None;
        }
    }
}

fn set_end(a: &mut WallAttrs, at_start: bool, p: P) {
    if at_start {
        (a.x_start, a.y_start) = (p[0], p[1]);
    } else {
        (a.x_end, a.y_end) = (p[0], p[1]);
    }
}

fn round(p: P) -> P {
    [
        (p[0] * 100.0).round() / 100.0,
        (p[1] * 100.0).round() / 100.0,
    ]
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "wall_join",
        "Connects two walls. Their axes are extended or shortened to their intersection: if it \
         is near an end of both walls, they get a mitered corner; if it lies inside one wall, \
         the other one ends on its axis (T junction). Collinear walls are joined end to end.",
        true,
        |doc, p: JoinParams| {
            let [a_id, b_id] = p.ids.as_slice() else {
                return Err(CommandError::failed("wall_join needs exactly two wall IDs"));
            };
            let home = doc.home_mut();
            let (ia, ib) = (index_of(home, a_id)?, index_of(home, b_id)?);
            if ia == ib {
                return Err(CommandError::failed("a wall cannot be joined to itself"));
            }
            let (a, b) = (home.walls[ia].attrs.clone(), home.walls[ib].attrs.clone());
            if !is_straight(&a) || !is_straight(&b) {
                return Err(CommandError::failed("arc walls cannot be joined"));
            }
            if a.level != b.level {
                return Err(CommandError::failed("the walls are on different levels"));
            }
            let da = [a.x_end - a.x_start, a.y_end - a.y_start];
            let db = [b.x_end - b.x_start, b.y_end - b.y_start];
            let cross = da[0] * db[1] - da[1] * db[0];
            let la = da[0].hypot(da[1]);
            let lb = db[0].hypot(db[1]);
            if la < 1e-3 || lb < 1e-3 {
                return Err(CommandError::failed("a wall has no length"));
            }

            let point = if cross.abs() < 1e-4 * la * lb {
                // Parallel: only collinear walls can be joined, at the middle of their closest ends
                let off = ((b.x_start - a.x_start) * da[1] - (b.y_start - a.y_start) * da[0]) / la;
                if off.abs() > 1.0 {
                    return Err(CommandError::failed("parallel walls cannot be joined"));
                }
                let (pa, pb) = [
                    (start(&a), start(&b)),
                    (start(&a), end(&b)),
                    (end(&a), start(&b)),
                    (end(&a), end(&b)),
                ]
                .into_iter()
                .min_by(|x, y| dist(x.0, x.1).total_cmp(&dist(y.0, y.1)))
                .unwrap_or((start(&a), start(&b)));
                [(pa[0] + pb[0]) / 2.0, (pa[1] + pb[1]) / 2.0]
            } else {
                let w = [b.x_start - a.x_start, b.y_start - a.y_start];
                let t = (w[0] * db[1] - w[1] * db[0]) / cross;
                [a.x_start + da[0] * t, a.y_start + da[1] * t]
            };
            let point = round(point);

            // Whether the point lies inside a wall (away from both of its ends)
            let margin = a.thickness.max(b.thickness);
            let inside = |w: &WallAttrs| {
                let t = param(w, point);
                t > 0.0 && t < 1.0 && dist(point, start(w)) > margin && dist(point, end(w)) > margin
            };
            let a_start_near = dist(start(&a), point) <= dist(end(&a), point);
            let b_start_near = dist(start(&b), point) <= dist(end(&b), point);
            match (inside(&a), inside(&b)) {
                (true, true) => Err(CommandError::failed(
                    "the walls cross each other; split one of them first (wall_split)",
                )),
                (false, true) => {
                    clear_end(home, ia, a_start_near);
                    set_end(&mut home.walls[ia].attrs, a_start_near, point);
                    Ok(json!({ "joined": "t", "point": point }))
                }
                (true, false) => {
                    clear_end(home, ib, b_start_near);
                    set_end(&mut home.walls[ib].attrs, b_start_near, point);
                    Ok(json!({ "joined": "t", "point": point }))
                }
                (false, false) => {
                    clear_end(home, ia, a_start_near);
                    clear_end(home, ib, b_start_near);
                    let wa = &mut home.walls[ia].attrs;
                    set_end(wa, a_start_near, point);
                    if a_start_near {
                        wa.wall_at_start = Some(b_id.clone());
                    } else {
                        wa.wall_at_end = Some(b_id.clone());
                    }
                    let wb = &mut home.walls[ib].attrs;
                    set_end(wb, b_start_near, point);
                    if b_start_near {
                        wb.wall_at_start = Some(a_id.clone());
                    } else {
                        wb.wall_at_end = Some(a_id.clone());
                    }
                    Ok(json!({ "joined": "corner", "point": point }))
                }
            }
        },
    );
    r.add(
        "wall_detach",
        "Removes all connections of the given walls (their corners are no longer mitered and \
         they move independently).",
        true,
        |doc, p: DetachParams| {
            let home = doc.home_mut();
            for id in &p.ids {
                let i = index_of(home, id)?;
                home.walls[i].attrs.wall_at_start = None;
                home.walls[i].attrs.wall_at_end = None;
                forget(home, id);
            }
            Ok(json!({ "detached": p.ids }))
        },
    );
    r.add(
        "wall_split",
        "Splits a straight wall into two joined walls at a point (default: the middle). Returns \
         the IDs of both parts.",
        true,
        |doc, p: SplitParams| {
            let home = doc.home_mut();
            let i = index_of(home, &p.id)?;
            let a = home.walls[i].attrs.clone();
            if !is_straight(&a) {
                return Err(CommandError::failed("arc walls cannot be split"));
            }
            let t = match p.at {
                Some(at) => param(&a, at),
                None => 0.5,
            };
            let len = dist(start(&a), end(&a));
            if t * len < 1.0 || (1.0 - t) * len < 1.0 {
                return Err(CommandError::failed(
                    "the split point must lie inside the wall",
                ));
            }
            let point = round([
                a.x_start + (a.x_end - a.x_start) * t,
                a.y_start + (a.y_end - a.y_start) * t,
            ]);
            let new_id = new_id("wall");
            let mut second = home.walls[i].clone();
            second.attrs.id = new_id.clone();
            (second.attrs.x_start, second.attrs.y_start) = (point[0], point[1]);
            second.attrs.wall_at_start = Some(a.id.clone());
            // Sloping walls: the height at the split point is interpolated
            if let (Some(h0), Some(h1)) = (a.height, a.height_at_end) {
                let h = h0 + (h1 - h0) * t;
                second.attrs.height = Some(h);
                home.walls[i].attrs.height_at_end = Some(h);
            }
            {
                let first = &mut home.walls[i].attrs;
                (first.x_end, first.y_end) = (point[0], point[1]);
                first.wall_at_end = Some(new_id.clone());
            }
            // The wall joined at the old end is now joined to the second part
            if let Some(other) = &a.wall_at_end
                && let Some(o) = home.walls.iter_mut().find(|w| &w.attrs.id == other)
            {
                if o.attrs.wall_at_start.as_deref() == Some(a.id.as_str())
                    && (o.attrs.x_start, o.attrs.y_start) == (a.x_end, a.y_end)
                {
                    o.attrs.wall_at_start = Some(new_id.clone());
                } else if o.attrs.wall_at_end.as_deref() == Some(a.id.as_str()) {
                    o.attrs.wall_at_end = Some(new_id.clone());
                } else if o.attrs.wall_at_start.as_deref() == Some(a.id.as_str()) {
                    o.attrs.wall_at_start = Some(new_id.clone());
                }
            }
            home.walls.insert(i + 1, second);
            Ok(json!({ "ids": [a.id, new_id] }))
        },
    );
}
