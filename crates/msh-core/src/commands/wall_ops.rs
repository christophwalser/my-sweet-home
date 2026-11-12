//! Joining, detaching and splitting walls.

use super::new_id;
use crate::registry::{CommandError, Registry};
use msh_model::{Home, WallAttrs};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize, JsonSchema)]
struct JoinParams {
    /// IDs of the walls to connect (two, or more to add walls to joined ones)
    ids: Vec<String>,
}

#[derive(Deserialize, JsonSchema)]
struct DetachParams {
    /// IDs of the walls whose connections are removed
    ids: Vec<String>,
}

#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum WallEnd {
    Start,
    End,
}

#[derive(Deserialize, JsonSchema)]
struct AngleParams {
    /// Wall that is rotated
    id: String,
    /// End of the wall where it is joined to the reference wall; the wall rotates around it
    at: WallEnd,
    /// Angle between the two walls at that corner in degrees (0 < angle < 360, e.g. 90)
    angle_deg: f32,
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

/// How two walls are joined: at the intersection of their axes, either as a corner (both end
/// there) or as a T junction (one ends on the axis of the other).
enum Join {
    /// Both walls end at `point`, at their start or end
    Corner {
        point: P,
        a_start: bool,
        b_start: bool,
    },
    /// Wall `a` (or `b` when `moves_a` is false) ends at `point` inside the other wall
    T {
        point: P,
        moves_a: bool,
        at_start: bool,
    },
}

/// Computes how walls `ia` and `ib` would be joined, without changing them.
fn plan_join(home: &Home, ia: usize, ib: usize) -> Result<Join, CommandError> {
    if ia == ib {
        return Err(CommandError::failed("a wall cannot be joined to itself"));
    }
    let (a, b) = (&home.walls[ia].attrs, &home.walls[ib].attrs);
    if !is_straight(a) || !is_straight(b) {
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
            (start(a), start(b)),
            (start(a), end(b)),
            (end(a), start(b)),
            (end(a), end(b)),
        ]
        .into_iter()
        .min_by(|x, y| dist(x.0, x.1).total_cmp(&dist(y.0, y.1)))
        .unwrap_or((start(a), start(b)));
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
    let a_start = dist(start(a), point) <= dist(end(a), point);
    let b_start = dist(start(b), point) <= dist(end(b), point);
    match (inside(a), inside(b)) {
        (true, true) => Err(CommandError::failed(
            "the walls cross each other; split one of them first (wall_split)",
        )),
        (false, true) => Ok(Join::T {
            point,
            moves_a: true,
            at_start: a_start,
        }),
        (true, false) => Ok(Join::T {
            point,
            moves_a: false,
            at_start: b_start,
        }),
        (false, false) => Ok(Join::Corner {
            point,
            a_start,
            b_start,
        }),
    }
}

/// Joins walls `ia` and `ib` as planned by [`plan_join`].
fn apply_join(home: &mut Home, ia: usize, ib: usize, join: &Join) -> serde_json::Value {
    match *join {
        Join::T {
            point,
            moves_a,
            at_start,
        } => {
            let i = if moves_a { ia } else { ib };
            clear_end(home, i, at_start);
            set_end(&mut home.walls[i].attrs, at_start, point);
            json!({ "joined": "t", "point": point })
        }
        Join::Corner {
            point,
            a_start,
            b_start,
        } => {
            let (a_id, b_id) = (
                home.walls[ia].attrs.id.clone(),
                home.walls[ib].attrs.id.clone(),
            );
            clear_end(home, ia, a_start);
            clear_end(home, ib, b_start);
            let wa = &mut home.walls[ia].attrs;
            set_end(wa, a_start, point);
            if a_start {
                wa.wall_at_start = Some(b_id);
            } else {
                wa.wall_at_end = Some(b_id);
            }
            let wb = &mut home.walls[ib].attrs;
            set_end(wb, b_start, point);
            if b_start {
                wb.wall_at_start = Some(a_id);
            } else {
                wb.wall_at_end = Some(a_id);
            }
            json!({ "joined": "corner", "point": point })
        }
    }
}

/// Height of wall `a` at its start or end.
fn height_at(a: &WallAttrs, at_start: bool) -> Option<f32> {
    if at_start {
        a.height
    } else {
        a.height_at_end.or(a.height)
    }
}

/// Merges two straight, collinear walls of the same thickness whose ends meet (e.g. the parts
/// of a split wall) into wall `ia`, which then reaches the far end of wall `ib` and takes over
/// its join there; wall `ib` is removed. Returns `None` (nothing changed) for other walls.
fn merge_collinear(home: &mut Home, ia: usize, ib: usize) -> Option<serde_json::Value> {
    let (a, b) = (home.walls[ia].attrs.clone(), home.walls[ib].attrs.clone());
    if ia == ib || !is_straight(&a) || !is_straight(&b) || a.level != b.level {
        return None;
    }
    if (a.thickness - b.thickness).abs() > 0.01 {
        return None;
    }
    let da = [a.x_end - a.x_start, a.y_end - a.y_start];
    let db = [b.x_end - b.x_start, b.y_end - b.y_start];
    let (la, lb) = (da[0].hypot(da[1]), db[0].hypot(db[1]));
    if la < 1e-3 || lb < 1e-3 || (da[0] * db[1] - da[1] * db[0]).abs() > 1e-4 * la * lb {
        return None;
    }
    // The meeting ends (start or end of each wall)
    let (a_start, b_start) = [(true, true), (true, false), (false, true), (false, false)]
        .into_iter()
        .min_by(|x, y| {
            let d = |(sa, sb): (bool, bool)| {
                let pa = if sa { start(&a) } else { end(&a) };
                let pb = if sb { start(&b) } else { end(&b) };
                dist(pa, pb)
            };
            d(*x).total_cmp(&d(*y))
        })?;
    let pa = if a_start { start(&a) } else { end(&a) };
    let pb = if b_start { start(&b) } else { end(&b) };
    // The walls must continue each other, not overlap
    let far_b = if b_start { end(&b) } else { start(&b) };
    let far_a = if a_start { end(&a) } else { start(&a) };
    if dist(pa, pb) > 1.0 || dist(far_a, far_b) < la.max(lb) {
        return None;
    }
    let (a_id, b_id) = (a.id.clone(), b.id.clone());
    let far_join = joined_at(&b, !b_start)
        .filter(|j| *j != a_id)
        .map(str::to_string);
    let far_height = height_at(&b, !b_start);
    {
        let w = &mut home.walls[ia].attrs;
        set_end(w, a_start, far_b);
        if a_start {
            w.wall_at_start = far_join;
        } else {
            w.wall_at_end = far_join;
        }
        // Sloping walls keep the heights of both far ends
        let (h0, h1) = if a_start {
            (far_height, height_at(&a, false))
        } else {
            (height_at(&a, true), far_height)
        };
        if h0 != h1 || a.height_at_end.is_some() {
            (w.height, w.height_at_end) = (h0, h1);
        }
    }
    // Walls joined to the removed wall are joined to the merged one
    for w in &mut home.walls {
        if w.attrs.id == a_id {
            continue;
        }
        if w.attrs.wall_at_start.as_deref() == Some(b_id.as_str()) {
            w.attrs.wall_at_start = Some(a_id.clone());
        }
        if w.attrs.wall_at_end.as_deref() == Some(b_id.as_str()) {
            w.attrs.wall_at_end = Some(a_id.clone());
        }
    }
    home.walls.remove(ib);
    Some(json!({ "joined": "merged", "id": a_id, "removed": b_id }))
}

/// The wall joined at one end of `a` (start or end).
fn joined_at(a: &WallAttrs, at_start: bool) -> Option<&str> {
    if at_start {
        a.wall_at_start.as_deref()
    } else {
        a.wall_at_end.as_deref()
    }
}

/// Distance from point `p` to the axis segment of wall `w`.
fn segment_distance(w: &WallAttrs, p: P) -> f32 {
    let t = param(w, p).clamp(0.0, 1.0);
    dist(
        p,
        [
            w.x_start + (w.x_end - w.x_start) * t,
            w.y_start + (w.y_end - w.y_start) * t,
        ],
    )
}

/// Joins three or more walls: each wall not yet joined to another of them is joined to the
/// nearest of them, without breaking joins that already exist between them (e.g. a third wall
/// added to two joined walls). One undo step for all.
fn join_several(home: &mut Home, ids: &[String]) -> crate::registry::CommandResult {
    let indices = ids
        .iter()
        .map(|id| index_of(home, id))
        .collect::<Result<Vec<_>, _>>()?;
    let linked = |home: &Home, i: usize| {
        let a = &home.walls[i].attrs;
        [true, false]
            .into_iter()
            .any(|s| joined_at(a, s).is_some_and(|j| ids.iter().any(|id| id == j)))
    };
    let mut results = Vec::new();
    let mut last_error = None;
    for &i in &indices {
        if linked(home, i) {
            continue;
        }
        // The other walls, nearest first (distance between the axes at the ends of wall i)
        let a = &home.walls[i].attrs;
        let mut others: Vec<(f32, usize)> = indices
            .iter()
            .filter(|&&j| j != i)
            .map(|&j| {
                let b = &home.walls[j].attrs;
                let d = segment_distance(b, start(a))
                    .min(segment_distance(b, end(a)))
                    .min(segment_distance(a, start(b)))
                    .min(segment_distance(a, end(b)));
                (d, j)
            })
            .collect();
        others.sort_by(|x, y| x.0.total_cmp(&y.0));
        for (_, j) in others {
            let join = match plan_join(home, i, j) {
                Ok(join) => join,
                Err(e) => {
                    last_error = Some(e);
                    continue;
                }
            };
            // An end of the other wall that is joined already keeps its join
            let keeps = match join {
                Join::Corner { b_start, .. } => joined_at(&home.walls[j].attrs, b_start).is_none(),
                Join::T {
                    moves_a, at_start, ..
                } => moves_a || joined_at(&home.walls[j].attrs, at_start).is_none(),
            };
            if keeps {
                results.push(apply_join(home, i, j, &join));
                break;
            }
        }
    }
    if results.is_empty() {
        return Err(last_error
            .unwrap_or_else(|| CommandError::failed("the selected walls are joined already")));
    }
    Ok(json!({ "joined": results }))
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "wall_set_angle",
        "Sets the angle between a wall and the wall joined at one of its ends (e.g. exactly 90°). \
         The wall rotates around that corner and keeps its length; walls joined at its other end \
         follow. The side of the rotation stays the same.",
        true,
        |doc, p: AngleParams| {
            if !(p.angle_deg > 0.0 && p.angle_deg < 360.0) {
                return Err(CommandError::failed("angle_deg must be between 0 and 360"));
            }
            let home = doc.home_mut();
            let i = index_of(home, &p.id)?;
            let a = home.walls[i].attrs.clone();
            if !is_straight(&a) {
                return Err(CommandError::failed("arc walls cannot be rotated this way"));
            }
            let at_start = p.at == WallEnd::Start;
            let joined_id = if at_start {
                &a.wall_at_start
            } else {
                &a.wall_at_end
            }
            .clone()
            .ok_or_else(|| CommandError::failed("this end of the wall is not joined"))?;
            let other = home.walls[index_of(home, &joined_id)?].attrs.clone();
            let corner = if at_start { start(&a) } else { end(&a) };
            let far = if at_start { end(&a) } else { start(&a) };
            // Far end of the reference wall, seen from the corner
            let other_far = if dist(start(&other), corner) < dist(end(&other), corner) {
                end(&other)
            } else {
                start(&other)
            };
            let len = dist(corner, far);
            let ol = dist(corner, other_far);
            if len < 1e-3 || ol < 1e-3 {
                return Err(CommandError::failed("a wall has no length"));
            }
            let u = [
                (other_far[0] - corner[0]) / ol,
                (other_far[1] - corner[1]) / ol,
            ];
            let v = [(far[0] - corner[0]) / len, (far[1] - corner[1]) / len];
            // Keep the wall on the same side of the reference wall
            let side = if u[0] * v[1] - u[1] * v[0] < 0.0 {
                -1.0
            } else {
                1.0
            };
            let r = side * p.angle_deg.to_radians();
            let nv = [
                u[0] * r.cos() - u[1] * r.sin(),
                u[0] * r.sin() + u[1] * r.cos(),
            ];
            let new_far = round([corner[0] + nv[0] * len, corner[1] + nv[1] * len]);
            set_end(&mut home.walls[i].attrs, !at_start, new_far);
            // The wall joined at the far end follows
            let far_joined = if at_start {
                a.wall_at_end.clone()
            } else {
                a.wall_at_start.clone()
            };
            if let Some(fj) = far_joined
                && let Some(w) = home.walls.iter_mut().find(|w| w.attrs.id == fj)
            {
                super::wall::move_joined_end(
                    &mut w.attrs,
                    &a.id,
                    (far[0], far[1]),
                    (new_far[0], new_far[1]),
                );
            }
            Ok(json!({ "id": a.id, "moved_end": new_far }))
        },
    );
    r.add(
        "wall_join",
        "Connects two walls. Their axes are extended or shortened to their intersection: if it \
         is near an end of both walls, they get a mitered corner; if it lies inside one wall, \
         the other one ends on its axis (T junction). Two collinear walls of the same \
         thickness whose ends meet (e.g. the parts of a split wall) become one wall, the first \
         one; other collinear walls are joined end to end. \
         With more than two walls, each one not yet joined to another of them is joined to the \
         nearest one, keeping the joins between them (e.g. a third wall added to two joined \
         walls).",
        true,
        |doc, p: JoinParams| {
            let home = doc.home_mut();
            if p.ids.len() > 2 {
                return join_several(home, &p.ids);
            }
            let [a_id, b_id] = p.ids.as_slice() else {
                return Err(CommandError::failed(
                    "wall_join needs at least two wall IDs",
                ));
            };
            let (ia, ib) = (index_of(home, a_id)?, index_of(home, b_id)?);
            if let Some(merged) = merge_collinear(home, ia, ib) {
                return Ok(merged);
            }
            let join = plan_join(home, ia, ib)?;
            Ok(apply_join(home, ia, ib, &join))
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
