//! Stairs: straight, L-shaped with a quarter landing, U-shaped with a half landing, and spiral.
//!
//! A stair is built in its own frame: the middle of the front edge of its first step lies at
//! the origin and it climbs towards -y of the plan (up in the plan). The mesh uses the axes of
//! the models: x as in the plan, y up, z along y of the plan.
//!
//! The stair has `risers` risers of the same height. The last one leads onto the floor above,
//! so there is one tread fewer than risers; a landing takes the place of one tread.

use crate::roof::P2;
use serde::{Deserialize, Serialize};
use std::f64::consts::{PI, TAU};

/// The layout of a stair.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StairShape {
    /// One flight
    Straight,
    /// Two flights at right angles with a square landing between them
    L,
    /// Two flights side by side in opposite directions with a landing across both
    U,
    /// Steps around a column
    Spiral,
}

/// Which way an L, U or spiral stair turns, seen walking up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Turn {
    Left,
    Right,
}

/// How the steps are carried.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StairStyle {
    /// Steps as blocks down to the floor (a spiral stair: blocks one riser high)
    Solid,
    /// Treads of the given thickness on two stringers (a spiral stair: around its column)
    Open,
}

/// The sides with a handrail, seen walking up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Rails {
    None,
    Left,
    Right,
    Both,
}

/// What a stair is made from. Lengths in cm.
#[derive(Debug, Clone)]
pub struct StairSpec {
    pub shape: StairShape,
    pub turn: Turn,
    pub style: StairStyle,
    pub rails: Rails,
    /// Width of the flights (a spiral stair: see `diameter`)
    pub width: f64,
    /// Height from the floor to the floor above
    pub rise: f64,
    /// Number of risers, the last one onto the floor above
    pub risers: u32,
    /// Depth of a tread (a spiral stair: on the walking line in the middle of the steps)
    pub tread: f64,
    /// Treads before the landing of an L or U shaped stair (default: half of them)
    pub first_flight: Option<u32>,
    /// Space between the two flights of a U shaped stair
    pub gap: f64,
    /// Outer diameter of a spiral stair
    pub diameter: f64,
    /// Diameter of the column of a spiral stair
    pub column: f64,
    /// Thickness of the treads of an open stair
    pub thickness: f64,
    /// Treads and landings with a top higher than this get a hole in the floor above
    pub cut_from: f64,
}

/// Height of the handrails above the front edges of the steps.
pub const RAIL_HEIGHT: f64 = 90.0;
/// Side of the square section of a handrail.
const RAIL_SIZE: f64 = 5.0;
/// Side of the square section of a post of a handrail.
const POST_SIZE: f64 = 4.0;
/// Largest distance between two posts of a handrail.
const POST_SPACING: f64 = 120.0;
/// How far a handrail lies inside the edge of the steps.
const RAIL_INSET: f64 = 4.0;
/// Thickness and depth (at right angles to its slope) of a stringer.
const STRINGER_THICKNESS: f64 = 5.0;
const STRINGER_DEPTH: f64 = 25.0;
/// How far a stringer reaches above the front edges of the treads.
const STRINGER_ABOVE: f64 = 5.0;
/// Thickness of a landing of an open stair.
const LANDING_THICKNESS: f64 = 15.0;
/// Thickness of the board in front of the floor above (the last riser).
const LAST_RISER: f64 = 2.0;
/// Sides of the round parts (column, outline of a spiral stair).
const ROUND_SIDES: usize = 32;
/// Largest angle between two corners of an arc of a spiral stair.
const ARC_STEP: f64 = PI / 18.0;

/// The surface a triangle belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Part {
    /// Treads, landings, risers and the blocks of a solid stair
    Steps,
    /// Stringers, column and handrails
    Frame,
}

/// A triangle of the mesh: indices of its corners (counter-clockwise seen from outside) and
/// its normal.
#[derive(Debug, Clone)]
pub struct Triangle {
    pub corners: [u32; 3],
    pub normal: [f64; 3],
    pub part: Part,
}

/// A generated stair: the mesh and what the plan shows of it, all in the frame of the stair.
#[derive(Debug, Clone, Default)]
pub struct StairMesh {
    /// Corners in the axes of the models (x, up, y of the plan)
    pub positions: Vec<[f64; 3]>,
    /// Place of each corner on its surface in cm
    pub uvs: Vec<[f64; 2]>,
    pub triangles: Vec<Triangle>,
    /// Edges of the treads and landings seen from above
    pub lines: Vec<[P2; 2]>,
    /// Walking line from the bottom to the top
    pub walk: Vec<P2>,
    /// Outlines of the hole the stair needs in the floor above
    pub cut_out: Vec<Vec<P2>>,
    /// Outline of the stair seen from above
    pub footprint: Vec<P2>,
}

impl StairMesh {
    /// Lowest and highest corner (x, up, y of the plan).
    pub fn bounds(&self) -> ([f64; 3], [f64; 3]) {
        let mut lo = [f64::MAX; 3];
        let mut hi = [f64::MIN; 3];
        for p in &self.positions {
            for i in 0..3 {
                lo[i] = lo[i].min(p[i]);
                hi[i] = hi[i].max(p[i]);
            }
        }
        (lo, hi)
    }
}

