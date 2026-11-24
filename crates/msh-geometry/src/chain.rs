//! Dimension chains along a wall: where the dimensions of openings, of adjoining walls and of
//! the whole start and end on one face of a straight wall and the walls that continue it.

use crate::{Pt, enclosed_area, point_in_polygon, wall_shapes};
use msh_model::{Home, Piece, PieceKind, Wall};
use serde::{Deserialize, Serialize};

/// A side of a wall, seen from its start to its end.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Left,
    Right,
}

/// What a row of a chain measures, from the wall outwards.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RowKind {
    /// Doors, windows and the wall between them
    Openings,
    /// Adjoining walls and the space between them
    Walls,
    /// The whole length
    Total,
}

/// One row: the places along the face between which it measures, in ascending order.
#[derive(Debug, Clone, PartialEq)]
pub struct ChainRow {
    pub kind: RowKind,
    pub stations: Vec<f64>,
}

/// The rows of a chain on one face. A place `t` on the face lies at `dir * t + normal * face`.
#[derive(Debug, Clone, PartialEq)]
pub struct WallChain {
    /// Direction of the face, so that a text along it reads from the bottom or the right
    pub dir: [f64; 2],
    /// Direction away from the wall
    pub normal: [f64; 2],
    /// Distance of the face from the origin along `normal`
    pub face: f64,
    pub rows: Vec<ChainRow>,
}

impl WallChain {
    /// The point of the plan at a place along the face.
    pub fn point(&self, t: f64) -> [f64; 2] {
        [
            self.dir[0] * t + self.normal[0] * self.face,
            self.dir[1] * t + self.normal[1] * self.face,
        ]
    }

    /// Offset of a dimension line from `dir` at a distance from the face: positive offsets lie
    /// at (-dy, dx) of the measured direction.
    pub fn offset(&self, distance: f64) -> f64 {
        let positive = -self.dir[1] * self.normal[0] + self.dir[0] * self.normal[1];
        if positive > 0.0 { distance } else { -distance }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChainError {
    UnknownWall,
    RoundWall,
    TooShort,
}

impl std::fmt::Display for ChainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            ChainError::UnknownWall => "the wall does not exist",
            ChainError::RoundWall => "a round wall has no dimension chain",
            ChainError::TooShort => "the wall is too short for a dimension chain",
        })
    }
}

impl std::error::Error for ChainError {}

/// Faces that lie on one line up to this distance in cm belong together.
const SAME_FACE: f64 = 1.0;
/// Space in cm up to which a wall continues another one.
const TOUCHING: f64 = 1.5;
/// Places closer than this in cm are one.
const SAME_PLACE: f64 = 0.5;
/// How far beside a face in cm adjoining walls are measured: outside of any miter.
const BESIDE: f64 = 1.0;

fn dot(a: [f64; 2], b: [f64; 2]) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

fn wide(p: Pt) -> [f64; 2] {
    [f64::from(p[0]), f64::from(p[1])]
}

fn ends(w: &Wall) -> ([f64; 2], [f64; 2]) {
    let a = &w.attrs;
    (wide([a.x_start, a.y_start]), wide([a.x_end, a.y_end]))
}

/// Direction of a straight wall from its start to its end, if it has a length.
fn direction(w: &Wall) -> Option<[f64; 2]> {
    let (s, e) = ends(w);
    let len = (e[0] - s[0]).hypot(e[1] - s[1]);
    (len > 1.0 && !is_round(w)).then(|| [(e[0] - s[0]) / len, (e[1] - s[1]) / len])
}

fn is_round(w: &Wall) -> bool {
    w.attrs.arc_extent.is_some_and(|e| e.abs() > 1e-4)
}

/// The side of a straight wall that does not look into a room or an area closed by walls, for a
/// chain around the house; the left side if both or neither do.
pub fn outer_side(home: &Home, wall: &Wall) -> Side {
    let Some(d) = direction(wall) else {
        return Side::Left;
    };
    let (s, e) = ends(wall);
    let level = wall.attrs.level.as_deref();
    let inside = |normal: [f64; 2]| {
        let reach = f64::from(wall.attrs.thickness) / 2.0 + 10.0;
        [0.25, 0.5, 0.75]
            .iter()
            .filter(|f| {
                let p = [
                    (s[0] + (e[0] - s[0]) * **f + normal[0] * reach) as f32,
                    (s[1] + (e[1] - s[1]) * **f + normal[1] * reach) as f32,
                ];
                home.rooms
                    .iter()
                    .filter(|r| r.attrs.level.as_deref() == level)
                    .any(|r| {
                        let points: Vec<Pt> = r.points.iter().map(|q| [q.x, q.y]).collect();
                        r.attrs.ceiling_visible != Some(false) && point_in_polygon(p, &points)
                    })
                    || enclosed_area(home, level, p).is_some()
            })
            .count()
    };
    let left = inside([d[1], -d[0]]);
    let right = inside([-d[1], d[0]]);
    if right < left {
        Side::Right
    } else {
        Side::Left
    }
}

