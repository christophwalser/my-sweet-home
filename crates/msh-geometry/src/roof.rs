//! Roofs over a convex outline.
//!
//! Every eave of the outline carries a plane that rises inwards with the pitch of the roof;
//! the roof is the lowest of these planes at each point. A gable edge carries none: the roof
//! ends there with a vertical face. This gives gable, hip and shed roofs and their mixtures
//! for any convex outline. The roof covers the outline moved outwards by the overhang.

use serde::{Deserialize, Serialize};

/// A point of the plan in cm.
pub type P2 = [f64; 2];

/// What the roof does at an edge of its outline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    /// The roof rises from this edge
    Eave,
    /// The roof ends here with a vertical face
    Gable,
}

/// A roof shape that says the kind of every edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoofShape {
    /// Two surfaces that meet at a ridge along the longer side
    Gable,
    /// A surface at every edge
    Hip,
    /// One surface, low at one edge
    Shed,
    /// A level slab
    Flat,
    /// The kind of every edge is given
    Custom,
}

/// What a roof is made from.
#[derive(Debug, Clone)]
pub struct RoofSpec {
    /// Corners of the covered area (the outer face of the walls); must be convex
    pub outline: Vec<P2>,
    /// Kind of the edge from corner `i` to corner `i + 1` (missing ones are eaves)
    pub edges: Vec<EdgeKind>,
    /// Pitch of the surfaces in radians; 0 gives a flat roof
    pub pitch: f64,
    /// How far the roof reaches beyond the outline
    pub overhang: f64,
    /// Thickness of the roof, measured across its surface
    pub thickness: f64,
}

/// Part of the roof a triangle belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    /// The covering on top
    Cover,
    /// The underside and the faces around the edge
    Soffit,
    /// The wall under a gable edge, between the top of the walls and the roof
    Gable,
}

/// Kind of a line of the roof seen from above.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineKind {
    Eave,
    Verge,
    Ridge,
    Hip,
}

/// A line of the roof seen from above.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RoofLine {
    pub a: P2,
    pub b: P2,
    pub kind: LineKind,
}

/// A triangle of the roof; its corners run counter-clockwise seen against `normal`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Triangle {
    pub corners: [u32; 3],
    pub normal: [f64; 3],
    pub surface: Surface,
}

/// A roof as triangles and as lines for the plan.
#[derive(Debug, Clone, Default)]
pub struct RoofMesh {
    /// Corners as x, height above the top of the walls, y of the plan
    pub positions: Vec<[f64; 3]>,
    /// Where each corner lies on its surface, in cm, for a texture: on the covering along
    /// the eave and up the slope (so that rows of tiles run along the eave), on a gable wall
    /// along the wall and up. Seen from outside, the first value grows to the right
    pub uvs: Vec<[f64; 2]>,
    pub triangles: Vec<Triangle>,
    pub lines: Vec<RoofLine>,
}

impl RoofMesh {
    /// Lowest and highest corner of the box around the roof.
    pub fn bounds(&self) -> ([f64; 3], [f64; 3]) {
        let (mut lo, mut hi) = ([f64::MAX; 3], [f64::MIN; 3]);
        for p in &self.positions {
            for i in 0..3 {
                lo[i] = lo[i].min(p[i]);
                hi[i] = hi[i].max(p[i]);
            }
        }
        (lo, hi)
    }
}

/// Why an outline cannot carry a roof.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoofError {
    TooFewCorners,
    NotConvex,
}

impl std::fmt::Display for RoofError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            RoofError::TooFewCorners => "a roof needs at least three corners that span an area",
            RoofError::NotConvex => {
                "the outline of a roof must not have corners that point inwards; cover such a \
                 house with several roofs"
            }
        })
    }
}

impl std::error::Error for RoofError {}

/// Steepest pitch of a roof.
pub const MAX_PITCH: f64 = 80.0 * std::f64::consts::PI / 180.0;

const EPS: f64 = 1e-7;

/// Where an edge of a clipped polygon comes from.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Tag {
    /// The edge of the outline with this number, moved outwards by the overhang
    Outline(usize),
    /// The line where the roof surface meets the surface of this eave
    Shared(usize),
    /// A helper edge
    None,
}

/// A convex polygon; `tags[k]` belongs to the edge from `pts[k]` to the next point.
#[derive(Debug, Clone, Default)]
struct Poly {
    pts: Vec<P2>,
    tags: Vec<Tag>,
}

impl Poly {
    fn push(&mut self, p: P2, tag: Tag) {
        self.pts.push(p);
        self.tags.push(tag);
    }

    /// The part of the polygon where `f` is not negative; the new edge gets `tag`.
    fn clip(&self, f: impl Fn(P2) -> f64, tag: Tag) -> Poly {
        let n = self.pts.len();
        let mut out = Poly::default();
        for k in 0..n {
            let (p, q) = (self.pts[k], self.pts[(k + 1) % n]);
            let (fp, fq) = (f(p), f(q));
            let (p_in, q_in) = (fp >= -EPS, fq >= -EPS);
            if p_in {
                out.push(p, self.tags[k]);
            }
            if p_in != q_in {
                let t = (fp / (fp - fq)).clamp(0.0, 1.0);
                let x = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
                // Leaving: the next edge runs along the cut. Entering: the rest of this edge
                out.push(x, if p_in { tag } else { self.tags[k] });
            }
        }
        out.cleaned()
    }