/// Why a stair cannot be made.
#[derive(Debug, Clone, PartialEq)]
pub enum StairError {
    TooFewRisers(u32),
    TooSmall,
}

impl std::fmt::Display for StairError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StairError::TooFewRisers(n) => write!(f, "this stair needs at least {n} risers"),
            StairError::TooSmall => write!(
                f,
                "the stair is too small: height, width and tread must be positive and a spiral \
                 stair needs 30 cm between its column and its outside"
            ),
        }
    }
}

impl std::error::Error for StairError {}

type V3 = [f64; 3];

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn scale(a: V3, s: f64) -> V3 {
    [a[0] * s, a[1] * s, a[2] * s]
}

fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn normalize(a: V3) -> V3 {
    let l = dot(a, a).sqrt();
    if l < 1e-12 { a } else { scale(a, 1.0 / l) }
}

/// A point of the plan at a height, in the axes of the models.
fn at(p: P2, z: f64) -> V3 {
    [p[0], z, p[1]]
}

fn plus(a: P2, b: P2, s: f64) -> P2 {
    [a[0] + b[0] * s, a[1] + b[1] * s]
}

/// Right hand of someone walking along `d` in the plan (y down).
fn right(d: P2) -> P2 {
    [-d[1], d[0]]
}

/// Collects triangles.
#[derive(Default)]
struct Builder {
    mesh: StairMesh,
}

impl Builder {
    /// A flat convex polygon facing along `normal`; `u` is the direction the texture runs in.
    fn face(&mut self, pts: &[V3], normal: V3, u: V3, part: Part) {
        let mut pts = pts.to_vec();
        if pts.len() < 3 {
            return;
        }
        // Counter-clockwise seen from where the normal points to
        let mut newell = [0.0; 3];
        for i in 0..pts.len() {
            let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
            newell = add(newell, cross(a, b));
        }
        if dot(newell, normal) < 0.0 {
            pts.reverse();
        }
        let u = normalize(sub(u, scale(normal, dot(u, normal))));
        let v = cross(normal, u);
        let first = self.mesh.positions.len() as u32;
        for p in &pts {
            self.mesh.positions.push(*p);
            self.mesh.uvs.push([dot(*p, u), dot(*p, v)]);
        }
        for i in 1..pts.len() as u32 - 1 {
            self.mesh.triangles.push(Triangle {
                corners: [first, first + i, first + i + 1],
                normal,
                part,
            });
        }
    }

    /// A prism: the flat convex polygon `base` moved by `offset`, closed at both ends.
    fn extrude(&mut self, base: &[V3], offset: V3, part: Part) {
        let n = base.len();
        if n < 3 || dot(offset, offset) < 1e-12 {
            return;
        }
        let top: Vec<V3> = base.iter().map(|p| add(*p, offset)).collect();
        let mut newell = [0.0; 3];
        for i in 0..n {
            newell = add(newell, cross(base[i], base[(i + 1) % n]));
        }
        let mut plane = normalize(newell);
        if dot(plane, offset) < 0.0 {
            plane = scale(plane, -1.0);
        }
        let u = sub(base[1], base[0]);
        self.face(base, scale(plane, -1.0), u, part);
        self.face(&top, plane, u, part);
        let middle = scale(
            base.iter().fold([0.0; 3], |s, p| add(s, *p)),
            1.0 / n as f64,
        );
        for i in 0..n {
            let (a, b) = (base[i], base[(i + 1) % n]);
            let mut normal = normalize(cross(sub(b, a), offset));
            if dot(normal, sub(scale(add(a, b), 0.5), middle)) < 0.0 {
                normal = scale(normal, -1.0);
            }
            let edge = sub(b, a);
            let u = if edge[1].abs() > 0.9 * dot(edge, edge).sqrt() {
                offset
            } else {
                edge
            };
            self.face(&[a, b, add(b, offset), add(a, offset)], normal, u, part);
        }
    }

    /// A horizontal convex polygon of the plan from `bottom` to `top`.
    fn block(&mut self, outline: &[P2], bottom: f64, top: f64, part: Part) {
        let base: Vec<V3> = outline.iter().map(|p| at(*p, bottom)).collect();
        self.extrude(&base, [0.0, top - bottom, 0.0], part);
    }

    /// A bar of square section between two points.
    fn bar(&mut self, a: V3, b: V3, size: f64, part: Part) {
        let d = sub(b, a);
        let len = dot(d, d).sqrt();
        if len < 1e-6 {
            return;
        }
        let dir = scale(d, 1.0 / len);
        // Longer by half the section at both ends, so that joined bars close their corners
        let a = sub(a, scale(dir, size / 2.0));
        let d = scale(dir, len + size);
        let side = if dir[1].abs() > 0.99 {
            [1.0, 0.0, 0.0]
        } else {
            normalize(cross(dir, [0.0, 1.0, 0.0]))
        };
        let up = cross(side, dir);
        let h = size / 2.0;
        let corner = |s: f64, u: f64| add(a, add(scale(side, s * h), scale(up, u * h)));
        let base = [
            corner(-1.0, -1.0),
            corner(1.0, -1.0),
            corner(1.0, 1.0),
            corner(-1.0, 1.0),
        ];
        self.extrude(&base, d, part);
    }
}

