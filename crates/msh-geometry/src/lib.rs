//! Geometry of My Sweet Home.
//!
//! Computes the outline of walls as seen from above, including mitered joins
//! with connected walls and arc walls. The algorithm follows the behavior of
//! Sweet Home 3D (`Wall.getPoints`): each wall has a left and a right side
//! line; at a joined end, each side line is intersected with the matching side
//! line of the neighbor.

use msh_model::{Home, Room, Wall};
use serde::Serialize;
use std::collections::HashMap;

pub type Pt = [f32; 2];

/// Outline of one wall in plan coordinates (cm).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WallShape {
    /// Wall ID from `Home.xml`
    pub id: String,
    /// Points of the left side from start to end
    pub left: Vec<Pt>,
    /// Points of the right side from start to end
    pub right: Vec<Pt>,
}

impl WallShape {
    /// Closed polygon: left side forward, right side backward.
    pub fn polygon(&self) -> Vec<Pt> {
        let mut p = self.left.clone();
        p.extend(self.right.iter().rev());
        p
    }
}

/// Number of segments used per 90° of arc.
const ARC_SEGMENTS_PER_QUARTER: f32 = 8.0;

/// Computes the outlines of all walls of a home.
pub fn wall_shapes(home: &Home) -> Vec<WallShape> {
    let by_id: HashMap<&str, &Wall> = home
        .walls
        .iter()
        .map(|w| (w.attrs.id.as_str(), w))
        .collect();
    home.walls.iter().map(|w| wall_shape(w, &by_id)).collect()
}

/// Outline of one wall, joined with its neighbors from `by_id`.
pub fn wall_shape(wall: &Wall, by_id: &HashMap<&str, &Wall>) -> WallShape {
    let (mut left, mut right) = unjoined_sides(wall);
    let a = &wall.attrs;
    let limit = a.thickness * 5.0;

    // Join at the start
    if let Some(other) = a.wall_at_start.as_deref().and_then(|id| by_id.get(id)) {
        let (ol, or) = unjoined_sides(other);
        let other_end_is_us = other.attrs.wall_at_end.as_deref() == Some(a.id.as_str());
        let other_start_is_us = other.attrs.wall_at_start.as_deref() == Some(a.id.as_str());
        if other_end_is_us {
            // other ends where we start: same orientation
            join_start(&mut left, end_line(&ol), limit);
            join_start(&mut right, end_line(&or), limit);
        } else if other_start_is_us {
            // both start at the same point: opposite orientation
            join_start(&mut left, start_line_reversed(&or), limit);
            join_start(&mut right, start_line_reversed(&ol), limit);
        }
    }

    // Join at the end
    if let Some(other) = a.wall_at_end.as_deref().and_then(|id| by_id.get(id)) {
        let (ol, or) = unjoined_sides(other);
        let other_start_is_us = other.attrs.wall_at_start.as_deref() == Some(a.id.as_str());
        let other_end_is_us = other.attrs.wall_at_end.as_deref() == Some(a.id.as_str());
        if other_start_is_us {
            join_end(&mut left, start_line(&ol), limit);
            join_end(&mut right, start_line(&or), limit);
        } else if other_end_is_us {
            join_end(&mut left, end_line_reversed(&or), limit);
            join_end(&mut right, end_line_reversed(&ol), limit);
        }
    }

    WallShape {
        id: a.id.clone(),
        left,
        right,
    }
}

/// Left and right side of a wall without joins.
fn unjoined_sides(wall: &Wall) -> (Vec<Pt>, Vec<Pt>) {
    let a = &wall.attrs;
    let half = a.thickness / 2.0;
    match a.arc_extent.filter(|e| e.abs() > 1e-4) {
        None => {
            let angle = (a.y_end - a.y_start).atan2(a.x_end - a.x_start);
            let (dx, dy) = (angle.sin() * half, angle.cos() * half);
            (
                vec![
                    [a.x_start + dx, a.y_start - dy],
                    [a.x_end + dx, a.y_end - dy],
                ],
                vec![
                    [a.x_start - dx, a.y_start + dy],
                    [a.x_end - dx, a.y_end + dy],
                ],
            )
        }
        Some(extent) => arc_sides(wall, extent, half),
    }
}