/// Where a line at `at` along `normal` runs through a polygon: from and to along `dir`.
fn crossing(polygon: &[[f64; 2]], dir: [f64; 2], normal: [f64; 2], at: f64) -> Option<(f64, f64)> {
    let n = polygon.len();
    let mut found: Option<(f64, f64)> = None;
    for i in 0..n {
        let (a, b) = (polygon[i], polygon[(i + 1) % n]);
        let (da, db) = (dot(a, normal) - at, dot(b, normal) - at);
        if (da > 0.0) == (db > 0.0) {
            continue;
        }
        let f = da / (da - db);
        let t = dot(a, dir) + (dot(b, dir) - dot(a, dir)) * f;
        found = Some(found.map_or((t, t), |(lo, hi)| (lo.min(t), hi.max(t))));
    }
    found.filter(|(lo, hi)| hi - lo > 0.01)
}

/// The opening a door or window cuts along `dir`: from and to.
fn opening(p: &Piece, dir: [f64; 2]) -> (f64, f64) {
    let a = &p.attrs;
    let width = f64::from(a.width);
    let left = width * f64::from(a.wall_left.unwrap_or(0.0));
    let cut = width * f64::from(a.wall_width.unwrap_or(1.0));
    let (mut from, mut to) = (left - width / 2.0, left + cut - width / 2.0);
    if a.model_mirrored == Some(true) {
        (from, to) = (-to, -from);
    }
    let (sin, cos) = f64::from(a.angle.unwrap_or(0.0)).sin_cos();
    if dot([cos, sin], dir) < 0.0 {
        (from, to) = (-to, -from);
    }
    let middle = dot(wide([a.x, a.y]), dir);
    (middle + from, middle + to)
}