/// A straight run of treads.
struct Flight {
    /// Middle of the front edge of the first tread
    start: P2,
    /// Direction it climbs in (unit vector of the plan)
    dir: P2,
    /// Number of treads
    count: u32,
    /// Index of the riser below the first tread (the first tread lies at `level + 1` risers)
    level: u32,
}

/// A point of a handrail: where it is in the plan, the height of the rail and the height of
/// the surface below it.
#[derive(Clone, Copy)]
struct RailPoint {
    p: P2,
    rail: f64,
    surface: f64,
}

/// A tread or a landing: its outline (the first edge runs across the stair) and the height of
/// its top.
struct Step {
    outline: Vec<P2>,
    top: f64,
}

fn inside_convex(outline: &[P2], q: P2) -> bool {
    let n = outline.len();
    let mut sign = 0.0;
    for i in 0..n {
        let (a, b) = (outline[i], outline[(i + 1) % n]);
        let c = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
        if c.abs() < 1e-6 {
            continue;
        }
        if sign == 0.0 {
            sign = c.signum();
        } else if c.signum() != sign {
            return false;
        }
    }
    true
}

/// Point on a circle around `center`, mirrored for a stair that turns left.
fn on_circle(center: P2, radius: f64, angle: f64, mirror: f64) -> P2 {
    [
        mirror * (center[0] + radius * angle.cos()),
        center[1] + radius * angle.sin(),
    ]
}