/// Sides of an arc wall, sampled as polylines.
fn arc_sides(wall: &Wall, extent: f32, half: f32) -> (Vec<Pt>, Vec<Pt>) {
    let a = &wall.attrs;
    let (cx, cy, radius) = arc_circle(a.x_start, a.y_start, a.x_end, a.y_end, extent);
    let start_angle = (a.y_start - cy).atan2(a.x_start - cx);
    let segments = ((extent.abs() / std::f32::consts::FRAC_PI_2) * ARC_SEGMENTS_PER_QUARTER)
        .ceil()
        .max(2.0) as usize;
    // For a positive extent the arc turns counter-clockwise in math orientation;
    // the left side (as defined for straight walls) is then the outer side.
    let left_radius = if extent > 0.0 {
        radius + half
    } else {
        radius - half
    };
    let right_radius = if extent > 0.0 {
        radius - half
    } else {
        radius + half
    };
    let mut left = Vec::with_capacity(segments + 1);
    let mut right = Vec::with_capacity(segments + 1);
    for i in 0..=segments {
        let t = start_angle + extent * i as f32 / segments as f32;
        let (s, c) = t.sin_cos();
        left.push([cx + c * left_radius, cy + s * left_radius]);
        right.push([cx + c * right_radius, cy + s * right_radius]);
    }
    (left, right)
}

/// Center and radius of the circle through start and end with the given arc extent.
pub fn arc_circle(xs: f32, ys: f32, xe: f32, ye: f32, extent: f32) -> (f32, f32, f32) {
    let chord = (xe - xs).hypot(ye - ys);
    let radius = chord / (2.0 * (extent / 2.0).sin()).abs();
    let (mx, my) = ((xs + xe) / 2.0, (ys + ye) / 2.0);
    // Distance from the chord midpoint to the center
    let d = chord / (2.0 * (extent / 2.0).tan());
    let angle = (ye - ys).atan2(xe - xs);
    // Center lies on the perpendicular bisector; side depends on the sign of the extent
    let (cx, cy) = (mx - angle.sin() * d, my + angle.cos() * d);
    (cx, cy, radius.abs())
}

type Line = (Pt, Pt);

fn start_line(side: &[Pt]) -> Line {
    (side[0], side[1])
}
fn end_line(side: &[Pt]) -> Line {
    (side[side.len() - 2], side[side.len() - 1])
}
fn start_line_reversed(side: &[Pt]) -> Line {
    (side[1], side[0])
}
fn end_line_reversed(side: &[Pt]) -> Line {
    (side[side.len() - 1], side[side.len() - 2])
}

fn join_start(side: &mut [Pt], other: Line, limit: f32) {
    let own = (side[0], side[1]);
    if let Some(p) = intersection(own, other)
        && dist(p, side[0]) <= limit
    {
        side[0] = p;
    }
}

fn join_end(side: &mut [Pt], other: Line, limit: f32) {
    let n = side.len();
    let own = (side[n - 2], side[n - 1]);
    if let Some(p) = intersection(own, other)
        && dist(p, side[n - 1]) <= limit
    {
        side[n - 1] = p;
    }
}

/// Intersection of two infinite lines, `None` if (almost) parallel.
fn intersection((p1, p2): Line, (p3, p4): Line) -> Option<Pt> {
    let d1 = [p2[0] - p1[0], p2[1] - p1[1]];
    let d2 = [p4[0] - p3[0], p4[1] - p3[1]];
    let den = d1[0] * d2[1] - d1[1] * d2[0];
    let len = (d1[0].hypot(d1[1])) * (d2[0].hypot(d2[1]));
    if len == 0.0 || (den / len).abs() < 1e-4 {
        return None;
    }
    let t = ((p3[0] - p1[0]) * d2[1] - (p3[1] - p1[1]) * d2[0]) / den;
    Some([p1[0] + d1[0] * t, p1[1] + d1[1] * t])
}

fn dist(a: Pt, b: Pt) -> f32 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