/// The chain on a side of a straight wall, together with the walls of its level that continue
/// this face. Rows that measure nothing but the whole are left out, except the whole itself.
pub fn wall_chain(home: &Home, wall_id: &str, side: Side) -> Result<WallChain, ChainError> {
    let wall = home
        .walls
        .iter()
        .find(|w| w.attrs.id == wall_id)
        .ok_or(ChainError::UnknownWall)?;
    if is_round(wall) {
        return Err(ChainError::RoundWall);
    }
    let along = direction(wall).ok_or(ChainError::TooShort)?;
    let normal = match side {
        Side::Left => [along[1], -along[0]],
        Side::Right => [-along[1], along[0]],
    };
    // Read from the bottom or the right of the plan
    let dir = if along[0] > 1e-6 || (along[0].abs() <= 1e-6 && along[1] < 0.0) {
        along
    } else {
        [-along[0], -along[1]]
    };
    let face_of = |w: &Wall| dot(ends(w).0, normal) + f64::from(w.attrs.thickness) / 2.0;
    let range_of = |w: &Wall| {
        let (s, e) = ends(w);
        let (a, b) = (dot(s, dir), dot(e, dir));
        (a.min(b), a.max(b))
    };
    let face = face_of(wall);
    let on_level = |w: &&Wall| w.attrs.level == wall.attrs.level;
    let parallel =
        |w: &Wall| direction(w).is_some_and(|d| (d[0] * dir[1] - d[1] * dir[0]).abs() < 0.005);

    // The walls that continue the face without a space
    let mut group: Vec<&Wall> = vec![wall];
    loop {
        let (lo, hi) = group
            .iter()
            .map(|w| range_of(w))
            .fold((f64::MAX, f64::MIN), |(lo, hi), (a, b)| {
                (lo.min(a), hi.max(b))
            });
        let next = home.walls.iter().filter(on_level).find(|w| {
            let (a, b) = range_of(w);
            !group.iter().any(|g| g.attrs.id == w.attrs.id)
                && parallel(w)
                && (face_of(w) - face).abs() < SAME_FACE
                && a < hi + TOUCHING
                && b > lo - TOUCHING
        });
        match next {
            Some(w) => group.push(w),
            None => break,
        }
    }

    // The other walls that are not parallel, as polygons
    let shapes = wall_shapes(home);
    let in_group = |id: &str| group.iter().any(|g| g.attrs.id == id);
    let others: Vec<(&Wall, Vec<[f64; 2]>)> = home
        .walls
        .iter()
        .zip(&shapes)
        .filter(|(w, _)| on_level(w) && !in_group(&w.attrs.id) && !parallel(w))
        .map(|(w, s)| (w, s.polygon().into_iter().map(wide).collect()))
        .collect();

    // Corners of walls joined to the group: where the face ends in their miter
    let mut corners: Vec<f64> = Vec::new();
    let mut joined: Vec<&str> = Vec::new();
    for w in &group {
        let (Some(d), Some(shape)) = (direction(w), shapes.iter().find(|s| s.id == w.attrs.id))
        else {
            continue;
        };
        // Which of its sides is the face of the chain
        let points = if dot([d[1], -d[0]], normal) > 0.0 {
            &shape.left
        } else {
            &shape.right
        };
        for (other, point) in [
            (&w.attrs.wall_at_start, points.first()),
            (&w.attrs.wall_at_end, points.last()),
        ] {
            if let (Some(id), Some(p)) = (other, point)
                && others.iter().any(|(o, _)| &o.attrs.id == id)
            {
                corners.push(dot(wide(*p), dir));
                joined.push(id);
            }
        }
    }

    // The ends: at a wall that goes on beyond the face the near face of that wall, at a corner
    // its far face, else the end of the wall
    let (axis_lo, axis_hi) = group
        .iter()
        .map(|w| range_of(w))
        .fold((f64::MAX, f64::MIN), |(lo, hi), (a, b)| {
            (lo.min(a), hi.max(b))
        });
    let (mut lo, mut hi) = (axis_lo, axis_hi);
    let (mut lo_near, mut hi_near): (Option<f64>, Option<f64>) = (None, None);
    let holds = |(a, b): (f64, f64), end: f64| a <= end + TOUCHING && b >= end - TOUCHING;
    for (_, polygon) in &others {
        // Beside the face, where no miter cuts into the other wall
        if let Some(cut) = crossing(polygon, dir, normal, face + BESIDE) {
            if holds(cut, axis_hi) {
                hi_near = Some(hi_near.map_or(cut.0, |v| v.min(cut.0)));
            }
            if holds(cut, axis_lo) {
                lo_near = Some(lo_near.map_or(cut.1, |v| v.max(cut.1)));
            }
            continue;
        }
        for w in &group {
            let (from, to) = range_of(w);
            let t = f64::from(w.attrs.thickness);
            for line in [face - t / 2.0 - 0.5, face - t - BESIDE] {
                let Some(cut) = crossing(polygon, dir, normal, line) else {
                    continue;
                };
                if to >= axis_hi && holds(cut, axis_hi) {
                    hi = hi.max(cut.1);
                }
                if from <= axis_lo && holds(cut, axis_lo) {
                    lo = lo.min(cut.0);
                }
            }
        }
    }
    lo = lo_near.unwrap_or(lo);
    hi = hi_near.unwrap_or(hi);
    // The miter of a joined wall says it exactly, also at a slanted corner
    let middle = (axis_lo + axis_hi) / 2.0;
    for corner in corners {
        if corner < middle {
            lo = corner;
        } else {
            hi = corner;
        }
    }
    if hi - lo < 1.0 {
        return Err(ChainError::TooShort);
    }

    let row = |kind: RowKind, places: Vec<f64>| {
        let mut stations = vec![lo];
        let mut inner: Vec<f64> = places
            .into_iter()
            .filter(|t| *t > lo + SAME_PLACE && *t < hi - SAME_PLACE)
            .collect();
        inner.sort_by(f64::total_cmp);
        for t in inner {
            if stations.last().is_none_or(|l| t - l > SAME_PLACE) {
                stations.push(t);
            }
        }
        stations.push(hi);
        ChainRow { kind, stations }
    };

    // Doors and windows in the walls of the group
    let mut edges: Vec<f64> = Vec::new();
    home.for_each_piece(|p| {
        let a = &p.attrs;
        if p.kind != PieceKind::DoorOrWindow
            || a.level != wall.attrs.level
            || a.visible == Some(false)
        {
            return;
        }
        let (sin, cos) = f64::from(a.angle.unwrap_or(0.0)).sin_cos();
        if (cos * dir[1] - sin * dir[0]).abs() > 0.1 {
            return;
        }
        let at = wide([a.x, a.y]);
        let in_wall = group.iter().any(|w| {
            let (from, to) = range_of(w);
            let half = f64::from(w.attrs.thickness) / 2.0;
            let t = dot(at, dir);
            t > from && t < to && (dot(at, normal) - dot(ends(w).0, normal)).abs() < half + 5.0
        });
        if in_wall {
            let (from, to) = opening(p, dir);
            edges.extend([from, to]);
        }
    });

    // Both faces of the walls that adjoin on either side
    let mut faces: Vec<f64> = Vec::new();
    for w in &group {
        let (from, to) = range_of(w);
        let back = face - f64::from(w.attrs.thickness);
        for (other, polygon) in &others {
            // At a slanted corner the faces of the other wall do not lie on this face
            let slanted = direction(other).is_none_or(|d| dot(d, dir).abs() > 0.1);
            if slanted && joined.contains(&other.attrs.id.as_str()) {
                continue;
            }
            for line in [face + BESIDE, back - BESIDE] {
                if let Some((a, b)) = crossing(polygon, dir, normal, line)
                    && a < to + TOUCHING
                    && b > from - TOUCHING
                {
                    faces.extend([a, b]);
                }
            }
        }
    }

    let total = row(RowKind::Total, Vec::new());
    let mut rows: Vec<ChainRow> = [row(RowKind::Openings, edges), row(RowKind::Walls, faces)]
        .into_iter()
        .filter(|r| r.stations.len() > 2)
        .collect();
    rows.push(total);
    Ok(WallChain {
        dir,
        normal,
        face,
        rows,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use msh_model::{Furniture, PieceAttrs, WallAttrs};

    fn wall(id: &str, from: [f32; 2], to: [f32; 2], thickness: f32) -> Wall {
        Wall {
            attrs: WallAttrs {
                id: id.into(),
                x_start: from[0],
                y_start: from[1],
                x_end: to[0],
                y_end: to[1],
                thickness,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn join(walls: &mut [Wall]) {
        let n = walls.len();
        for i in 0..n {
            walls[i].attrs.wall_at_end = Some(walls[(i + 1) % n].attrs.id.clone());
            walls[i].attrs.wall_at_start = Some(walls[(i + n - 1) % n].attrs.id.clone());
        }
    }

    /// A house of 1000 × 800 cm (axes) with walls of 30 cm, an inner wall of 10 cm from the
    /// bottom wall up at x = 400, and a window of 120 cm in the bottom wall at x = 700.
    fn house(joined: bool) -> Home {
        let mut walls = vec![
            wall("top", [0.0, 0.0], [1000.0, 0.0], 30.0),
            wall("right", [1000.0, 0.0], [1000.0, 800.0], 30.0),
            wall("bottom", [1000.0, 800.0], [0.0, 800.0], 30.0),
            wall("left", [0.0, 800.0], [0.0, 0.0], 30.0),
        ];
        if joined {
            join(&mut walls);
        }
        walls.push(wall("inner", [400.0, 800.0], [400.0, 0.0], 10.0));
        Home {
            walls,
            furniture: vec![Furniture::Piece(Box::new(Piece {
                kind: PieceKind::DoorOrWindow,
                attrs: PieceAttrs {
                    id: Some("window".into()),
                    x: 700.0,
                    y: 800.0,
                    width: 120.0,
                    depth: 30.0,
                    ..Default::default()
                },
                ..Default::default()
            }))],
            ..Default::default()
        }
    }

    fn stations(chain: &WallChain, kind: RowKind) -> Vec<f64> {
        chain
            .rows
            .iter()
            .find(|r| r.kind == kind)
            .map(|r| {
                r.stations
                    .iter()
                    .map(|t| (t * 10.0).round() / 10.0)
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn outside_chain_measures_openings_walls_and_the_whole() {
        for joined in [true, false] {
            let home = house(joined);
            let bottom = &home.walls[2];
            let side = outer_side(&home, bottom);
            // Drawn from right to left: the outside (down) is on its left
            assert_eq!(side, Side::Left);
            let chain = wall_chain(&home, "bottom", side).unwrap();
            // Reads from left to right although the wall runs from right to left
            assert_eq!(chain.dir, [1.0, 0.0]);
            assert!((chain.face - 815.0).abs() < 1e-3);
            assert_eq!(
                stations(&chain, RowKind::Openings),
                [-15.0, 640.0, 760.0, 1015.0],
                "joined {joined}"
            );
            assert_eq!(
                stations(&chain, RowKind::Walls),
                [-15.0, 15.0, 395.0, 405.0, 985.0, 1015.0]
            );
            assert_eq!(stations(&chain, RowKind::Total), [-15.0, 1015.0]);
            assert_eq!(chain.point(0.0), [0.0, 815.0]);
            // Below a line from left to right: positive offsets point down
            assert_eq!(chain.offset(60.0), 60.0);
        }
    }

    #[test]
    fn inside_chain_ends_at_the_inner_faces() {
        for joined in [true, false] {
            let chain = wall_chain(&house(joined), "bottom", Side::Right).unwrap();
            assert_eq!(
                stations(&chain, RowKind::Total),
                [15.0, 985.0],
                "joined {joined}"
            );
            assert_eq!(
                stations(&chain, RowKind::Walls),
                [15.0, 395.0, 405.0, 985.0]
            );
            assert_eq!(chain.offset(60.0), -60.0);
        }
    }

    #[test]
    fn vertical_chains_read_from_the_right() {
        let home = house(true);
        let chain = wall_chain(&home, "right", outer_side(&home, &home.walls[1])).unwrap();
        assert_eq!(chain.dir, [0.0, -1.0]);
        assert_eq!(chain.normal, [1.0, 0.0]);
        // Only the whole and the thickness of the two outer walls
        assert_eq!(chain.rows.len(), 2);
        assert_eq!(stations(&chain, RowKind::Total), [-815.0, 15.0]);
        assert_eq!(chain.point(-815.0), [1015.0, 815.0]);
    }

    #[test]
    fn walls_that_continue_the_face_belong_to_the_chain() {
        let mut home = house(false);
        // The bottom wall in two parts of different thickness, flush outside
        home.walls[2] = wall("bottom", [500.0, 800.0], [0.0, 800.0], 30.0);
        home.walls
            .push(wall("thin", [1000.0, 805.0], [500.0, 805.0], 20.0));
        let chain = wall_chain(&home, "bottom", Side::Left).unwrap();
        assert_eq!(stations(&chain, RowKind::Total), [-15.0, 1015.0]);
        // On the inside their faces are 10 cm apart: the chain stays on one part
        let inner = wall_chain(&home, "bottom", Side::Right).unwrap();
        assert_eq!(stations(&inner, RowKind::Total), [15.0, 500.0]);
    }

    #[test]
    fn slanted_corners_end_in_their_miter() {
        // A wall of 400 cm from left to right with a wall at 45° going on downwards at its end
        let mut walls = vec![
            wall("level", [0.0, 0.0], [400.0, 0.0], 20.0),
            wall("slanted", [400.0, 0.0], [600.0, 200.0], 20.0),
        ];
        walls[0].attrs.wall_at_end = Some("slanted".into());
        walls[1].attrs.wall_at_start = Some("level".into());
        let home = Home {
            walls,
            ..Default::default()
        };
        // The miter at half the angle: 10 cm × tan(22.5°) further outside, less inside
        let above = wall_chain(&home, "level", Side::Left).unwrap();
        assert_eq!(stations(&above, RowKind::Total), [0.0, 404.1]);
        assert_eq!(above.rows.len(), 1);
        let below = wall_chain(&home, "level", Side::Right).unwrap();
        assert_eq!(stations(&below, RowKind::Total), [0.0, 395.9]);
        assert_eq!(below.rows.len(), 1);
    }

    #[test]
    fn mirrored_cuts_and_other_levels() {
        let mut home = house(true);
        if let Furniture::Piece(p) = &mut home.furniture[0] {
            // The opening takes only the left three quarters of the piece
            p.attrs.wall_left = Some(0.0);
            p.attrs.wall_width = Some(0.75);
            p.attrs.model_mirrored = Some(true);
        }
        let chain = wall_chain(&home, "bottom", Side::Left).unwrap();
        assert_eq!(
            stations(&chain, RowKind::Openings),
            [-15.0, 670.0, 760.0, 1015.0]
        );
        if let Furniture::Piece(p) = &mut home.furniture[0] {
            p.attrs.level = Some("upper".into());
        }
        let chain = wall_chain(&home, "bottom", Side::Left).unwrap();
        assert!(stations(&chain, RowKind::Openings).is_empty());
    }

    #[test]
    fn refuses_round_and_unknown_walls() {
        let mut home = house(true);
        assert_eq!(
            wall_chain(&home, "nope", Side::Left).unwrap_err(),
            ChainError::UnknownWall
        );
        home.walls[0].attrs.arc_extent = Some(1.0);
        assert_eq!(
            wall_chain(&home, "top", Side::Left).unwrap_err(),
            ChainError::RoundWall
        );
    }
}