/// Makes a stair.
pub fn stair(spec: &StairSpec) -> Result<StairMesh, StairError> {
    let landing = matches!(spec.shape, StairShape::L | StairShape::U);
    let min_risers = if landing { 4 } else { 2 };
    if spec.risers < min_risers {
        return Err(StairError::TooFewRisers(min_risers));
    }
    let spiral = spec.shape == StairShape::Spiral;
    let outer = spec.diameter / 2.0;
    let inner = spec.column / 2.0;
    if !(spec.rise > 1.0 && spec.tread > 1.0)
        || (!spiral && spec.width < 10.0)
        || (spiral && outer - inner < 30.0)
    {
        return Err(StairError::TooSmall);
    }
    let r = spec.rise / f64::from(spec.risers);
    let t = spec.tread;
    let w = spec.width;
    // Treads, a landing counted as one
    let k = spec.risers - 1;
    let mirror = if spec.turn == Turn::Left { -1.0 } else { 1.0 };
    let m = |p: P2| [mirror * p[0], p[1]];
    let open = spec.style == StairStyle::Open;
    let mut b = Builder::default();
    let mut steps: Vec<Step> = Vec::new();
    // Handrails seen walking up
    let mut left: Vec<RailPoint> = Vec::new();
    let mut right_rail: Vec<RailPoint> = Vec::new();
    let mut flights: Vec<Flight> = Vec::new();
    let mut landings: Vec<(Vec<P2>, u32)> = Vec::new();

    if spiral {
        let walk_radius = (inner + outer) / 2.0;
        let center = [walk_radius, 0.0];
        let delta = t / walk_radius;
        let arc = |from: f64, to: f64, radius: f64| -> Vec<P2> {
            let n = ((to - from).abs() / ARC_STEP).ceil().max(1.0) as usize;
            (0..=n)
                .map(|i| {
                    on_circle(
                        center,
                        radius,
                        from + (to - from) * i as f64 / n as f64,
                        mirror,
                    )
                })
                .collect()
        };
        for j in 0..k {
            let (a0, a1) = (PI + f64::from(j) * delta, PI + f64::from(j + 1) * delta);
            let mut outline = vec![on_circle(center, inner, a0, mirror)];
            outline.extend(arc(a0, a1, outer));
            outline.push(on_circle(center, inner, a1, mirror));
            let top = f64::from(j + 1) * r;
            let bottom = if open {
                top - spec.thickness
            } else if j == 0 {
                0.0
            } else {
                top - r
            };
            b.block(&outline, bottom, top, Part::Steps);
            steps.push(Step { outline, top });
        }
        // The column, up to the floor above
        let column: Vec<P2> = (0..ROUND_SIDES)
            .map(|i| {
                on_circle(
                    center,
                    inner.max(2.0),
                    TAU * i as f64 / ROUND_SIDES as f64,
                    mirror,
                )
            })
            .collect();
        b.block(&column, 0.0, spec.rise, Part::Frame);
        // The last riser, along the edge of the floor above
        let end = PI + f64::from(k) * delta;
        // A thin wedge on the last tread, inside the circle of the stair
        let before = end - LAST_RISER / outer;
        let board = vec![
            on_circle(center, inner, end, mirror),
            on_circle(center, outer, end, mirror),
            on_circle(center, outer, before, mirror),
            on_circle(center, inner, before, mirror),
        ];
        b.block(
            &board,
            f64::from(k) * r - if open { spec.thickness } else { 0.0 },
            spec.rise,
            Part::Steps,
        );
        // A handrail on the outside
        let outside = matches!(
            (spec.rails, spec.turn),
            (Rails::Both, _) | (Rails::Left, Turn::Right) | (Rails::Right, Turn::Left)
        );
        if outside {
            let rail = if spec.turn == Turn::Right {
                &mut left
            } else {
                &mut right_rail
            };
            let per_tread = ((delta / ARC_STEP).ceil() as u32).max(1);
            for i in 0..=k * per_tread {
                let s = f64::from(i) / f64::from(per_tread);
                let angle = PI + s * delta;
                let level = (s.floor() as u32).min(k - 1) + 1;
                rail.push(RailPoint {
                    p: on_circle(center, outer - RAIL_INSET, angle, mirror),
                    rail: (s + 1.0) * r + RAIL_HEIGHT,
                    surface: f64::from(level) * r,
                });
            }
        }
        b.mesh.walk = arc(PI, end, walk_radius);
        b.mesh.footprint = (0..ROUND_SIDES)
            .map(|i| on_circle(center, outer, TAU * i as f64 / ROUND_SIDES as f64, mirror))
            .collect();
        if steps.iter().any(|s| s.top > spec.cut_from) {
            b.mesh.cut_out.push(b.mesh.footprint.clone());
        }
    } else {
        let hw = w / 2.0;
        match spec.shape {
            StairShape::Straight => {
                flights.push(Flight {
                    start: [0.0, 0.0],
                    dir: [0.0, -1.0],
                    count: k,
                    level: 0,
                });
                b.mesh.walk = vec![[0.0, 0.0], [0.0, -f64::from(k) * t]];
                b.mesh.footprint = vec![
                    [-hw, 0.0],
                    [hw, 0.0],
                    [hw, -f64::from(k) * t],
                    [-hw, -f64::from(k) * t],
                ];
            }
            StairShape::L | StairShape::U => {
                let treads = k - 1;
                let first = spec
                    .first_flight
                    .unwrap_or(treads.div_ceil(2))
                    .clamp(1, treads - 1);
                let second = treads - first;
                let (fa, fb) = (f64::from(first) * t, f64::from(second) * t);
                flights.push(Flight {
                    start: [0.0, 0.0],
                    dir: [0.0, -1.0],
                    count: first,
                    level: 0,
                });
                if spec.shape == StairShape::L {
                    landings.push((
                        vec![[-hw, -fa], [hw, -fa], [hw, -fa - w], [-hw, -fa - w]]
                            .into_iter()
                            .map(m)
                            .collect(),
                        first + 1,
                    ));
                    flights.push(Flight {
                        start: m([hw, -fa - hw]),
                        dir: [mirror, 0.0],
                        count: second,
                        level: first + 1,
                    });
                    b.mesh.walk = vec![[0.0, 0.0], [0.0, -fa - hw], m([hw + fb, -fa - hw])];
                    b.mesh.footprint = vec![
                        [-hw, 0.0],
                        [hw, 0.0],
                        [hw, -fa],
                        [hw + fb, -fa],
                        [hw + fb, -fa - w],
                        [-hw, -fa - w],
                    ]
                    .into_iter()
                    .map(m)
                    .collect();
                } else {
                    let g = spec.gap.max(0.0);
                    let far = hw + g + w;
                    landings.push((
                        vec![[-hw, -fa], [far, -fa], [far, -fa - w], [-hw, -fa - w]]
                            .into_iter()
                            .map(m)
                            .collect(),
                        first + 1,
                    ));
                    flights.push(Flight {
                        start: m([w + g, -fa]),
                        dir: [0.0, 1.0],
                        count: second,
                        level: first + 1,
                    });
                    b.mesh.walk = vec![
                        [0.0, 0.0],
                        [0.0, -fa - hw],
                        m([w + g, -fa - hw]),
                        m([w + g, -fa + fb]),
                    ];
                    let bottom = (-fa + fb).max(0.0);
                    b.mesh.footprint =
                        vec![[-hw, bottom], [far, bottom], [far, -fa - w], [-hw, -fa - w]]
                            .into_iter()
                            .map(m)
                            .collect();
                }
            }
            StairShape::Spiral => unreachable!(),
        }
        // Treads, stringers and the cut-out of each flight
        for f in &flights {
            let side = right(f.dir);
            let mut cut_from = None;
            for j in 0..f.count {
                let front = plus(f.start, f.dir, f64::from(j) * t);
                let back = plus(front, f.dir, t);
                let outline = vec![
                    plus(front, side, -hw),
                    plus(front, side, hw),
                    plus(back, side, hw),
                    plus(back, side, -hw),
                ];
                let top = f64::from(f.level + j + 1) * r;
                let bottom = if open { top - spec.thickness } else { 0.0 };
                b.block(&outline, bottom, top, Part::Steps);
                if top > spec.cut_from && cut_from.is_none() {
                    cut_from = Some(j);
                }
                steps.push(Step { outline, top });
            }
            let length = f64::from(f.count) * t;
            if let Some(j) = cut_from {
                let front = plus(f.start, f.dir, f64::from(j) * t);
                let back = plus(f.start, f.dir, length);
                b.mesh.cut_out.push(vec![
                    plus(front, side, -hw),
                    plus(front, side, hw),
                    plus(back, side, hw),
                    plus(back, side, -hw),
                ]);
            }
            if open {
                // Stringers along both sides, seen from the side: the top runs above the front
                // edges of the treads, the bottom parallel to it, cut off at the floor below
                let floor = f64::from(f.level) * r;
                let slope = r / t;
                let depth = STRINGER_DEPTH * (1.0 + slope * slope).sqrt();
                let top = |s: f64| floor + r + s * slope + STRINGER_ABOVE;
                let mut profile: Vec<(f64, f64)> = Vec::new();
                if top(0.0) - depth >= floor {
                    profile.push((0.0, top(0.0) - depth));
                } else {
                    profile.push((0.0, floor));
                }
                profile.push((0.0, top(0.0)));
                profile.push((length, top(length)));
                if top(length) - depth >= floor {
                    profile.push((length, top(length) - depth));
                    if top(0.0) - depth < floor {
                        profile.push(((floor + depth - top(0.0)) / slope, floor));
                    }
                } else {
                    profile.push((length, floor));
                }
                for edge in [-hw, hw - STRINGER_THICKNESS] {
                    let base: Vec<V3> = profile
                        .iter()
                        .map(|(s, z)| at(plus(plus(f.start, f.dir, *s), side, edge), *z))
                        .collect();
                    let across = at(plus([0.0, 0.0], side, STRINGER_THICKNESS), 0.0);
                    b.extrude(&base, across, Part::Frame);
                }
            }
        }
        for (outline, level) in &landings {
            let top = f64::from(*level) * r;
            let bottom = if open {
                top - LANDING_THICKNESS.max(spec.thickness)
            } else {
                0.0
            };
            b.block(outline, bottom, top, Part::Steps);
            if top > spec.cut_from {
                b.mesh.cut_out.push(outline.clone());
            }
            steps.push(Step {
                outline: outline.clone(),
                top,
            });
        }
        // The last riser, along the edge of the floor above
        if let Some(f) = flights.last() {
            let side = right(f.dir);
            let edge = plus(f.start, f.dir, f64::from(f.count) * t);
            let inner_edge = plus(edge, f.dir, -LAST_RISER);
            let board = vec![
                plus(inner_edge, side, -hw),
                plus(inner_edge, side, hw),
                plus(edge, side, hw),
                plus(edge, side, -hw),
            ];
            let below = f64::from(k) * r - if open { spec.thickness } else { 0.0 };
            b.block(&board, below, spec.rise, Part::Steps);
        }
        // Handrails: along the flights at the height of the front edges of the treads, along
        // the outer edges of the landings at the height of the landing
        let rail_hw = hw - RAIL_INSET;
        let flight_side = |f: &Flight, offset: f64| -> [RailPoint; 2] {
            let side = right(f.dir);
            let length = f64::from(f.count) * t;
            let floor = f64::from(f.level) * r;
            [
                RailPoint {
                    p: plus(f.start, side, offset),
                    rail: floor + r + RAIL_HEIGHT,
                    surface: floor + r,
                },
                RailPoint {
                    p: plus(plus(f.start, f.dir, length), side, offset),
                    rail: floor + r * (f64::from(f.count) + 1.0) + RAIL_HEIGHT,
                    surface: floor + r * (f64::from(f.count) + 1.0),
                },
            ]
        };
        let landing_point = |p: P2, level: u32| RailPoint {
            p: m(p),
            rail: f64::from(level) * r + RAIL_HEIGHT,
            surface: f64::from(level) * r,
        };
        // Outer and inner side of a stair that turns right (mirrored for one that turns left)
        let (outer_rail, inner_rail): (Vec<RailPoint>, Vec<RailPoint>) = match spec.shape {
            StairShape::Straight => (
                flight_side(&flights[0], -mirror * rail_hw).to_vec(),
                flight_side(&flights[0], mirror * rail_hw).to_vec(),
            ),
            StairShape::L => {
                let (f1, f2) = (&flights[0], &flights[1]);
                let level = f1.count + 1;
                let fa = f64::from(f1.count) * t;
                let mut outer_rail = flight_side(f1, -rail_hw * mirror).to_vec();
                outer_rail.push(landing_point([-rail_hw, -fa - w + RAIL_INSET], level));
                outer_rail.push(landing_point([hw, -fa - w + RAIL_INSET], level));
                outer_rail.extend(flight_side(f2, -rail_hw * mirror));
                let mut inner_rail = flight_side(f1, rail_hw * mirror).to_vec();
                inner_rail.push(landing_point([rail_hw, -fa - RAIL_INSET], level));
                inner_rail.extend(flight_side(f2, rail_hw * mirror));
                (outer_rail, inner_rail)
            }
            StairShape::U => {
                let (f1, f2) = (&flights[0], &flights[1]);
                let level = f1.count + 1;
                let fa = f64::from(f1.count) * t;
                let far = hw + spec.gap.max(0.0) + w - RAIL_INSET;
                let mut outer_rail = flight_side(f1, -rail_hw * mirror).to_vec();
                outer_rail.push(landing_point([-rail_hw, -fa - w + RAIL_INSET], level));
                outer_rail.push(landing_point([far, -fa - w + RAIL_INSET], level));
                outer_rail.extend(flight_side(f2, -rail_hw * mirror));
                let mut inner_rail = flight_side(f1, rail_hw * mirror).to_vec();
                inner_rail.push(landing_point([rail_hw, -fa - RAIL_INSET], level));
                inner_rail.push(landing_point(
                    [hw + spec.gap.max(0.0) + RAIL_INSET, -fa - RAIL_INSET],
                    level,
                ));
                inner_rail.extend(flight_side(f2, rail_hw * mirror));
                (outer_rail, inner_rail)
            }
            StairShape::Spiral => unreachable!(),
        };
        if spec.turn == Turn::Right {
            left = outer_rail;
            right_rail = inner_rail;
        } else {
            left = inner_rail;
            right_rail = outer_rail;
        }
        if !matches!(spec.rails, Rails::Left | Rails::Both) {
            left.clear();
        }
        if !matches!(spec.rails, Rails::Right | Rails::Both) {
            right_rail.clear();
        }
    }
    for rail in [&left, &right_rail] {
        add_rail(&mut b, rail, &steps);
    }

    // Edges of the treads and landings seen from above, each once
    let mut lines: Vec<[P2; 2]> = Vec::new();
    let key = |p: P2| [(p[0] * 10.0).round() as i64, (p[1] * 10.0).round() as i64];
    let mut seen = std::collections::HashSet::new();
    for s in &steps {
        let n = s.outline.len();
        for i in 0..n {
            let (a, c) = (s.outline[i], s.outline[(i + 1) % n]);
            let (ka, kc) = (key(a), key(c));
            if ka == kc || !seen.insert(if ka < kc { (ka, kc) } else { (kc, ka) }) {
                continue;
            }
            lines.push([a, c]);
        }
    }
    if spiral {
        let walk_radius = (inner + outer) / 2.0;
        let center = [walk_radius, 0.0];
        for i in 0..ROUND_SIDES {
            let a = TAU * i as f64 / ROUND_SIDES as f64;
            let c = TAU * (i + 1) as f64 / ROUND_SIDES as f64;
            lines.push([
                on_circle(center, inner, a, mirror),
                on_circle(center, inner, c, mirror),
            ]);
        }
    }
    b.mesh.lines = lines;
    Ok(b.mesh)
}