/// Outline of the area enclosed by walls around `p`, like a double-click with the
/// room tool in Sweet Home 3D. Only walls on `level` are considered (all walls if
/// `level` is `None`). Returns `None` if `p` is not surrounded by walls.
pub fn enclosed_area(home: &Home, level: Option<&str>, p: Pt) -> Option<Vec<Pt>> {
    use geo::{Area, Contains, LineString, MultiPolygon, Point, Polygon};
    let shapes = wall_shapes(home);
    let polygons: Vec<Polygon<f64>> = home
        .walls
        .iter()
        .zip(&shapes)
        .filter(|(w, _)| level.is_none() || w.attrs.level.as_deref() == level)
        .map(|(_, s)| {
            let ring: Vec<(f64, f64)> = s
                .polygon()
                .iter()
                .map(|q| (f64::from(q[0]), f64::from(q[1])))
                .collect();
            Polygon::new(LineString::from(ring), vec![])
        })
        .filter(|poly| poly.unsigned_area() > 1e-6)
        .collect();
    if polygons.is_empty() {
        return None;
    }
    let union: MultiPolygon<f64> = geo::unary_union(&polygons);
    let point = Point::new(f64::from(p[0]), f64::from(p[1]));
    // The smallest hole of the wall union that contains the point is the room
    let mut best: Option<(f64, &LineString<f64>)> = None;
    for poly in &union {
        for hole in poly.interiors() {
            let area = Polygon::new(hole.clone(), vec![]);
            if area.contains(&point) {
                let a = area.unsigned_area();
                if best.is_none_or(|(b, _)| a < b) {
                    best = Some((a, hole));
                }
            }
        }
    }
    let (_, ring) = best?;
    let mut pts: Vec<Pt> = ring
        .coords()
        .map(|c| [round_cm(c.x), round_cm(c.y)])
        .collect();
    if pts.len() > 1 && pts.first() == pts.last() {
        pts.pop();
    }
    let pts = without_collinear_points(pts);
    (pts.len() >= 3).then_some(pts)
}

/// Point where the name and area of a room are shown: the area centroid of the
/// polygon, or (for strongly concave rooms whose centroid lies outside) the inner
/// point farthest from the edges. Unlike the center of the bounding box, this keeps
/// the labels of rooms that share a bounding box (e.g. two triangles) apart.
pub fn label_center(polygon: &[Pt]) -> Pt {
    let n = polygon.len();
    if n == 0 {
        return [0.0, 0.0];
    }
    let (mut area, mut cx, mut cy) = (0.0f64, 0.0f64, 0.0f64);
    for i in 0..n {
        let [x0, y0] = polygon[i].map(f64::from);
        let [x1, y1] = polygon[(i + 1) % n].map(f64::from);
        let cross = x0 * y1 - x1 * y0;
        area += cross;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
    }
    let centroid = if area.abs() < 1e-9 {
        let sx: f32 = polygon.iter().map(|p| p[0]).sum();
        let sy: f32 = polygon.iter().map(|p| p[1]).sum();
        [sx / n as f32, sy / n as f32]
    } else {
        [(cx / (3.0 * area)) as f32, (cy / (3.0 * area)) as f32]
    };
    if point_in_polygon(centroid, polygon) {
        return centroid;
    }
    inner_point(polygon).unwrap_or(centroid)
}

/// Default vertical offset of a room name from the area label (name above the area).
pub const DEFAULT_ROOM_NAME_Y_OFFSET: f32 = -40.0;

/// Positions of the name and area labels of a room in the plan.
///
/// A label with a stored offset is placed like Sweet Home 3D does: center of the
/// bounding box plus the offset, so files show the same in both applications. A
/// label without an offset is placed at [`label_center`] (the default name offset
/// keeps the name above the area).
pub fn room_label_positions(room: &Room) -> (Pt, Pt) {
    let polygon: Vec<Pt> = room.points.iter().map(|p| [p.x, p.y]).collect();
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for p in &polygon {
        min_x = min_x.min(p[0]);
        min_y = min_y.min(p[1]);
        max_x = max_x.max(p[0]);
        max_y = max_y.max(p[1]);
    }
    let bbox = [(min_x + max_x) / 2.0, (min_y + max_y) / 2.0];
    let auto = label_center(&polygon);
    let a = &room.attrs;
    let name = if a.name_x_offset.is_some() || a.name_y_offset.is_some() {
        [
            bbox[0] + a.name_x_offset.unwrap_or(0.0),
            bbox[1] + a.name_y_offset.unwrap_or(0.0),
        ]
    } else {
        [auto[0], auto[1] + DEFAULT_ROOM_NAME_Y_OFFSET]
    };
    let area = if a.area_x_offset.is_some() || a.area_y_offset.is_some() {
        [
            bbox[0] + a.area_x_offset.unwrap_or(0.0),
            bbox[1] + a.area_y_offset.unwrap_or(0.0),
        ]
    } else {
        auto
    };
    (name, area)
}

