//! Exports of My Sweet Home.
//!
//! [`plan_svg`] draws the 2D plan of one level as SVG (plan coordinates in cm,
//! y axis down, like Sweet Home 3D). [`svg_to_png`] rasterizes it. Both are
//! used by the `view_plan_image` command, which gives AI agents visual
//! feedback without a running app.

use msh_geometry::{WallShape, wall_shapes};
use msh_model::{Furniture, Home, Piece, PieceKind};
use std::fmt::Write;

/// Options for [`plan_svg`].
#[derive(Debug, Clone)]
pub struct PlanOptions {
    /// Level to draw; `None` draws all elements (homes without levels)
    pub level: Option<String>,
    /// Draw furniture names inside the pieces
    pub furniture_names: bool,
    /// Margin around the content in cm
    pub margin: f32,
}

impl Default for PlanOptions {
    fn default() -> Self {
        Self {
            level: None,
            furniture_names: true,
            margin: 60.0,
        }
    }
}

/// Draws the plan of a home as an SVG document.
pub fn plan_svg(home: &Home, opts: &PlanOptions) -> String {
    let shapes = wall_shapes(home);
    let on_level = |l: &Option<String>| opts.level.is_none() || *l == opts.level;
    let mut pieces: Vec<&Piece> = Vec::new();
    collect_pieces(&home.furniture, &mut pieces);
    pieces.retain(|p| on_level(&p.attrs.level) && p.attrs.is_visible());
    pieces.sort_by(|a, b| {
        a.attrs
            .elevation_or_default()
            .total_cmp(&b.attrs.elevation_or_default())
    });

    // Bounds of all drawn content
    let mut b = Bounds::default();
    for (w, s) in home.walls.iter().zip(&shapes) {
        if on_level(&w.attrs.level) {
            s.polygon().iter().for_each(|p| b.add(p[0], p[1]));
        }
    }
    for r in home.rooms.iter().filter(|r| on_level(&r.attrs.level)) {
        r.points.iter().for_each(|p| b.add(p.x, p.y));
    }
    for p in &pieces {
        piece_corners(p).iter().for_each(|c| b.add(c[0], c[1]));
    }
    for d in home
        .dimension_lines
        .iter()
        .filter(|d| on_level(&d.attrs.level))
    {
        b.add(d.attrs.x_start, d.attrs.y_start);
        b.add(d.attrs.x_end, d.attrs.y_end);
    }
    for l in home.labels.iter().filter(|l| on_level(&l.attrs.level)) {
        b.add(l.attrs.x, l.attrs.y);
    }
    if b.is_empty() {
        b.add(0.0, 0.0);
        b.add(500.0, 400.0);
    }
    let m = opts.margin;
    let (x0, y0) = (b.min_x - m, b.min_y - m - 40.0);
    let (w, h) = (
        b.max_x - b.min_x + 2.0 * m,
        b.max_y - b.min_y + 2.0 * m + 40.0,
    );
    let extent = w.max(h);
    let font = (extent / 60.0).clamp(10.0, 60.0);
    let thin = (extent / 1500.0).max(0.6);

    let mut s = String::with_capacity(32 * 1024);
    let _ = write!(
        s,
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {y0} {w} {h}" width="{w}" height="{h}" font-family="Segoe UI, Arial, sans-serif">"#
    );
    let _ = write!(
        s,
        r##"<rect x="{x0}" y="{y0}" width="{w}" height="{h}" fill="#ffffff"/>"##
    );
    grid(&mut s, x0, y0, w, h, thin);

    // Rooms
    for r in home
        .rooms
        .iter()
        .filter(|r| on_level(&r.attrs.level) && r.points.len() >= 3)
    {
        let pts: Vec<[f32; 2]> = r.points.iter().map(|p| [p.x, p.y]).collect();
        let fill = r
            .attrs
            .floor_color
            .map(|c| format!("#{:06x}", c.0 & 0xFFFFFF))
            .unwrap_or_else(|| "#f1ece2".into());
        let _ = write!(
            s,
            r##"<polygon points="{}" fill="{fill}" fill-opacity="0.45" stroke="#b8b2a6" stroke-width="{thin}"/>"##,
            points(&pts)
        );
    }

    // Furniture except doors and windows
    for p in pieces.iter().filter(|p| p.kind != PieceKind::DoorOrWindow) {
        draw_piece(&mut s, p, opts.furniture_names, font, thin);
    }

    // Walls
    for (wall, shape) in home.walls.iter().zip(&shapes) {
        if on_level(&wall.attrs.level) {
            draw_wall(&mut s, shape, thin);
        }
    }

    // Doors and windows on top of the walls
    for p in pieces.iter().filter(|p| p.kind == PieceKind::DoorOrWindow) {
        draw_door_or_window(&mut s, p, thin);
    }

    // Room names and areas
    for r in home
        .rooms
        .iter()
        .filter(|r| on_level(&r.attrs.level) && r.points.len() >= 3)
    {
        let polygon: Vec<[f32; 2]> = r.points.iter().map(|p| [p.x, p.y]).collect();
        let [cx, cy] = msh_geometry::label_center(&polygon);
        let mut lines = Vec::new();
        if let Some(n) = &r.attrs.name {
            lines.push((escape(n), true));
        }
        if r.attrs.area_visible != Some(false) {
            lines.push((format!("{:.2} m²", r.area() / 10_000.0), false));
        }
        for (i, (text, bold)) in lines.iter().enumerate() {
            let y = cy + (i as f32 - (lines.len() as f32 - 1.0) / 2.0) * font * 1.3;
            let weight = if *bold { "600" } else { "400" };
            let _ = write!(
                s,
                r##"<text x="{cx}" y="{y}" font-size="{font}" font-weight="{weight}" text-anchor="middle" dominant-baseline="middle" fill="#2b2f36">{text}</text>"##
            );
        }
    }

    // Dimension lines
    for d in home
        .dimension_lines
        .iter()
        .filter(|d| on_level(&d.attrs.level))
    {
        let a = &d.attrs;
        let len = (a.x_end - a.x_start).hypot(a.y_end - a.y_start);
        if len == 0.0 {
            continue;
        }
        let (nx, ny) = (
            -(a.y_end - a.y_start) / len * a.offset,
            (a.x_end - a.x_start) / len * a.offset,
        );
        let (sx, sy, ex, ey) = (a.x_start + nx, a.y_start + ny, a.x_end + nx, a.y_end + ny);
        let angle = (a.y_end - a.y_start)
            .atan2(a.x_end - a.x_start)
            .to_degrees();
        let (mx, my) = ((sx + ex) / 2.0, (sy + ey) / 2.0);
        let _ = write!(
            s,
            r##"<g stroke="#2f6fde" stroke-width="{thin}"><line x1="{}" y1="{}" x2="{sx}" y2="{sy}"/><line x1="{}" y1="{}" x2="{ex}" y2="{ey}"/><line x1="{sx}" y1="{sy}" x2="{ex}" y2="{ey}"/></g><text x="{mx}" y="{my}" dy="-{}" font-size="{}" text-anchor="middle" fill="#2f6fde" transform="rotate({angle} {mx} {my})">{}</text>"##,
            a.x_start,
            a.y_start,
            a.x_end,
            a.y_end,
            font * 0.3,
            font * 0.8,
            format_length(len)
        );
    }

    // Labels
    for l in home.labels.iter().filter(|l| on_level(&l.attrs.level)) {
        let size = l.text_style.as_ref().map_or(font, |t| t.font_size);
        for (i, line) in l.text.lines().enumerate() {
            let _ = write!(
                s,
                r##"<text x="{}" y="{}" font-size="{size}" text-anchor="middle" fill="#1c2026">{}</text>"##,
                l.attrs.x,
                l.attrs.y + i as f32 * size * 1.2,
                escape(line)
            );
        }
    }

    // Scale bar (1 m) and orientation hint
    let sbx = x0 + m * 0.5;
    let sby = y0 + h - m * 0.4;
    let _ = write!(
        s,
        r##"<g stroke="#1c2026" stroke-width="{}"><line x1="{sbx}" y1="{sby}" x2="{}" y2="{sby}"/></g><text x="{}" y="{}" font-size="{}" text-anchor="middle" fill="#1c2026">1 m</text>"##,
        thin * 3.0,
        sbx + 100.0,
        sbx + 50.0,
        sby - font * 0.4,
        font * 0.8
    );
    let _ = write!(
        s,
        r##"<text x="{}" y="{}" font-size="{}" fill="#6b7380">x → (cm), y ↓ (cm)</text>"##,
        x0 + m * 0.5,
        y0 + font * 1.2,
        font * 0.8
    );
    s.push_str("</svg>");
    s
}