/// Adds a handrail along `points` with posts at its ends, at its corners and in between.
fn add_rail(b: &mut Builder, points: &[RailPoint], steps: &[Step]) {
    if points.len() < 2 {
        return;
    }
    // The rail starts and ends a little inside the ends of the stair
    let mut points = points.to_vec();
    let n = points.len();
    for (end, next) in [(0, 1), (n - 1, n - 2)] {
        let (p, q) = (points[end].p, points[next].p);
        let d = ((q[0] - p[0]).powi(2) + (q[1] - p[1]).powi(2)).sqrt();
        if d > 2.0 * RAIL_INSET {
            let s = RAIL_INSET / d;
            let surface = points[end].surface;
            points[end].p = [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s];
            points[end].rail += (points[next].rail - points[end].rail) * s;
            points[end].surface = surface;
        }
    }
    for pair in points.windows(2) {
        b.bar(
            at(pair[0].p, pair[0].rail),
            at(pair[1].p, pair[1].rail),
            RAIL_SIZE,
            Part::Frame,
        );
    }
    // Where the posts stand: ends, corners, and in between no further apart than POST_SPACING
    let surface_at = |q: P2, fallback: f64| {
        steps
            .iter()
            .filter(|s| inside_convex(&s.outline, q))
            .map(|s| s.top)
            .fold(None, |best: Option<f64>, top| {
                Some(best.map_or(top, |b| b.max(top)))
            })
            .unwrap_or(fallback)
    };
    let mut posts: Vec<(P2, f64, f64)> = Vec::new();
    let post = |posts: &mut Vec<(P2, f64, f64)>, p: P2, rail: f64, surface: f64| {
        if posts
            .iter()
            .any(|(q, _, _)| (q[0] - p[0]).abs() < 1.0 && (q[1] - p[1]).abs() < 1.0)
        {
            return;
        }
        posts.push((p, rail, surface));
    };
    let mut since = 0.0;
    for i in 0..points.len() {
        let pt = points[i];
        let corner = i == 0 || i == points.len() - 1 || {
            let (a, c) = (points[i - 1].p, points[i + 1].p);
            let (d1, d2) = (
                [pt.p[0] - a[0], pt.p[1] - a[1]],
                [c[0] - pt.p[0], c[1] - pt.p[1]],
            );
            let l1 = d1[0].hypot(d1[1]);
            let l2 = d2[0].hypot(d2[1]);
            l1 < 1e-6 || l2 < 1e-6 || (d1[0] * d2[0] + d1[1] * d2[1]) / (l1 * l2) < 0.94
        };
        if corner {
            post(&mut posts, pt.p, pt.rail, surface_at(pt.p, pt.surface));
            since = 0.0;
        }
        if let Some(next) = points.get(i + 1) {
            let len = (next.p[0] - pt.p[0]).hypot(next.p[1] - pt.p[1]);
            if len < 1e-6 {
                continue;
            }
            // Posts every POST_SPACING along the rail since the last one
            let mut pos = 0.0;
            while since + (len - pos) > POST_SPACING {
                pos += POST_SPACING - since;
                since = 0.0;
                let f = pos / len;
                let p = [
                    pt.p[0] + (next.p[0] - pt.p[0]) * f,
                    pt.p[1] + (next.p[1] - pt.p[1]) * f,
                ];
                let rail = pt.rail + (next.rail - pt.rail) * f;
                post(&mut posts, p, rail, surface_at(p, rail - RAIL_HEIGHT));
            }
            since += len - pos;
        }
    }
    for (p, rail, surface) in posts {
        let top = rail - RAIL_SIZE / 2.0;
        if top > surface + 1.0 {
            b.bar(at(p, surface), at(p, top), POST_SIZE, Part::Frame);
        }
    }
}