/// Approximate inner point farthest from the edges (grid search with refinement).
fn inner_point(polygon: &[Pt]) -> Option<Pt> {
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for p in polygon {
        min_x = min_x.min(p[0]);
        min_y = min_y.min(p[1]);
        max_x = max_x.max(p[0]);
        max_y = max_y.max(p[1]);
    }
    let edge_distance = |p: Pt| {
        (0..polygon.len())
            .map(|i| segment_distance(p, polygon[i], polygon[(i + 1) % polygon.len()]))
            .fold(f32::MAX, f32::min)
    };
    const STEPS: usize = 24;
    let mut best: Option<(f32, Pt)> = None;
    let (mut x0, mut y0, mut w, mut h) = (min_x, min_y, max_x - min_x, max_y - min_y);
    for _ in 0..3 {
        for i in 0..=STEPS {
            for j in 0..=STEPS {
                let p = [
                    x0 + w * i as f32 / STEPS as f32,
                    y0 + h * j as f32 / STEPS as f32,
                ];
                if !point_in_polygon(p, polygon) {
                    continue;
                }
                let d = edge_distance(p);
                if best.is_none_or(|(b, _)| d > b) {
                    best = Some((d, p));
                }
            }
        }
        // Refine around the best point
        let (_, c) = best?;
        w /= 4.0;
        h /= 4.0;
        x0 = c[0] - w / 2.0;
        y0 = c[1] - h / 2.0;
    }
    best.map(|(_, p)| p)
}

fn segment_distance(p: Pt, a: Pt, b: Pt) -> f32 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 {
        0.0
    } else {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2).clamp(0.0, 1.0)
    };
    dist(p, [a[0] + t * dx, a[1] + t * dy])
}

/// Whether `p` lies inside the polygon (ray casting; the boundary may count either way).
pub fn point_in_polygon(p: Pt, polygon: &[Pt]) -> bool {
    let mut inside = false;
    let n = polygon.len();
    for i in 0..n {
        let a = polygon[i];
        let b = polygon[(i + n - 1) % n];
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            inside = !inside;
        }
    }
    inside
}

/// Rounds to 1/100 cm to hide floating point noise of the polygon union.
fn round_cm(v: f64) -> f32 {
    ((v * 100.0).round() / 100.0) as f32
}