    /// Without edges of no length; empty if no area is left.
    fn cleaned(mut self) -> Poly {
        loop {
            let n = self.pts.len();
            if n < 3 {
                return Poly::default();
            }
            let Some(k) = (0..n).find(|&k| {
                let (p, q) = (self.pts[k], self.pts[(k + 1) % n]);
                (p[0] - q[0]).hypot(p[1] - q[1]) < 1e-6
            }) else {
                return self;
            };
            self.pts.remove(k);
            self.tags.remove(k);
        }
    }
}

fn area(pts: &[P2]) -> f64 {
    let n = pts.len();
    (0..n)
        .map(|i| {
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            a[0] * b[1] - b[0] * a[1]
        })
        .sum::<f64>()
        / 2.0
}

/// How sharply the outline turns at corner `i`: the sine of the angle between its edges
/// (positive to the left).
fn turn(pts: &[P2], i: usize) -> f64 {
    let n = pts.len();
    let (a, b, c) = (pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n]);
    let (e1, e2) = ([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]);
    let len = e1[0].hypot(e1[1]) * e2[0].hypot(e2[1]);
    if len < 1e-12 {
        0.0
    } else {
        (e1[0] * e2[1] - e1[1] * e2[0]) / len
    }
}

/// The outline running counter-clockwise, without doubled corners and without corners on a
/// straight line, with the kind of each of its edges.
fn normalized(outline: &[P2], edges: &[EdgeKind]) -> Result<(Vec<P2>, Vec<EdgeKind>), RoofError> {
    let mut pts: Vec<P2> = Vec::new();
    let mut kinds: Vec<EdgeKind> = Vec::new();
    for (i, p) in outline.iter().enumerate() {
        if !(p[0].is_finite() && p[1].is_finite()) {
            return Err(RoofError::TooFewCorners);
        }
        let same = |q: &P2| (p[0] - q[0]).hypot(p[1] - q[1]) < 1e-6;
        if pts.last().is_some_and(same) {
            continue;
        }
        pts.push(*p);
        kinds.push(edges.get(i).copied().unwrap_or(EdgeKind::Eave));
    }
    if pts.len() > 1 {
        let first = pts[0];
        let last = pts[pts.len() - 1];
        if (first[0] - last[0]).hypot(first[1] - last[1]) < 1e-6 {
            pts.pop();
            kinds.pop();
        }
    }
    if pts.len() < 3 {
        return Err(RoofError::TooFewCorners);
    }
    if area(&pts) < 0.0 {
        let n = pts.len();
        pts.reverse();
        // The edge from the new corner j runs along the old edge n − 2 − j
        kinds = (0..n).map(|j| kinds[(2 * n - 2 - j) % n]).collect();
    }
    // A corner on a straight line joins its two edges; the first one says the kind
    while pts.len() >= 3 {
        let Some(i) = (0..pts.len()).find(|&i| turn(&pts, i).abs() < 1e-6) else {
            break;
        };
        pts.remove(i);
        kinds.remove(i);
    }
    if pts.len() < 3 || area(&pts) < 1e-6 {
        return Err(RoofError::TooFewCorners);
    }
    if (0..pts.len()).any(|i| turn(&pts, i) < 0.0) {
        return Err(RoofError::NotConvex);
    }
    Ok((pts, kinds))
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

impl RoofMesh {
    /// Adds a flat convex polygon as a fan of triangles that face `towards`. `uv` gives
    /// where a corner lies on the surface.
    fn fan(
        &mut self,
        corners: &[[f64; 3]],
        uv: impl Fn([f64; 3]) -> [f64; 2],
        towards: [f64; 3],
        surface: Surface,
    ) {
        if corners.len() < 3 {
            return;
        }
        let base = self.positions.len() as u32;
        self.positions.extend_from_slice(corners);
        self.uvs.extend(corners.iter().map(|c| uv(*c)));
        for k in 1..corners.len() - 1 {
            let normal = cross(sub(corners[k], corners[0]), sub(corners[k + 1], corners[0]));
            let len = dot(normal, normal).sqrt();
            if len < 1e-9 {
                continue;
            }
            let (k0, k1) = (base + k as u32, base + k as u32 + 1);
            let flip = dot(normal, towards) < 0.0;
            let sign = if flip { -1.0 } else { 1.0 };
            self.triangles.push(Triangle {
                corners: if flip { [base, k1, k0] } else { [base, k0, k1] },
                normal: normal.map(|v| sign * v / len),
                surface,
            });
        }
    }
}

/// The roof over the outline of `spec`, with the top of the walls at height 0.
///
/// A sloped roof passes through the outline with its upper surface, so that the walls end
/// inside the roof. A flat roof lies on the walls.
pub fn roof(spec: &RoofSpec) -> Result<RoofMesh, RoofError> {
    let (outline, kinds) = normalized(&spec.outline, &spec.edges)?;
    let n = outline.len();
    let pitch = if spec.pitch.is_finite() {
        spec.pitch.clamp(0.0, MAX_PITCH)
    } else {
        0.0
    };
    let slope = pitch.tan();
    let overhang = spec.overhang.max(0.0);
    let thickness = spec.thickness.max(0.1);

    // Inward normal of each edge of the counter-clockwise outline
    let normals: Vec<P2> = (0..n)
        .map(|i| {
            let (a, b) = (outline[i], outline[(i + 1) % n]);
            let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
            let len = dx.hypot(dy);
            [-dy / len, dx / len]
        })
        .collect();
    let dist = |i: usize, p: P2| {
        normals[i][0] * (p[0] - outline[i][0]) + normals[i][1] * (p[1] - outline[i][1])
    };
    let eaves: Vec<usize> = if slope > 1e-6 {
        (0..n).filter(|&i| kinds[i] == EdgeKind::Eave).collect()
    } else {
        Vec::new()
    };
    let flat = eaves.is_empty();
    // Height of the upper surface where it crosses the outline, and how far the underside
    // lies below the upper surface
    let (lift, drop) = if flat {
        (thickness, thickness)
    } else {
        (0.0, thickness / pitch.cos())
    };

    // What the roof covers: the outline with every edge moved outwards by the overhang
    let (mut lo, mut hi) = ([f64::MAX; 2], [f64::MIN; 2]);
    for p in &outline {
        for i in 0..2 {
            lo[i] = lo[i].min(p[i]);
            hi[i] = hi[i].max(p[i]);
        }
    }
    let far = (hi[0] - lo[0]).max(hi[1] - lo[1]) * 4.0 + overhang * 4.0 + 100.0;
    let mut footprint = Poly {
        pts: vec![
            [lo[0] - far, lo[1] - far],
            [hi[0] + far, lo[1] - far],
            [hi[0] + far, hi[1] + far],
            [lo[0] - far, hi[1] + far],
        ],
        tags: vec![Tag::None; 4],
    };
    for i in 0..n {
        footprint = footprint.clip(|p| dist(i, p) + overhang, Tag::Outline(i));
    }

    // The surface of an eave: where its plane is the lowest one
    let faces: Vec<(Option<usize>, Poly)> = if flat {
        vec![(None, footprint)]
    } else {
        eaves
            .iter()
            .map(|&i| {
                let mut poly = footprint.clone();
                for &j in &eaves {
                    if j != i {
                        poly = poly.clip(|p| dist(j, p) - dist(i, p), Tag::Shared(j));
                    }
                }
                (Some(i), poly)
            })
            .filter(|(_, poly)| !poly.pts.is_empty())
            .collect()
    };
    let top = |face: Option<usize>, p: P2| face.map_or(0.0, |i| slope * dist(i, p)) + lift;

    let no_uv = |_: [f64; 3]| [0.0, 0.0];
    let mut mesh = RoofMesh::default();
    for (face, poly) in &faces {
        let upper: Vec<[f64; 3]> = poly
            .pts
            .iter()
            .map(|p| [p[0], top(*face, *p), p[1]])
            .collect();
        let lower: Vec<[f64; 3]> = upper.iter().map(|p| [p[0], p[1] - drop, p[2]]).collect();
        // On the covering: along the eave (to the right seen from above the eave) and up
        // the slope; on a flat roof along the plan
        let on_cover = |c: [f64; 3]| match face {
            Some(i) => {
                let n = normals[*i];
                let along = (c[0] - outline[*i][0]) * n[1] - (c[2] - outline[*i][1]) * n[0];
                [-along, dist(*i, [c[0], c[2]]) / pitch.cos()]
            }
            None => [c[0], -c[2]],
        };
        mesh.fan(&upper, on_cover, [0.0, 1.0, 0.0], Surface::Cover);
        mesh.fan(&lower, no_uv, [0.0, -1.0, 0.0], Surface::Soffit);
        let m = poly.pts.len();
        for k in 0..m {
            let next = (k + 1) % m;
            let (a, b) = (poly.pts[k], poly.pts[next]);
            match poly.tags[k] {
                Tag::Outline(edge) => {
                    // The face around the edge of the roof
                    let out = [-normals[edge][0], 0.0, -normals[edge][1]];
                    mesh.fan(
                        &[upper[k], upper[next], lower[next], lower[k]],
                        no_uv,
                        out,
                        Surface::Soffit,
                    );
                    let kind = if flat || kinds[edge] == EdgeKind::Eave {
                        LineKind::Eave
                    } else {
                        LineKind::Verge
                    };
                    mesh.lines.push(RoofLine { a, b, kind });
                }
                // Each line between two surfaces once
                Tag::Shared(other) if face.is_some_and(|i| i < other) => {
                    let level = (upper[k][1] - upper[next][1]).abs() < 1e-3;
                    let kind = if level {
                        LineKind::Ridge
                    } else {
                        LineKind::Hip
                    };
                    mesh.lines.push(RoofLine { a, b, kind });
                }
                _ => {}
            }
        }
    }

    // The wall under each gable edge, from the top of the walls up to the underside
    if !flat {
        for edge in (0..n).filter(|&m| kinds[m] == EdgeKind::Gable) {
            let (a, b) = (outline[edge], outline[(edge + 1) % n]);
            let at = |t: f64| [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
            let under = |t: f64| {
                eaves
                    .iter()
                    .map(|&i| slope * dist(i, at(t)))
                    .fold(f64::INFINITY, f64::min)
                    - drop
            };
            // The underside along the edge bends where two surfaces meet
            let mut bends = vec![0.0, 1.0];
            for (x, &i) in eaves.iter().enumerate() {
                for &j in &eaves[x + 1..] {
                    let (i0, i1, j0, j1) = (dist(i, a), dist(i, b), dist(j, a), dist(j, b));
                    let den = (i1 - i0) - (j1 - j0);
                    if den.abs() > 1e-12 {
                        let t = (j0 - i0) / den;
                        if t > 0.0 && t < 1.0 {
                            bends.push(t);
                        }
                    }
                }
            }
            bends.sort_by(f64::total_cmp);
            bends.dedup_by(|x, y| (*x - *y).abs() < 1e-9);
            // In the plane of the wall: along the edge and up
            let mut profile = Poly::default();
            profile.push([0.0, -1.0], Tag::None);
            profile.push([1.0, -1.0], Tag::None);
            for &t in bends.iter().rev() {
                profile.push([t, under(t)], Tag::None);
            }
            let profile = profile.cleaned().clip(|p| p[1], Tag::None);
            let corners: Vec<[f64; 3]> = profile
                .pts
                .iter()
                .map(|&[t, z]| {
                    let p = at(t);
                    [p[0], z, p[1]]
                })
                .collect();
            let out = [-normals[edge][0], 0.0, -normals[edge][1]];
            // Along the wall (to the right seen from outside) and up
            let n = normals[edge];
            let on_wall = |c: [f64; 3]| [-((c[0] - a[0]) * n[1] - (c[2] - a[1]) * n[0]), c[1]];
            mesh.fan(&corners, on_wall, out, Surface::Gable);
            mesh.fan(&corners, on_wall, out.map(|v| -v), Surface::Gable);
        }
    }
    Ok(mesh)
}

/// The kind of every edge of `outline` for a roof shape. `turn` turns the roof to its next
/// position: the ridge of a gable roof by a quarter, the low edge of a shed roof to the
/// next edge.
pub fn shape_edges(outline: &[P2], shape: RoofShape, turn: usize) -> Vec<EdgeKind> {
    let n = outline.len();
    let edge = |i: usize| {
        let (a, b) = (outline[i], outline[(i + 1) % n]);
        [b[0] - a[0], b[1] - a[1]]
    };
    let length = |i: usize| edge(i)[0].hypot(edge(i)[1]);
    let longest = (0..n).fold(0, |best, i| {
        if length(i) > length(best) + 1e-6 {
            i
        } else {
            best
        }
    });
    match shape {
        RoofShape::Gable if n > 0 => {
            let along = edge(longest);
            let len = length(longest).max(1e-9);
            (0..n)
                .map(|i| {
                    let e = edge(i);
                    let cos =
                        ((e[0] * along[0] + e[1] * along[1]) / (len * length(i).max(1e-9))).abs();
                    // Eaves run along the ridge
                    let parallel = cos > std::f64::consts::FRAC_1_SQRT_2;
                    if parallel == turn.is_multiple_of(2) {
                        EdgeKind::Eave
                    } else {
                        EdgeKind::Gable
                    }
                })
                .collect()
        }
        RoofShape::Shed if n > 0 => {
            let low = (longest + turn) % n;
            (0..n)
                .map(|i| {
                    if i == low {
                        EdgeKind::Eave
                    } else {
                        EdgeKind::Gable
                    }
                })
                .collect()
        }
        _ => vec![EdgeKind::Eave; n],
    }
}

/// The largest rectangles inside an outline whose edges all run in two directions at a right
/// angle (an L, T or U shaped house). Together they cover the outline, and each of them can
/// carry a roof of its own. Slanted edges up to the length `max_slant` (a cut inner corner)
/// are allowed; the rectangles keep clear of them. `None` if the outline has other edges or
/// too many corners.
pub fn rectangles(outline: &[P2], max_slant: f64) -> Option<Vec<Vec<P2>>> {
    let n = outline.len();
    if !(4..=40).contains(&n) {
        return None;
    }
    let edge = |i: usize| {
        let (a, b) = (outline[i], outline[(i + 1) % n]);
        [b[0] - a[0], b[1] - a[1]]
    };
    let longest = (0..n).fold(0, |best, i| {
        if edge(i)[0].hypot(edge(i)[1]) > edge(best)[0].hypot(edge(best)[1]) {
            i
        } else {
            best
        }
    });
    let len = edge(longest)[0].hypot(edge(longest)[1]);
    if len < 1e-6 {
        return None;
    }
    // Along the longest edge and across it
    let u = [edge(longest)[0] / len, edge(longest)[1] / len];
    let v = [-u[1], u[0]];
    let local: Vec<P2> = outline
        .iter()
        .map(|p| [p[0] * u[0] + p[1] * u[1], p[0] * v[0] + p[1] * v[1]])
        .collect();
    // The boxes around the slanted edges
    let mut slanted: Vec<(P2, P2)> = Vec::new();
    for i in 0..n {
        let (a, b) = (local[i], local[(i + 1) % n]);
        let (along, across) = (b[0] - a[0], b[1] - a[1]);
        // More than half a degree off both directions
        if along.abs().min(across.abs()) > 0.009 * along.hypot(across) {
            if along.hypot(across) > max_slant {
                return None;
            }
            slanted.push((
                [a[0].min(b[0]), a[1].min(b[1])],
                [a[0].max(b[0]), a[1].max(b[1])],
            ));
        }
    }
    // The lines of the grid the corners lie on (values half a centimeter apart are one line)
    let lines = |axis: usize| {
        let mut values: Vec<f64> = local.iter().map(|p| p[axis]).collect();
        values.sort_by(f64::total_cmp);
        let mut out: Vec<f64> = Vec::new();
        for value in values {
            if out.last().is_none_or(|last| value - last > 0.5) {
                out.push(value);
            }
        }
        out
    };
    let (xs, ys) = (lines(0), lines(1));
    if xs.len() < 2 || ys.len() < 2 {
        return None;
    }
    let inside = |p: P2| {
        let mut inside = false;
        for i in 0..n {
            let (a, b) = (local[i], local[(i + n - 1) % n]);
            if (a[1] > p[1]) != (b[1] > p[1])
                && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
            {
                inside = !inside;
            }
        }
        inside
    };
    let (columns, rows) = (xs.len() - 1, ys.len() - 1);
    let cells: Vec<Vec<bool>> = (0..columns)
        .map(|i| {
            (0..rows)
                .map(|j| {
                    let mid = [(xs[i] + xs[i + 1]) / 2.0, (ys[j] + ys[j + 1]) / 2.0];
                    // A cell a slanted edge runs through is not part of a rectangle
                    let cut = slanted.iter().any(|(lo, hi)| {
                        mid[0] > lo[0] && mid[0] < hi[0] && mid[1] > lo[1] && mid[1] < hi[1]
                    });
                    !cut && inside(mid)
                })
                .collect()
        })
        .collect();
    let filled = |i0: usize, i1: usize, j0: usize, j1: usize| {
        (i0..i1).all(|i| (j0..j1).all(|j| cells[i][j]))
    };
    // All rectangles of cells inside the outline; kept are those no other one contains
    let mut all: Vec<[usize; 4]> = Vec::new();
    for i0 in 0..columns {
        for i1 in i0 + 1..=columns {
            for j0 in 0..rows {
                for j1 in j0 + 1..=rows {
                    if filled(i0, i1, j0, j1) {
                        all.push([i0, i1, j0, j1]);
                    }
                }
            }
        }
    }
    let largest: Vec<[usize; 4]> = all
        .iter()
        .filter(|r| {
            !all.iter()
                .any(|o| o != *r && o[0] <= r[0] && o[1] >= r[1] && o[2] <= r[2] && o[3] >= r[3])
        })
        .copied()
        .collect();
    if largest.is_empty() {
        return None;
    }
    let plan = |x: f64, y: f64| [x * u[0] + y * v[0], x * u[1] + y * v[1]];
    Some(
        largest
            .iter()
            .map(|&[i0, i1, j0, j1]| {
                vec![
                    plan(xs[i0], ys[j0]),
                    plan(xs[i1], ys[j0]),
                    plan(xs[i1], ys[j1]),
                    plan(xs[i0], ys[j1]),
                ]
            })
            .collect(),
    )
}

/// The smallest outline without corners that point inwards around the points, running
/// counter-clockwise.
pub fn convex_hull(points: &[P2]) -> Vec<P2> {
    let mut sorted: Vec<P2> = points
        .iter()
        .copied()
        .filter(|p| p[0].is_finite() && p[1].is_finite())
        .collect();
    sorted.sort_by(|a, b| a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
    sorted.dedup();
    if sorted.len() < 3 {
        return sorted;
    }
    let turn = |o: P2, a: P2, b: P2| (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    let mut hull: Vec<P2> = Vec::new();
    for pass in 0..2 {
        let start = hull.len();
        let ordered: Box<dyn Iterator<Item = &P2>> = if pass == 0 {
            Box::new(sorted.iter())
        } else {
            Box::new(sorted.iter().rev())
        };
        for &p in ordered {
            while hull.len() >= start + 2
                && turn(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 1e-9
            {
                hull.pop();
            }
            hull.push(p);
        }
        // The last point of a pass starts the next one
        hull.pop();
    }
    hull
}

/// How far `p` lies inside the counter-clockwise outline without corners that point inwards
/// (negative outside).
fn depth_inside(p: P2, outline: &[P2]) -> f64 {
    let n = outline.len();
    (0..n)
        .map(|i| {
            let (a, b) = (outline[i], outline[(i + 1) % n]);
            let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
            let len = dx.hypot(dy).max(1e-12);
            (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len
        })
        .fold(f64::INFINITY, f64::min)
}

/// The rectangle around the points whose sides run along and across the longest edge of
/// `hull`, counter-clockwise.
fn bounding_rectangle(hull: &[P2]) -> Vec<P2> {
    let n = hull.len();
    let edge = |i: usize| {
        let (a, b) = (hull[i], hull[(i + 1) % n]);
        [b[0] - a[0], b[1] - a[1]]
    };
    let longest = (0..n).fold(0, |best, i| {
        if edge(i)[0].hypot(edge(i)[1]) > edge(best)[0].hypot(edge(best)[1]) {
            i
        } else {
            best
        }
    });
    let len = edge(longest)[0].hypot(edge(longest)[1]).max(1e-12);
    let u = [edge(longest)[0] / len, edge(longest)[1] / len];
    let v = [-u[1], u[0]];
    let (mut lo, mut hi) = ([f64::MAX; 2], [f64::MIN; 2]);
    for p in hull {
        let q = [p[0] * u[0] + p[1] * u[1], p[0] * v[0] + p[1] * v[1]];
        for i in 0..2 {
            lo[i] = lo[i].min(q[i]);
            hi[i] = hi[i].max(q[i]);
        }
    }
    let plan = |x: f64, y: f64| [x * u[0] + y * v[0], x * u[1] + y * v[1]];
    vec![
        plan(lo[0], lo[1]),
        plan(hi[0], lo[1]),
        plan(hi[0], hi[1]),
        plan(lo[0], hi[1]),
    ]
}

/// Distance of `p` from the area of the outline (0 inside).
fn distance_outside(p: P2, outline: &[P2]) -> f64 {
    let n = outline.len();
    let mut inside = false;
    let mut nearest = f64::INFINITY;
    for i in 0..n {
        let (a, b) = (outline[i], outline[(i + n - 1) % n]);
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            inside = !inside;
        }
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let len2 = dx * dx + dy * dy;
        let t = if len2 > 0.0 {
            (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2).clamp(0.0, 1.0)
        } else {
            0.0
        };
        nearest = nearest.min((p[0] - a[0] - t * dx).hypot(p[1] - a[1] - t * dy));
    }
    if inside { 0.0 } else { nearest }
}

/// The areas that each carry one roof and together cover the outline of a house, as a roof
/// over all its walls needs them:
/// - the rectangle around the outline, if the outline fills it up to `tolerance` (small
///   steps of the walls, a cut corner, a recessed door);
/// - else the outline without its dents, if none of them is deeper than `tolerance`;
/// - else its largest rectangles, if all its edges run in two directions at a right angle
///   (an L, T or U shaped house); rectangles that reach less than `tolerance` out of a
///   larger one are left out;
/// - else the outline without its dents.
pub fn roof_areas(outline: &[P2], tolerance: f64) -> Vec<Vec<P2>> {
    let hull = convex_hull(outline);
    if hull.len() < 3 {
        return Vec::new();
    }
    let deepest = |around: &[P2]| {
        outline
            .iter()
            .map(|p| depth_inside(*p, around))
            .fold(0.0, f64::max)
    };
    let rectangle = bounding_rectangle(&hull);
    let cut_corner = rectangle
        .iter()
        .map(|p| distance_outside(*p, outline))
        .fold(0.0, f64::max);
    if deepest(&rectangle) <= tolerance && cut_corner <= tolerance {
        return vec![rectangle];
    }
    if deepest(&hull) <= tolerance {
        return vec![hull];
    }
    // A cut inner corner may be up to this long
    let Some(mut all) = rectangles(outline, tolerance * 2.5) else {
        return vec![hull];
    };
    for r in &mut all {
        if area(r) < 0.0 {
            r.reverse();
        }
    }
    all.sort_by(|a, b| area(b).total_cmp(&area(a)));
    let mut kept: Vec<Vec<P2>> = Vec::new();
    for r in all {
        let inside_kept = kept
            .iter()
            .any(|k| r.iter().all(|p| depth_inside(*p, k) >= -tolerance));
        if !inside_kept {
            kept.push(r);
        }
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rectangle(width: f64, depth: f64) -> Vec<P2> {
        vec![[0.0, 0.0], [width, 0.0], [width, depth], [0.0, depth]]
    }

    fn spec(outline: Vec<P2>, shape: RoofShape, pitch_deg: f64) -> RoofSpec {
        RoofSpec {
            edges: shape_edges(&outline, shape, 0),
            outline,
            pitch: pitch_deg.to_radians(),
            overhang: 50.0,
            thickness: 20.0,
        }
    }

    fn count(mesh: &RoofMesh, kind: LineKind) -> usize {
        mesh.lines.iter().filter(|l| l.kind == kind).count()
    }

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn gable_roof_has_a_ridge_along_the_longer_side() {
        let mesh = roof(&spec(rectangle(1000.0, 800.0), RoofShape::Gable, 45.0)).unwrap();
        assert_eq!(count(&mesh, LineKind::Ridge), 1);
        assert_eq!(count(&mesh, LineKind::Eave), 2);
        assert_eq!(count(&mesh, LineKind::Verge), 4);
        assert_eq!(count(&mesh, LineKind::Hip), 0);
        let ridge = mesh
            .lines
            .iter()
            .find(|l| l.kind == LineKind::Ridge)
            .unwrap();
        // In the middle of the depth, over the whole width with the overhang
        assert!(near(ridge.a[1], 400.0) && near(ridge.b[1], 400.0));
        assert!(near((ridge.a[0] - ridge.b[0]).abs(), 1100.0));
        let (lo, hi) = mesh.bounds();
        assert!(near(hi[1], 400.0), "ridge height {}", hi[1]);
        // The eave hangs 50 cm lower, and the underside lies 20 cm across the slope below
        assert!(near(lo[1], -50.0 - 20.0 / 45f64.to_radians().cos()));
        assert!(near(lo[0], -50.0) && near(hi[0], 1050.0));
        assert!(near(lo[2], -50.0) && near(hi[2], 850.0));
        // The walls under the two gables reach up to the underside
        let gable_top = mesh
            .triangles
            .iter()
            .filter(|t| t.surface == Surface::Gable)
            .flat_map(|t| t.corners)
            .map(|c| mesh.positions[c as usize][1])
            .fold(f64::MIN, f64::max);
        assert!(near(gable_top, 400.0 - 20.0 / 45f64.to_radians().cos()));
    }

    #[test]
    fn hip_roof_has_a_short_ridge_and_four_hips() {
        let mesh = roof(&spec(rectangle(1000.0, 600.0), RoofShape::Hip, 30.0)).unwrap();
        assert_eq!(count(&mesh, LineKind::Ridge), 1);
        assert_eq!(count(&mesh, LineKind::Hip), 4);
        assert_eq!(count(&mesh, LineKind::Eave), 4);
        assert_eq!(count(&mesh, LineKind::Verge), 0);
        let ridge = mesh
            .lines
            .iter()
            .find(|l| l.kind == LineKind::Ridge)
            .unwrap();
        assert!(near((ridge.a[0] - ridge.b[0]).abs(), 400.0));
        assert!(near(mesh.bounds().1[1], 300.0 * 30f64.to_radians().tan()));
        assert!(!mesh.triangles.iter().any(|t| t.surface == Surface::Gable));
    }

    #[test]
    fn shed_roof_rises_from_one_edge() {
        let mesh = roof(&spec(rectangle(1000.0, 800.0), RoofShape::Shed, 10.0)).unwrap();
        assert_eq!(count(&mesh, LineKind::Eave), 1);
        assert_eq!(count(&mesh, LineKind::Verge), 3);
        assert_eq!(
            count(&mesh, LineKind::Ridge) + count(&mesh, LineKind::Hip),
            0
        );
        // Highest at the far edge of the overhang
        assert!(near(mesh.bounds().1[1], 850.0 * 10f64.to_radians().tan()));
        assert!(mesh.triangles.iter().any(|t| t.surface == Surface::Gable));
    }

    #[test]
    fn flat_roof_lies_on_the_walls() {
        let mesh = roof(&spec(rectangle(1000.0, 800.0), RoofShape::Flat, 0.0)).unwrap();
        let (lo, hi) = mesh.bounds();
        assert!(near(lo[1], 0.0) && near(hi[1], 20.0));
        assert_eq!(mesh.lines.len(), 4);
        assert!(!mesh.triangles.iter().any(|t| t.surface == Surface::Gable));
    }

    #[test]
    fn triangles_run_counter_clockwise_around_their_normal() {
        for shape in [RoofShape::Gable, RoofShape::Hip, RoofShape::Shed] {
            let mesh = roof(&spec(rectangle(900.0, 700.0), shape, 35.0)).unwrap();
            assert!(!mesh.triangles.is_empty());
            for t in &mesh.triangles {
                let [a, b, c] = t.corners.map(|i| mesh.positions[i as usize]);
                let n = cross(sub(b, a), sub(c, a));
                assert!(dot(n, t.normal) > 0.0);
                match t.surface {
                    Surface::Cover => assert!(t.normal[1] > 0.0),
                    Surface::Gable => assert!(t.normal[1].abs() < 1e-9),
                    Surface::Soffit => assert!(t.normal[1] <= 1e-9),
                }
            }
        }
    }

    #[test]
    fn textures_run_along_the_eave_and_up_the_slope() {
        let mesh = roof(&spec(rectangle(1000.0, 800.0), RoofShape::Gable, 45.0)).unwrap();
        assert_eq!(mesh.uvs.len(), mesh.positions.len());
        let slope = 2f64.sqrt();
        for t in &mesh.triangles {
            let [a, b, c] = t.corners.map(|i| mesh.positions[i as usize]);
            let [ta, tb, tc] = t.corners.map(|i| mesh.uvs[i as usize]);
            let (e1, e2) = (sub(b, a), sub(c, a));
            let (u1, v1, u2, v2) = (tb[0] - ta[0], tb[1] - ta[1], tc[0] - ta[0], tc[1] - ta[1]);
            let det = u1 * v2 - u2 * v1;
            match t.surface {
                Surface::Soffit => assert_eq!([ta, tb, tc], [[0.0; 2]; 3]),
                Surface::Cover => {
                    // True to scale: 1 cm on the surface is 1 cm on the texture, and the
                    // texture is not mirrored seen from above
                    let area = dot(cross(e1, e2), t.normal);
                    assert!(near(area, det), "area {area}, texture {det}");
                    // Up the slope the second value grows with the height
                    for (p, uv) in [(a, ta), (b, tb), (c, tc)] {
                        let eave_height = if p[2] < 400.0 { p[2] } else { 800.0 - p[2] };
                        assert!(near(uv[1], eave_height * slope));
                    }
                }
                Surface::Gable => {
                    assert!(near(dot(cross(e1, e2), t.normal).abs(), det.abs()));
                    for (p, uv) in [(a, ta), (b, tb), (c, tc)] {
                        assert!(near(uv[1], p[1]));
                    }
                }
            }
        }
        // A flat roof takes the texture along the plan
        let flat = roof(&spec(rectangle(1000.0, 800.0), RoofShape::Flat, 0.0)).unwrap();
        let cover = flat
            .triangles
            .iter()
            .find(|t| t.surface == Surface::Cover)
            .unwrap();
        for i in cover.corners {
            let (p, uv) = (flat.positions[i as usize], flat.uvs[i as usize]);
            assert_eq!(uv, [p[0], -p[2]]);
        }
    }

    #[test]
    fn the_direction_of_the_outline_does_not_matter() {
        let forward = rectangle(1000.0, 800.0);
        let mut backward = forward.clone();
        backward.reverse();
        let a = roof(&spec(forward, RoofShape::Gable, 40.0)).unwrap();
        let b = roof(&spec(backward, RoofShape::Gable, 40.0)).unwrap();
        assert_eq!(a.bounds(), b.bounds());
        for kind in [LineKind::Eave, LineKind::Verge, LineKind::Ridge] {
            assert_eq!(count(&a, kind), count(&b, kind));
        }
        let ridge = |m: &RoofMesh| {
            let l = m.lines.iter().find(|l| l.kind == LineKind::Ridge).unwrap();
            (l.a[1], l.b[1])
        };
        assert_eq!(ridge(&a), ridge(&b));
    }

    #[test]
    fn hip_roof_over_a_hexagon_ends_in_a_point() {
        let outline: Vec<P2> = (0..6)
            .map(|i| {
                let angle = f64::from(i) * std::f64::consts::PI / 3.0;
                [400.0 * angle.cos(), 400.0 * angle.sin()]
            })
            .collect();
        let mesh = roof(&spec(outline, RoofShape::Hip, 45.0)).unwrap();
        assert_eq!(count(&mesh, LineKind::Hip), 6);
        assert_eq!(count(&mesh, LineKind::Ridge), 0);
        // As high as the distance from the middle to an edge
        assert!(near(
            mesh.bounds().1[1],
            400.0 * (std::f64::consts::PI / 6.0).cos()
        ));
    }

    #[test]
    fn turning_changes_the_ridge_and_the_low_edge() {
        let outline = rectangle(1000.0, 800.0);
        use EdgeKind::{Eave, Gable};
        assert_eq!(
            shape_edges(&outline, RoofShape::Gable, 0),
            [Eave, Gable, Eave, Gable]
        );
        assert_eq!(
            shape_edges(&outline, RoofShape::Gable, 1),
            [Gable, Eave, Gable, Eave]
        );
        assert_eq!(
            shape_edges(&outline, RoofShape::Shed, 0),
            [Eave, Gable, Gable, Gable]
        );
        assert_eq!(
            shape_edges(&outline, RoofShape::Shed, 2),
            [Gable, Gable, Eave, Gable]
        );
        assert_eq!(shape_edges(&outline, RoofShape::Hip, 0), [Eave; 4]);
    }

    #[test]
    fn outlines_that_cannot_carry_a_roof_are_refused() {
        let l_shape = vec![
            [0.0, 0.0],
            [1000.0, 0.0],
            [1000.0, 400.0],
            [400.0, 400.0],
            [400.0, 900.0],
            [0.0, 900.0],
        ];
        assert_eq!(
            roof(&spec(l_shape, RoofShape::Hip, 30.0)).unwrap_err(),
            RoofError::NotConvex
        );
        let line = vec![[0.0, 0.0], [100.0, 0.0], [200.0, 0.0]];
        assert_eq!(
            roof(&spec(line, RoofShape::Hip, 30.0)).unwrap_err(),
            RoofError::TooFewCorners
        );
    }

    #[test]
    fn corners_on_a_straight_line_are_ignored() {
        let outline = vec![
            [0.0, 0.0],
            [500.0, 0.0],
            [1000.0, 0.0],
            [1000.0, 800.0],
            [0.0, 800.0],
        ];
        let mesh = roof(&RoofSpec {
            edges: vec![EdgeKind::Eave; 5],
            outline,
            pitch: 30f64.to_radians(),
            overhang: 0.0,
            thickness: 20.0,
        })
        .unwrap();
        assert_eq!(count(&mesh, LineKind::Eave), 4);
        assert_eq!(count(&mesh, LineKind::Hip), 4);
    }

    #[test]
    fn an_l_shaped_outline_is_covered_by_its_two_largest_rectangles() {
        let l_shape = vec![
            [0.0, 0.0],
            [1000.0, 0.0],
            [1000.0, 400.0],
            [400.0, 400.0],
            [400.0, 900.0],
            [0.0, 900.0],
        ];
        let mut sizes: Vec<(f64, f64)> = rectangles(&l_shape, 0.0)
            .unwrap()
            .iter()
            .map(|r| {
                let xs: Vec<f64> = r.iter().map(|p| p[0]).collect();
                let ys: Vec<f64> = r.iter().map(|p| p[1]).collect();
                let span = |v: &[f64]| {
                    v.iter().copied().fold(f64::MIN, f64::max)
                        - v.iter().copied().fold(f64::MAX, f64::min)
                };
                (span(&xs).round(), span(&ys).round())
            })
            .collect();
        sizes.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert_eq!(sizes, [(400.0, 900.0), (1000.0, 400.0)]);
        // A slanted edge has no rectangles
        let slanted = vec![[0.0, 0.0], [1000.0, 0.0], [1000.0, 400.0], [300.0, 900.0]];
        assert!(rectangles(&slanted, 0.0).is_none());
    }

    #[test]
    fn a_house_is_covered_by_as_few_roofs_as_it_needs() {
        // Small steps of the walls and a cut corner: one roof over the outline without them
        let stepped = vec![
            [0.0, 0.0],
            [600.0, 0.0],
            [600.0, 5.0],
            [1000.0, 5.0],
            [1000.0, 750.0],
            [950.0, 800.0],
            [0.0, 800.0],
        ];
        let areas = roof_areas(&stepped, 60.0);
        assert_eq!(
            areas,
            [vec![
                [1000.0, 800.0],
                [0.0, 800.0],
                [0.0, 0.0],
                [1000.0, 0.0]
            ]]
        );

        // A house with five corners keeps them
        let pentagon = vec![
            [0.0, 0.0],
            [1000.0, 0.0],
            [1000.0, 500.0],
            [500.0, 900.0],
            [0.0, 500.0],
        ];
        let areas = roof_areas(&pentagon, 60.0);
        assert_eq!(areas.len(), 1);
        assert_eq!(areas[0].len(), 5);
        assert!(roof(&spec(areas[0].clone(), RoofShape::Gable, 35.0)).is_ok());

        // An L: its two rectangles; the step in one wall adds no third roof
        let l_shape = vec![
            [0.0, 0.0],
            [600.0, 0.0],
            [600.0, 5.0],
            [1000.0, 5.0],
            [1000.0, 400.0],
            [400.0, 400.0],
            [400.0, 900.0],
            [0.0, 900.0],
        ];
        assert_eq!(roof_areas(&l_shape, 60.0).len(), 2);

        // An L whose inner corner is cut: still its two rectangles
        let cut_l = vec![
            [0.0, 0.0],
            [1000.0, 0.0],
            [1000.0, 400.0],
            [500.0, 400.0],
            [400.0, 500.0],
            [400.0, 900.0],
            [0.0, 900.0],
        ];
        let mut sizes: Vec<f64> = roof_areas(&cut_l, 60.0)
            .iter()
            .map(|r| area(r).abs().round())
            .collect();
        sizes.sort_by(f64::total_cmp);
        assert_eq!(sizes, [360_000.0, 400_000.0]);

        // A deep dent between slanted walls: one roof over everything
        let dented = vec![[0.0, 0.0], [1000.0, 0.0], [500.0, 300.0], [800.0, 900.0]];
        let areas = roof_areas(&dented, 60.0);
        assert_eq!(areas.len(), 1);
        assert_eq!(areas[0].len(), 3);
        assert!(roof_areas(&[[0.0, 0.0], [100.0, 0.0]], 60.0).is_empty());
    }
}