/// Number of risers for a height: about 17.5 cm each, none higher than 19 cm.
pub fn default_risers(rise: f64) -> u32 {
    let n = (rise / 17.5).round().max((rise / 19.0).ceil());
    n.clamp(2.0, 200.0) as u32
}

/// Depth of a tread that fits a riser by the step rule (2 × riser + tread = 63 cm).
pub fn default_tread(riser: f64) -> f64 {
    ((63.0 - 2.0 * riser) * 10.0).round().clamp(150.0, 400.0) / 10.0
}

/// A check of a stair that it does not pass.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "value")]
pub enum StairWarning {
    /// Riser height in cm outside 14 to 20 cm
    Riser(f64),
    /// Tread depth in cm outside 23 to 37 cm
    Tread(f64),
    /// 2 × riser + tread in cm outside 59 to 65 cm (step rule)
    StepRule(f64),
    /// Headroom in cm under the turn above of a spiral stair, below 200 cm
    Headroom(f64),
}

/// The checks of DIN 18065 for stairs in homes (riser, tread, step rule) and the headroom of a
/// spiral stair that a stair does not pass.
pub fn warnings(spec: &StairSpec) -> Vec<StairWarning> {
    let r = spec.rise / f64::from(spec.risers.max(1));
    let t = spec.tread;
    let round = |v: f64| (v * 10.0).round() / 10.0;
    let mut out = Vec::new();
    if !(14.0..=20.0).contains(&round(r)) {
        out.push(StairWarning::Riser(round(r)));
    }
    if !(23.0..=37.0).contains(&round(t)) {
        out.push(StairWarning::Tread(round(t)));
    }
    let step = round(2.0 * r + t);
    if !(59.0..=65.0).contains(&step) {
        out.push(StairWarning::StepRule(step));
    }
    if spec.shape == StairShape::Spiral {
        let walk_radius = (spec.diameter + spec.column) / 4.0;
        if walk_radius > 0.0 && t > 0.0 {
            // Risers in one turn, and how high the tread above lies over a tread
            let per_turn = TAU * walk_radius / t;
            let thickness = if spec.style == StairStyle::Open {
                spec.thickness
            } else {
                r
            };
            let headroom = per_turn * r - thickness;
            if per_turn < f64::from(spec.risers) && headroom < 200.0 {
                out.push(StairWarning::Headroom(round(headroom)));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(shape: StairShape) -> StairSpec {
        StairSpec {
            shape,
            turn: Turn::Right,
            style: StairStyle::Solid,
            rails: Rails::None,
            width: 100.0,
            rise: 270.0,
            risers: 15,
            tread: 27.0,
            first_flight: None,
            gap: 10.0,
            diameter: 200.0,
            column: 10.0,
            thickness: 5.0,
            cut_from: 0.0,
        }
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    /// Every triangle has the winding its normal says.
    fn check_winding(mesh: &StairMesh) {
        for t in &mesh.triangles {
            let [a, b, c] = t.corners.map(|i| mesh.positions[i as usize]);
            let n = cross(sub(b, a), sub(c, a));
            assert!(dot(n, t.normal) > -1e-9, "triangle against its normal");
        }
    }

    #[test]
    fn straight_stair_has_its_size() {
        let mesh = stair(&spec(StairShape::Straight)).unwrap();
        let (lo, hi) = mesh.bounds();
        assert!(close(lo[0], -50.0) && close(hi[0], 50.0));
        // 14 treads of 27 cm towards -y, from the floor to the floor above
        assert!(close(hi[2], 0.0) && close(lo[2], -14.0 * 27.0));
        assert!(close(lo[1], 0.0) && close(hi[1], 270.0));
        assert_eq!(mesh.walk, vec![[0.0, 0.0], [0.0, -378.0]]);
        check_winding(&mesh);
        // Every edge of the steps once: 15 fronts and backs across, two sides per tread
        assert_eq!(mesh.lines.len(), 15 + 2 * 14);
    }

    #[test]
    fn cut_out_starts_where_the_headroom_ends() {
        let mut s = spec(StairShape::Straight);
        // Treads with a top above 100 cm: from the 6th (18 cm × 6 = 108)
        s.cut_from = 100.0;
        let mesh = stair(&s).unwrap();
        assert_eq!(mesh.cut_out.len(), 1);
        let ys: Vec<f64> = mesh.cut_out[0].iter().map(|p| p[1]).collect();
        assert!(close(ys[0], -5.0 * 27.0) && close(ys[2], -14.0 * 27.0));
    }

    #[test]
    fn l_stair_turns_with_a_landing() {
        let mesh = stair(&spec(StairShape::L)).unwrap();
        let (lo, hi) = mesh.bounds();
        // 13 treads: 7 then the landing then 6 to the right
        assert!(close(lo[2], -7.0 * 27.0 - 100.0));
        assert!(close(hi[0], 50.0 + 6.0 * 27.0));
        assert!(close(lo[0], -50.0));
        check_winding(&mesh);
        let mut left = spec(StairShape::L);
        left.turn = Turn::Left;
        let mesh = stair(&left).unwrap();
        let (lo, _) = mesh.bounds();
        assert!(close(lo[0], -50.0 - 6.0 * 27.0));
        check_winding(&mesh);
    }

    #[test]
    fn u_stair_comes_back_beside_the_first_flight() {
        let mut s = spec(StairShape::U);
        s.first_flight = Some(8);
        let mesh = stair(&s).unwrap();
        let (lo, hi) = mesh.bounds();
        assert!(close(hi[0], 50.0 + 10.0 + 100.0));
        assert!(close(lo[2], -8.0 * 27.0 - 100.0));
        assert_eq!(mesh.walk.last(), Some(&[110.0, -8.0 * 27.0 + 5.0 * 27.0]));
        check_winding(&mesh);
    }

    #[test]
    fn spiral_stair_fits_its_circle() {
        let mut s = spec(StairShape::Spiral);
        s.rails = Rails::Both;
        let mesh = stair(&s).unwrap();
        let (lo, hi) = mesh.bounds();
        assert!(hi[0] - lo[0] <= 200.0 + 1e-6, "{lo:?} {hi:?}");
        assert!(hi[2] - lo[2] <= 200.0 + 1e-6);
        // The rail stands above the floor above at the top
        assert!(hi[1] > 270.0 + RAIL_HEIGHT - 10.0);
        assert_eq!(mesh.cut_out.len(), 1);
        check_winding(&mesh);
    }

    #[test]
    fn open_stair_and_rails_stay_inside_the_steps() {
        for shape in [StairShape::Straight, StairShape::L, StairShape::U] {
            let mut s = spec(shape);
            s.style = StairStyle::Open;
            s.rails = Rails::Both;
            let solid = stair(&spec(shape)).unwrap();
            let open = stair(&s).unwrap();
            let (lo, hi) = solid.bounds();
            let (olo, ohi) = open.bounds();
            for i in [0, 2] {
                assert!(
                    olo[i] >= lo[i] - 1e-6 && ohi[i] <= hi[i] + 1e-6,
                    "{shape:?}"
                );
            }
            assert!(ohi[1] > 270.0 + RAIL_HEIGHT - 10.0);
            check_winding(&open);
        }
    }

    #[test]
    fn refuses_too_few_risers() {
        let mut s = spec(StairShape::L);
        s.risers = 3;
        assert_eq!(stair(&s).unwrap_err(), StairError::TooFewRisers(4));
        let mut s = spec(StairShape::Spiral);
        s.diameter = 60.0;
        assert_eq!(stair(&s).unwrap_err(), StairError::TooSmall);
    }

    #[test]
    fn defaults_follow_the_step_rule() {
        assert_eq!(default_risers(270.0), 15);
        assert_eq!(default_risers(262.0), 15);
        assert_eq!(default_tread(18.0), 27.0);
        assert!(warnings(&spec(StairShape::Straight)).is_empty());
        let mut s = spec(StairShape::Straight);
        s.tread = 20.0;
        assert_eq!(
            warnings(&s),
            vec![StairWarning::Tread(20.0), StairWarning::StepRule(56.0)]
        );
        // A small spiral stair runs into itself
        let mut s = spec(StairShape::Spiral);
        s.diameter = 120.0;
        assert!(matches!(
            warnings(&s).as_slice(),
            [StairWarning::Headroom(_)]
        ));
    }
}