/// Removes duplicate points and points on a straight line between their neighbors.
fn without_collinear_points(mut pts: Vec<Pt>) -> Vec<Pt> {
    loop {
        let n = pts.len();
        if n < 3 {
            return pts;
        }
        let redundant = (0..n).find(|&i| {
            let a = pts[(i + n - 1) % n];
            let b = pts[i];
            let c = pts[(i + 1) % n];
            let cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
            dist(a, b) < 1e-3 || cross.abs() < 1e-2 * dist(a, c).max(1.0)
        });
        match redundant {
            Some(i) => {
                pts.remove(i);
            }
            None => return pts,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use msh_model::WallAttrs;

    fn wall(id: &str, s: Pt, e: Pt, at_start: Option<&str>, at_end: Option<&str>) -> Wall {
        Wall {
            attrs: WallAttrs {
                id: id.into(),
                x_start: s[0],
                y_start: s[1],
                x_end: e[0],
                y_end: e[1],
                thickness: 10.0,
                wall_at_start: at_start.map(Into::into),
                wall_at_end: at_end.map(Into::into),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn approx(a: Pt, b: Pt) -> bool {
        dist(a, b) < 1e-3
    }

    #[test]
    fn straight_wall_without_joins() {
        let w = wall("a", [0.0, 0.0], [100.0, 0.0], None, None);
        let s = wall_shape(&w, &HashMap::new());
        // y axis points down: the left side has negative y
        assert!(approx(s.left[0], [0.0, -5.0]));
        assert!(approx(s.left[1], [100.0, -5.0]));
        assert!(approx(s.right[0], [0.0, 5.0]));
        assert!(approx(s.right[1], [100.0, 5.0]));
    }

    #[test]
    fn corner_joint_is_mitered() {
        // a: (0,0)->(100,0), b: (100,0)->(100,100), a.end = b, b.start = a
        let a = wall("a", [0.0, 0.0], [100.0, 0.0], None, Some("b"));
        let b = wall("b", [100.0, 0.0], [100.0, 100.0], Some("a"), None);
        let by_id: HashMap<&str, &Wall> = [("a", &a), ("b", &b)].into_iter().collect();
        let sa = wall_shape(&a, &by_id);
        let sb = wall_shape(&b, &by_id);
        // Outer corner at (105,-5), inner corner at (95,5)
        assert!(approx(sa.left[1], [105.0, -5.0]), "{:?}", sa.left);
        assert!(approx(sa.right[1], [95.0, 5.0]), "{:?}", sa.right);
        assert!(approx(sb.left[0], [105.0, -5.0]), "{:?}", sb.left);
        assert!(approx(sb.right[0], [95.0, 5.0]), "{:?}", sb.right);
    }

    #[test]
    fn start_to_start_joint() {
        // a: (0,0)->(100,0), b: (0,0)->(0,100), both start at the origin
        let a = wall("a", [0.0, 0.0], [100.0, 0.0], Some("b"), None);
        let b = wall("b", [0.0, 0.0], [0.0, 100.0], Some("a"), None);
        let by_id: HashMap<&str, &Wall> = [("a", &a), ("b", &b)].into_iter().collect();
        let sa = wall_shape(&a, &by_id);
        let sb = wall_shape(&b, &by_id);
        assert!(approx(sa.left[0], [-5.0, -5.0]), "{:?}", sa.left);
        assert!(approx(sa.right[0], [5.0, 5.0]), "{:?}", sa.right);
        assert!(approx(sb.right[0], [-5.0, -5.0]), "{:?}", sb.right);
        assert!(approx(sb.left[0], [5.0, 5.0]), "{:?}", sb.left);
    }

    #[test]
    fn arc_wall_endpoints() {
        let mut w = wall("a", [0.0, 0.0], [100.0, 0.0], None, None);
        w.attrs.arc_extent = Some(std::f32::consts::PI);
        let s = wall_shape(&w, &HashMap::new());
        // Half circle with radius 50: side points lie on radius 50 ± 5 around (50, 0)
        for p in s.left.iter().chain(&s.right) {
            let r = dist(*p, [50.0, 0.0]);
            assert!(
                (r - 45.0).abs() < 1e-2 || (r - 55.0).abs() < 1e-2,
                "r = {r}"
            );
        }
        assert!(s.left.len() > 10);
        // Endpoints of the axis
        assert!(approx(midpoint(s.left[0], s.right[0]), [0.0, 0.0]));
        let n = s.left.len() - 1;
        assert!(approx(midpoint(s.left[n], s.right[n]), [100.0, 0.0]));
    }

    #[test]
    fn enclosed_area_of_a_closed_outline() {
        // Four joined walls around (0,0)-(400,300), 10 cm thick, and a partition at x=200
        let mut home = Home::default();
        let ids = ["a", "b", "c", "d"];
        let pts = [[0.0, 0.0], [400.0, 0.0], [400.0, 300.0], [0.0, 300.0]];
        for i in 0..4 {
            home.walls.push(wall(
                ids[i],
                pts[i],
                pts[(i + 1) % 4],
                Some(ids[(i + 3) % 4]),
                Some(ids[(i + 1) % 4]),
            ));
        }
        home.walls
            .push(wall("e", [200.0, 0.0], [200.0, 300.0], None, None));
        let left = enclosed_area(&home, None, [100.0, 150.0]).expect("room");
        let mut xs: Vec<f32> = left.iter().map(|p| p[0]).collect();
        xs.sort_by(f32::total_cmp);
        assert_eq!(left.len(), 4, "{left:?}");
        assert_eq!((xs[0], xs[3]), (5.0, 195.0));
        let right = enclosed_area(&home, None, [300.0, 150.0]).expect("room");
        assert_eq!(right.len(), 4, "{right:?}");
        // Outside of the walls there is no room
        assert!(enclosed_area(&home, None, [500.0, 150.0]).is_none());
        // An open outline encloses nothing
        home.walls.retain(|w| w.attrs.id != "c");
        assert!(enclosed_area(&home, None, [300.0, 150.0]).is_none());
    }

    #[test]
    fn label_center_separates_triangles_and_stays_inside() {
        // Two triangles that share the bounding box of a square
        let lower = label_center(&[[0.0, 0.0], [300.0, 300.0], [0.0, 300.0]]);
        let upper = label_center(&[[0.0, 0.0], [300.0, 0.0], [300.0, 300.0]]);
        assert!(approx(lower, [100.0, 200.0]), "{lower:?}");
        assert!(approx(upper, [200.0, 100.0]), "{upper:?}");
        // U shape: the centroid lies in the gap, the label point inside the room
        let u = [
            [0.0, 0.0],
            [300.0, 0.0],
            [300.0, 300.0],
            [200.0, 300.0],
            [200.0, 50.0],
            [100.0, 50.0],
            [100.0, 300.0],
            [0.0, 300.0],
        ];
        let c = label_center(&u);
        assert!(point_in_polygon(c, &u), "{c:?}");
    }

    fn midpoint(a: Pt, b: Pt) -> Pt {
        [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]
    }
}