/// Rasterizes an SVG to PNG with the given pixel width (height keeps the aspect ratio).
pub fn svg_to_png(svg: &str, width_px: u32) -> Result<Vec<u8>, String> {
    use resvg::{tiny_skia, usvg};
    let mut opt = usvg::Options::default();
    opt.fontdb_mut().load_system_fonts();
    let tree = usvg::Tree::from_str(svg, &opt).map_err(|e| e.to_string())?;
    let size = tree.size();
    let scale = width_px as f32 / size.width();
    let height_px = (size.height() * scale).ceil().max(1.0) as u32;
    let mut pixmap =
        tiny_skia::Pixmap::new(width_px.max(1), height_px).ok_or("image size is too large")?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    pixmap.encode_png().map_err(|e| e.to_string())
}

fn collect_pieces<'a>(items: &'a [Furniture], out: &mut Vec<&'a Piece>) {
    for item in items {
        match item {
            Furniture::Piece(p) => out.push(p),
            Furniture::Group(g) => collect_pieces(&g.items, out),
        }
    }
}

fn piece_corners(p: &Piece) -> [[f32; 2]; 4] {
    let a = &p.attrs;
    let (s, c) = a.angle_or_default().sin_cos();
    let (hw, hd) = (a.width / 2.0, a.depth / 2.0);
    [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
        .map(|[x, y]| [a.x + x * c - y * s, a.y + x * s + y * c])
}

fn draw_piece(s: &mut String, p: &Piece, names: bool, font: f32, thin: f32) {
    let a = &p.attrs;
    let fill = if p.kind == PieceKind::Light {
        "#fff6d5"
    } else {
        "#ffffff"
    };
    let _ = write!(
        s,
        r##"<polygon points="{}" fill="{fill}" fill-opacity="0.9" stroke="#4b5058" stroke-width="{thin}"/>"##,
        points(&piece_corners(p))
    );
    if names {
        let size = (a.width.min(a.depth) / 3.0).clamp(6.0, font * 0.7);
        let angle = a.angle_or_default().to_degrees();
        // Keep text readable: never upside down
        let angle = if angle > 90.0 && angle < 270.0 {
            angle - 180.0
        } else {
            angle
        };
        let _ = write!(
            s,
            r##"<text x="{}" y="{}" font-size="{size}" text-anchor="middle" dominant-baseline="middle" fill="#4b5058" transform="rotate({angle} {} {})">{}</text>"##,
            a.x,
            a.y,
            a.x,
            a.y,
            escape(&a.name)
        );
    }
}

fn draw_wall(s: &mut String, shape: &WallShape, thin: f32) {
    let _ = write!(
        s,
        r##"<polygon points="{}" fill="#5f646c" stroke="#30343a" stroke-width="{thin}" stroke-linejoin="miter"/>"##,
        points(&shape.polygon())
    );
}

fn draw_door_or_window(s: &mut String, p: &Piece, thin: f32) {
    let a = &p.attrs;
    let corners = piece_corners(p);
    let _ = write!(
        s,
        r##"<polygon points="{}" fill="#ffffff" stroke="#4b5058" stroke-width="{thin}"/>"##,
        points(&corners)
    );
    let (sin, cos) = a.angle_or_default().sin_cos();
    let mirror = if a.model_mirrored == Some(true) {
        -1.0
    } else {
        1.0
    };
    let to_plan = |lx: f32, ly: f32| {
        [
            a.x + lx * mirror * cos - ly * sin,
            a.y + lx * mirror * sin + ly * cos,
        ]
    };
    for sash in &p.sashes {
        let ax = -a.width / 2.0 + sash.x_axis * a.width;
        let ay = -a.depth / 2.0 + sash.y_axis * a.depth;
        let r = sash.width * a.width;
        // Sash angles follow Java's Arc2D: counter-clockwise on screen, so a point at
        // angle θ lies at (cos θ, −sin θ) in plan coordinates (y down).
        let start = to_plan(
            ax + r * sash.start_angle.cos(),
            ay - r * sash.start_angle.sin(),
        );
        let end = to_plan(ax + r * sash.end_angle.cos(), ay - r * sash.end_angle.sin());
        let axis = to_plan(ax, ay);
        // Arc from the end point back to the start point; SVG sweep 1 = clockwise on screen
        let sweep_ccw = (sash.end_angle > sash.start_angle) ^ (mirror < 0.0);
        let _ = write!(
            s,
            r##"<path d="M{} {} L{} {} A{r} {r} 0 0 {} {} {}" fill="none" stroke="#4b5058" stroke-width="{thin}"/>"##,
            axis[0],
            axis[1],
            end[0],
            end[1],
            if sweep_ccw { 1 } else { 0 },
            start[0],
            start[1]
        );
    }
}

fn grid(s: &mut String, x0: f32, y0: f32, w: f32, h: f32, thin: f32) {
    let step = 100.0;
    let mut d = String::new();
    let mut x = (x0 / step).ceil() * step;
    while x < x0 + w {
        let _ = write!(d, "M{x} {y0}V{}", y0 + h);
        x += step;
    }
    let mut y = (y0 / step).ceil() * step;
    while y < y0 + h {
        let _ = write!(d, "M{x0} {y}H{}", x0 + w);
        y += step;
    }
    let _ = write!(
        s,
        r##"<path d="{d}" stroke="#eef0f3" stroke-width="{thin}"/>"##
    );
}

fn points(pts: &[[f32; 2]]) -> String {
    pts.iter()
        .map(|p| format!("{},{}", p[0], p[1]))
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_length(cm: f32) -> String {
    if cm >= 100.0 {
        format!("{:.2} m", cm / 100.0)
    } else {
        format!("{cm:.1} cm")
    }
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[derive(Default)]
struct Bounds {
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    set: bool,
}

impl Bounds {
    fn add(&mut self, x: f32, y: f32) {
        if !self.set {
            (self.min_x, self.min_y, self.max_x, self.max_y, self.set) = (x, y, x, y, true);
        } else {
            self.min_x = self.min_x.min(x);
            self.min_y = self.min_y.min(y);
            self.max_x = self.max_x.max(x);
            self.max_y = self.max_y.max(y);
        }
    }

    fn is_empty(&self) -> bool {
        !self.set
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use msh_model::{Wall, WallAttrs};

    #[test]
    fn plan_of_one_wall_renders_to_png() {
        let home = Home {
            walls: vec![Wall {
                attrs: WallAttrs {
                    id: "w".into(),
                    x_end: 400.0,
                    thickness: 20.0,
                    ..Default::default()
                },
                ..Default::default()
            }],
            ..Default::default()
        };
        let svg = plan_svg(&home, &PlanOptions::default());
        assert!(svg.contains("<polygon"));
        let png = svg_to_png(&svg, 400).unwrap();
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']));
    }
}
