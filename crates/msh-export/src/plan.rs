//! The 2D plan of one level as SVG, drawn like the plan of the app (and of
//! Sweet Home 3D): rooms with floor colors or textures, furniture icons, walls
//! with their patterns, doors and windows with sashes, polylines, dimensions,
//! labels and the compass.

use msh_geometry::wall_shapes;
use msh_model::{Color, Furniture, Home, Piece, PieceKind, TextStyle};
use std::collections::HashMap;
use std::fmt::Write;

/// Options for [`plan_svg`].
#[derive(Debug, Clone)]
pub struct PlanOptions {
    /// Level to draw; `None` draws all elements (homes without levels)
    pub level: Option<String>,
    /// Names of all pieces (visual feedback for agents); otherwise only the names
    /// shown in the plan (`nameVisible`)
    pub furniture_names: bool,
    /// Background grid with 1 m steps
    pub grid: bool,
    /// Axis directions in the top left corner
    pub axis_hint: bool,
    /// 1 m scale bar in the bottom left corner
    pub scale_bar: bool,
    /// Margin around the content in cm
    pub margin: f32,
    /// Images of icons and floor textures by resource name (see [`plan_images`]);
    /// missing images are drawn as plain shapes
    pub images: HashMap<String, Vec<u8>>,
}

impl Default for PlanOptions {
    /// Visual feedback for agents: grid, all furniture names, axis hint and scale bar.
    fn default() -> Self {
        Self {
            level: None,
            furniture_names: true,
            grid: true,
            axis_hint: true,
            scale_bar: true,
            margin: 60.0,
            images: HashMap::new(),
        }
    }
}

impl PlanOptions {
    /// Plan as exported or printed: only what the plan of the app shows.
    pub fn export(level: Option<String>) -> Self {
        Self {
            level,
            furniture_names: false,
            grid: false,
            axis_hint: false,
            scale_bar: false,
            margin: 30.0,
            images: HashMap::new(),
        }
    }
}

const BACKGROUND: &str = "#ffffff";
const GRID: &str = "#eef0f3";
const WALL_FILL: &str = "#6b6f76";
const WALL_STROKE: &str = "#3a3d42";
const ROOM_FILL: &str = "#808080";
const ROOM_STROKE: &str = "#4b5058";
const FURNITURE_STROKE: &str = "#4b5058";
const TEXT: &str = "#1c2026";
const DIMENSION: &str = "#2f6fde";
/// Opacity of room floors, as in Sweet Home 3D
const ROOM_ALPHA: f32 = 0.75;
const DEFAULT_WALL_PATTERN: &str = "hatchUp";
const DEFAULT_ROOM_FONT: f32 = 24.0;
const DEFAULT_LABEL_FONT: f32 = 18.0;
const DEFAULT_DIMENSION_FONT: f32 = 18.0;
const DEFAULT_PIECE_FONT: f32 = 18.0;
const FONT_FAMILY: &str = "Segoe UI, Arial, sans-serif";

/// A drawn plan: SVG elements in plan coordinates (cm, y down) and their bounds.
pub struct PlanDrawing {
    /// `<defs>` and drawing elements, without the surrounding `<svg>`
    pub body: String,
    /// Bounds including the margin: x, y, width, height in cm
    pub view_box: [f32; 4],
}

/// Draws the plan of a home as an SVG document (1 user unit = 1 cm).
pub fn plan_svg(home: &Home, opts: &PlanOptions) -> String {
    let d = draw_plan(home, opts);
    let [x0, y0, w, h] = d.view_box;
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="{x0} {y0} {w} {h}" width="{w}" height="{h}" font-family="{FONT_FAMILY}">{}</svg>"#,
        d.body
    )
}

/// Resource names of the images the plan of a level can show (icons, floor textures).
pub fn plan_images(home: &Home, level: Option<&str>) -> Vec<String> {
    let on_level = |l: &Option<String>| level.is_none() || l.as_deref() == level;
    let mut names = Vec::new();
    let mut pieces = Vec::new();
    collect_pieces(&home.furniture, &mut pieces);
    for p in pieces.iter().filter(|p| on_level(&p.attrs.level)) {
        names.extend(p.attrs.plan_icon.clone().or_else(|| p.attrs.icon.clone()));
        if p.kind == PieceKind::DoorOrWindow && p.sashes.is_empty() {
            names.extend(p.attrs.icon.clone());
        }
    }
    for r in home.rooms.iter().filter(|r| on_level(&r.attrs.level)) {
        names.extend(floor_texture(r).map(|t| t.image.clone()));
    }
    names.sort();
    names.dedup();
    names
}

/// Draws the plan elements of a level (see [`PlanDrawing`]).
pub fn draw_plan(home: &Home, opts: &PlanOptions) -> PlanDrawing {
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
    for pl in home.polylines.iter().filter(|p| on_level(&p.attrs.level)) {
        pl.points.iter().for_each(|p| b.add(p.x, p.y));
    }
    for p in &pieces {
        piece_corners(p).iter().for_each(|c| b.add(c[0], c[1]));
    }
    for d in home
        .dimension_lines
        .iter()
        .filter(|d| on_level(&d.attrs.level))
    {
        let a = &d.attrs;
        let (nx, ny) = dimension_normal(a.x_start, a.y_start, a.x_end, a.y_end, a.offset);
        b.add(a.x_start, a.y_start);
        b.add(a.x_end, a.y_end);
        b.add(a.x_start + nx, a.y_start + ny);
        b.add(a.x_end + nx, a.y_end + ny);
    }
    for l in home.labels.iter().filter(|l| on_level(&l.attrs.level)) {
        b.add(l.attrs.x, l.attrs.y);
    }
    let compass = home
        .compass
        .as_ref()
        .map(|c| &c.attrs)
        .filter(|c| c.visible != Some(false));
    if let Some(c) = compass {
        let r = c.diameter / 2.0;
        b.add(c.x - r, c.y - r * 1.4);
        b.add(c.x + r, c.y + r);
    }
    if b.is_empty() {
        b.add(0.0, 0.0);
        b.add(500.0, 400.0);
    }
    let m = opts.margin;
    // Room for the axis hint above the content
    let top = if opts.axis_hint { 40.0 } else { 0.0 };
    let (x0, y0) = (b.min_x - m, b.min_y - m - top);
    let (w, h) = (
        b.max_x - b.min_x + 2.0 * m,
        b.max_y - b.min_y + 2.0 * m + top,
    );
    let extent = w.max(h);
    let thin = (extent / 1500.0).max(0.6);

    let mut s = String::with_capacity(64 * 1024);
    let mut defs = Defs::default();
    let _ = write!(
        s,
        r#"<rect x="{x0}" y="{y0}" width="{w}" height="{h}" fill="{BACKGROUND}"/>"#
    );
    if opts.grid {
        grid(&mut s, x0, y0, w, h, thin);
    }

    // Rooms: floor color or texture, 75 % opaque
    for r in home
        .rooms
        .iter()
        .filter(|r| on_level(&r.attrs.level) && r.points.len() >= 3)
    {
        let pts: Vec<[f32; 2]> = r.points.iter().map(|p| [p.x, p.y]).collect();
        let fill = if r.attrs.floor_visible == Some(false) {
            "none".to_string()
        } else if let Some(id) = floor_texture(r).and_then(|t| defs.texture(t, &opts.images)) {
            format!("url(#{id})")
        } else {
            r.attrs
                .floor_color
                .map(css_color)
                .unwrap_or_else(|| ROOM_FILL.into())
        };
        let _ = write!(
            s,
            r#"<polygon points="{}" fill="{fill}" fill-opacity="{ROOM_ALPHA}" stroke="{ROOM_STROKE}" stroke-width="{thin}"/>"#,
            points(&pts)
        );
    }

    // Polylines
    for pl in home
        .polylines
        .iter()
        .filter(|p| on_level(&p.attrs.level) && p.points.len() >= 2)
    {
        let a = &pl.attrs;
        let pts: Vec<[f32; 2]> = pl.points.iter().map(|p| [p.x, p.y]).collect();
        let width = a.thickness.unwrap_or(1.0).max(thin);
        let color = a.color.map(css_color).unwrap_or_else(|| TEXT.into());
        let dash = dash_array(a.dash_style.as_deref(), width);
        let tag = if a.closed_path == Some(true) {
            "polygon"
        } else {
            "polyline"
        };
        let _ = write!(
            s,
            r#"<{tag} points="{}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"{dash}/>"#,
            points(&pts)
        );
        if a.closed_path != Some(true) {
            let n = pts.len();
            arrow(
                &mut s,
                a.start_arrow_style.as_deref(),
                pts[1],
                pts[0],
                width,
                &color,
            );
            arrow(
                &mut s,
                a.end_arrow_style.as_deref(),
                pts[n - 2],
                pts[n - 1],
                width,
                &color,
            );
        }
    }

    // Furniture except doors and windows (below the walls)
    for p in pieces.iter().filter(|p| p.kind != PieceKind::DoorOrWindow) {
        draw_piece(&mut s, &mut defs, p, &opts.images, thin);
    }

    // Walls as one area: all outlines with double width first, then all fills, so
    // lines inside overlapping walls disappear
    let walls: Vec<(String, &str)> = home
        .walls
        .iter()
        .zip(&shapes)
        .filter(|(w, _)| on_level(&w.attrs.level))
        .map(|(w, shape)| {
            (
                points(&shape.polygon()),
                w.attrs.pattern.as_deref().unwrap_or(DEFAULT_WALL_PATTERN),
            )
        })
        .collect();
    let tile = (extent / 120.0).clamp(4.0, 25.0);
    for (pts, _) in &walls {
        let _ = write!(
            s,
            r#"<polygon points="{pts}" fill="none" stroke="{WALL_STROKE}" stroke-width="{}" stroke-linejoin="round"/>"#,
            thin * 3.0
        );
    }
    for (pts, pattern) in &walls {
        let fill = defs.wall_pattern(pattern, tile, thin);
        let _ = write!(s, r#"<polygon points="{pts}" fill="{fill}"/>"#);
    }

    // Doors and windows on top of the walls
    for p in pieces.iter().filter(|p| p.kind == PieceKind::DoorOrWindow) {
        draw_door_or_window(&mut s, &mut defs, p, &opts.images, thin);
    }

    // Room names and areas
    for r in home
        .rooms
        .iter()
        .filter(|r| on_level(&r.attrs.level) && r.points.len() >= 3)
    {
        let (name_at, area_at) = msh_geometry::room_label_positions(r);
        let style = |role: &str| {
            r.text_styles
                .iter()
                .find(|t| t.role.as_deref() == Some(role))
        };
        if let Some(n) = &r.attrs.name {
            text(
                &mut s,
                n,
                name_at,
                r.attrs.name_angle.unwrap_or(0.0),
                style("nameStyle"),
                DEFAULT_ROOM_FONT,
                TEXT,
            );
        }
        if r.attrs.area_visible == Some(true) {
            text(
                &mut s,
                &format!("{:.2} m\u{b2}", r.area() / 10_000.0),
                area_at,
                r.attrs.area_angle.unwrap_or(0.0),
                style("areaStyle"),
                DEFAULT_ROOM_FONT,
                TEXT,
            );
        }
    }

    // Furniture names
    for p in &pieces {
        let a = &p.attrs;
        if !(opts.furniture_names || a.name_visible == Some(true)) {
            continue;
        }
        let at = [
            a.x + a.name_x_offset.unwrap_or(0.0),
            a.y + a.name_y_offset.unwrap_or(0.0),
        ];
        let default = if opts.furniture_names && a.name_visible != Some(true) {
            // Names of all pieces: small enough to stay inside the piece
            (a.width.min(a.depth) / 3.0).clamp(6.0, DEFAULT_PIECE_FONT)
        } else {
            DEFAULT_PIECE_FONT
        };
        text(
            &mut s,
            &a.name,
            at,
            a.name_angle.unwrap_or(0.0),
            p.text_style.as_ref(),
            default,
            FURNITURE_STROKE,
        );
    }

    // Dimension lines
    for d in home
        .dimension_lines
        .iter()
        .filter(|d| on_level(&d.attrs.level))
    {
        draw_dimension(&mut s, d, thin);
    }

    // Labels: the last line sits on the label point, earlier lines above it
    for l in home.labels.iter().filter(|l| on_level(&l.attrs.level)) {
        let size = l
            .text_style
            .as_ref()
            .map_or(DEFAULT_LABEL_FONT, |t| t.font_size);
        let color = l.attrs.color.map(css_color).unwrap_or_else(|| TEXT.into());
        let lines: Vec<&str> = l.text.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            let dy = (i as f32 - (lines.len() as f32 - 1.0)) * size * 1.2;
            text(
                &mut s,
                line,
                [l.attrs.x, l.attrs.y + dy],
                l.attrs.angle.unwrap_or(0.0),
                l.text_style.as_ref(),
                DEFAULT_LABEL_FONT,
                &color,
            );
        }
    }

    if let Some(c) = compass {
        draw_compass(
            &mut s,
            c.x,
            c.y,
            c.diameter,
            c.north_direction.unwrap_or(0.0),
            thin,
        );
    }

    let font = (extent / 60.0).clamp(10.0, 60.0);
    if opts.scale_bar {
        let sbx = x0 + m * 0.5;
        let sby = y0 + h - m * 0.4;
        let _ = write!(
            s,
            r#"<line x1="{sbx}" y1="{sby}" x2="{}" y2="{sby}" stroke="{TEXT}" stroke-width="{}"/><text x="{}" y="{}" font-size="{}" text-anchor="middle" fill="{TEXT}">1 m</text>"#,
            sbx + 100.0,
            thin * 3.0,
            sbx + 50.0,
            sby - font * 0.4,
            font * 0.8
        );
    }
    if opts.axis_hint {
        let _ = write!(
            s,
            r##"<text x="{}" y="{}" font-size="{}" fill="#6b7380">x &#8594; (cm), y &#8595; (cm)</text>"##,
            x0 + m * 0.5,
            y0 + font * 1.2,
            font * 0.8
        );
    }

    PlanDrawing {
        body: format!("<defs>{}</defs>{s}", defs.out),
        view_box: [x0, y0, w, h],
    }
}

// ---------------------------------------------------------------- elements

fn draw_piece(
    s: &mut String,
    defs: &mut Defs,
    p: &Piece,
    images: &HashMap<String, Vec<u8>>,
    thin: f32,
) {
    let a = &p.attrs;
    // Footprint after pitch / roll (e.g. tilted roof panels)
    let w = a.width_in_plan.unwrap_or(a.width);
    let d = a.depth_in_plan.unwrap_or(a.depth);
    let _ = write!(
        s,
        r#"<g transform="translate({} {}) rotate({})">"#,
        a.x,
        a.y,
        a.angle_or_default().to_degrees()
    );
    let icon = a.plan_icon.as_ref().or(a.icon.as_ref());
    match icon.and_then(|i| defs.image(i, images)) {
        Some(href) => {
            let mirror = if a.model_mirrored == Some(true) {
                r#" transform="scale(-1 1)""#
            } else {
                ""
            };
            // The icon keeps its aspect ratio inside the piece rectangle
            let _ = write!(
                s,
                r#"<image x="{}" y="{}" width="{w}" height="{d}" preserveAspectRatio="xMidYMid meet" xlink:href="{href}"{mirror}/>"#,
                -w / 2.0,
                -d / 2.0
            );
        }
        None => {
            let fill = if p.kind == PieceKind::Light {
                "#fff6d5"
            } else {
                "#ffffff"
            };
            let _ = write!(
                s,
                r#"<rect x="{}" y="{}" width="{w}" height="{d}" fill="{fill}" fill-opacity="0.6"/>"#,
                -w / 2.0,
                -d / 2.0
            );
        }
    }
    let _ = write!(
        s,
        r#"<rect x="{}" y="{}" width="{w}" height="{d}" fill="none" stroke="{FURNITURE_STROKE}" stroke-width="{thin}"/></g>"#,
        -w / 2.0,
        -d / 2.0
    );
}

fn draw_door_or_window(
    s: &mut String,
    defs: &mut Defs,
    p: &Piece,
    images: &HashMap<String, Vec<u8>>,
    thin: f32,
) {
    let a = &p.attrs;
    let (w, d) = (a.width, a.depth);
    let mirror = if a.model_mirrored == Some(true) {
        " scale(-1 1)"
    } else {
        ""
    };
    let _ = write!(
        s,
        r#"<g transform="translate({} {}) rotate({}){mirror}" stroke="{FURNITURE_STROKE}" stroke-width="{thin}"><rect x="{}" y="{}" width="{w}" height="{d}" fill="{BACKGROUND}"/>"#,
        a.x,
        a.y,
        a.angle_or_default().to_degrees(),
        -w / 2.0,
        -d / 2.0
    );
    for sash in &p.sashes {
        let ax = -w / 2.0 + sash.x_axis * w;
        let ay = -d / 2.0 + sash.y_axis * d;
        let r = sash.width * w;
        // Sash angles follow Java's Arc2D: counter-clockwise on screen, so a point at
        // angle a lies at (cos a, -sin a) with the y axis down
        let start = [
            ax + r * sash.start_angle.cos(),
            ay - r * sash.start_angle.sin(),
        ];
        let end = [ax + r * sash.end_angle.cos(), ay - r * sash.end_angle.sin()];
        let large = if (sash.end_angle - sash.start_angle).abs() > std::f32::consts::PI {
            1
        } else {
            0
        };
        // From the end point back to the start point; sweep 1 = clockwise on screen
        let sweep = if sash.end_angle > sash.start_angle {
            1
        } else {
            0
        };
        let _ = write!(
            s,
            r#"<path d="M{ax} {ay}L{} {}A{r} {r} 0 {large} {sweep} {} {}" fill="none"/>"#,
            end[0], end[1], start[0], start[1]
        );
    }
    if p.sashes.is_empty()
        && let Some(href) = a.icon.as_ref().and_then(|i| defs.image(i, images))
    {
        let _ = write!(
            s,
            r#"<image x="{}" y="{}" width="{w}" height="{d}" preserveAspectRatio="none" xlink:href="{href}"/>"#,
            -w / 2.0,
            -d / 2.0
        );
    }
    s.push_str("</g>");
}

fn draw_dimension(s: &mut String, dl: &msh_model::DimensionLine, thin: f32) {
    let a = &dl.attrs;
    let length = (a.x_end - a.x_start).hypot(a.y_end - a.y_start);
    if length == 0.0 {
        return;
    }
    let angle = (a.y_end - a.y_start)
        .atan2(a.x_end - a.x_start)
        .to_degrees();
    let color = a.color.map(css_color).unwrap_or_else(|| DIMENSION.into());
    let off = a.offset;
    let sign = if off < 0.0 { -1.0 } else { 1.0 };
    let ext = off + sign * 5.0;
    let size = dl
        .text_style
        .as_ref()
        .map_or(DEFAULT_DIMENSION_FONT, |t| t.font_size);
    // The text sits on the outer side of the dimension line
    let (ty, baseline) = if off > 0.0 {
        (off + size * 0.15, "hanging")
    } else {
        (off - size * 0.15, "auto")
    };
    let _ = write!(
        s,
        r#"<g transform="translate({} {}) rotate({angle})"><path d="M0 0V{ext}M{length} 0V{ext}M0 {off}H{length}M-5 {}L5 {}M{} {}L{} {}" stroke="{color}" stroke-width="{thin}" fill="none"/>"#,
        a.x_start,
        a.y_start,
        off + 5.0,
        off - 5.0,
        length - 5.0,
        off + 5.0,
        length + 5.0,
        off - 5.0
    );
    let _ = write!(
        s,
        r#"<text x="{}" y="{ty}" text-anchor="middle" dominant-baseline="{baseline}" fill="{color}"{}>{}</text></g>"#,
        length / 2.0,
        font_attrs(dl.text_style.as_ref(), DEFAULT_DIMENSION_FONT),
        format_length(length)
    );
}

fn draw_compass(s: &mut String, x: f32, y: f32, diameter: f32, north: f32, thin: f32) {
    let r = diameter / 2.0;
    let _ = write!(
        s,
        r#"<g transform="translate({x} {y}) rotate({})"><circle r="{r}" fill="none" stroke="{TEXT}" stroke-width="{thin}"/><path d="M0 {}L{} {}L0 {}L{} {}Z" fill="{TEXT}"/><text y="{}" font-size="{}" text-anchor="middle" fill="{TEXT}">N</text></g>"#,
        north.to_degrees(),
        -r,
        r * 0.3,
        r * 0.5,
        r * 0.3,
        -r * 0.3,
        r * 0.5,
        -r * 1.1,
        r * 0.5
    );
}

/// Text centered (or aligned by its style) on `at`, baseline on the point.
fn text(
    s: &mut String,
    value: &str,
    at: [f32; 2],
    angle: f32,
    style: Option<&TextStyle>,
    default_size: f32,
    color: &str,
) {
    let anchor = match style.and_then(|t| t.alignment.as_deref()) {
        Some("LEFT") => "start",
        Some("RIGHT") => "end",
        _ => "middle",
    };
    let rotate = if angle != 0.0 {
        format!(
            r#" transform="rotate({} {} {})""#,
            angle.to_degrees(),
            at[0],
            at[1]
        )
    } else {
        String::new()
    };
    let _ = write!(
        s,
        r#"<text x="{}" y="{}" text-anchor="{anchor}" fill="{color}"{}{rotate}>{}</text>"#,
        at[0],
        at[1],
        font_attrs(style, default_size),
        escape(value)
    );
}

fn font_attrs(style: Option<&TextStyle>, default_size: f32) -> String {
    let mut a = format!(
        r#" font-size="{}""#,
        style.map_or(default_size, |t| t.font_size)
    );
    if let Some(t) = style {
        if let Some(f) = &t.font_name {
            let _ = write!(a, r#" font-family="{}, {FONT_FAMILY}""#, escape(f));
        }
        if t.bold == Some(true) {
            a.push_str(r#" font-weight="bold""#);
        }
        if t.italic == Some(true) {
            a.push_str(r#" font-style="italic""#);
        }
    }
    a
}

/// Arrow head of a polyline at `tip`, pointing from `from` to `tip` (as in Sweet Home 3D).
fn arrow(
    s: &mut String,
    style: Option<&str>,
    from: [f32; 2],
    tip: [f32; 2],
    width: f32,
    color: &str,
) {
    let Some(style) = style.filter(|s| *s != "NONE") else {
        return;
    };
    let scale = width.powf(0.66) * 2.0;
    let angle = (tip[1] - from[1]).atan2(tip[0] - from[0]).to_degrees();
    let _ = write!(
        s,
        r#"<g transform="translate({} {}) rotate({angle}) scale({scale})">"#,
        tip[0], tip[1]
    );
    let stroke = width / scale;
    match style {
        "DISC" => {
            let _ = write!(s, r#"<circle cx="-1.5" r="1.5" fill="{color}"/>"#);
        }
        "DELTA" => {
            let _ = write!(s, r#"<path d="M-5 -2L0 0L-5 2Z" fill="{color}"/>"#);
        }
        _ => {
            let _ = write!(
                s,
                r#"<path d="M-5 -2L0 0L-5 2" fill="none" stroke="{color}" stroke-width="{stroke}"/>"#
            );
        }
    }
    s.push_str("</g>");
}

fn dash_array(style: Option<&str>, w: f32) -> String {
    let d: &[f32] = match style {
        Some("DOT") => &[1.0, 2.0],
        Some("DASH") => &[4.0, 2.0],
        Some("DASH_DOT") => &[4.0, 2.0, 1.0, 2.0],
        Some("DASH_DOT_DOT") => &[4.0, 2.0, 1.0, 2.0, 1.0, 2.0],
        _ => return String::new(),
    };
    let values: Vec<String> = d.iter().map(|v| (v * w).to_string()).collect();
    format!(r#" stroke-dasharray="{}""#, values.join(" "))
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
        r#"<path d="{d}" stroke="{GRID}" stroke-width="{thin}"/>"#
    );
}

// ---------------------------------------------------------------- definitions

/// Patterns and embedded images, each written once.
#[derive(Default)]
struct Defs {
    out: String,
    ids: HashMap<String, String>,
    /// Data URIs of images by resource name (`None`: not available)
    images: HashMap<String, Option<String>>,
}

impl Defs {
    fn image(&mut self, name: &str, images: &HashMap<String, Vec<u8>>) -> Option<String> {
        self.images
            .entry(name.to_string())
            .or_insert_with(|| images.get(name).and_then(|b| data_uri(b)))
            .clone()
    }

    fn texture(
        &mut self,
        t: &msh_model::Texture,
        images: &HashMap<String, Vec<u8>>,
    ) -> Option<String> {
        let key = format!(
            "tex|{}|{}|{}|{:?}|{:?}",
            t.image, t.width, t.height, t.angle, t.scale
        );
        if let Some(id) = self.ids.get(&key) {
            return Some(id.clone());
        }
        let href = self.image(&t.image, images)?;
        let id = format!("t{}", self.ids.len());
        let scale = t.scale.unwrap_or(1.0);
        let (tw, th) = (t.width * scale, t.height * scale);
        let _ = write!(
            self.out,
            r#"<pattern id="{id}" patternUnits="userSpaceOnUse" width="{tw}" height="{th}" patternTransform="rotate({})"><image width="{tw}" height="{th}" preserveAspectRatio="none" xlink:href="{href}"/></pattern>"#,
            t.angle.unwrap_or(0.0).to_degrees()
        );
        self.ids.insert(key, id.clone());
        Some(id)
    }

    /// Fill of a wall pattern (Sweet Home 3D's hatch patterns), as `url(#…)` or a color.
    fn wall_pattern(&mut self, name: &str, tile: f32, thin: f32) -> String {
        if name == "foreground" {
            return WALL_FILL.into();
        }
        let up = matches!(name, "hatchUp" | "reversedHatchUp" | "crossHatch");
        let down = matches!(name, "hatchDown" | "reversedHatchDown" | "crossHatch");
        if !up && !down {
            return if name == "background" {
                BACKGROUND.into()
            } else {
                WALL_FILL.into()
            };
        }
        let key = format!("wall|{name}");
        if let Some(id) = self.ids.get(&key) {
            return format!("url(#{id})");
        }
        let id = format!("w{}", self.ids.len());
        let reversed = name.starts_with("reversed");
        let (bg, fg) = if reversed {
            (WALL_STROKE, BACKGROUND)
        } else {
            (BACKGROUND, WALL_STROKE)
        };
        let t = tile;
        let mut d = String::new();
        // Diagonals across the neighbouring tiles too, so that lines join seamlessly
        for o in [-t, 0.0, t] {
            if up {
                let _ = write!(d, "M{o} {t}L{} 0", o + t);
            }
            if down {
                let _ = write!(d, "M{o} 0L{} {t}", o + t);
            }
        }
        let _ = write!(
            self.out,
            r#"<pattern id="{id}" patternUnits="userSpaceOnUse" width="{t}" height="{t}"><rect width="{t}" height="{t}" fill="{bg}"/><path d="{d}" stroke="{fg}" stroke-width="{}"/></pattern>"#,
            thin * 1.2
        );
        self.ids.insert(key, id.clone());
        format!("url(#{id})")
    }
}

/// Data URI of a PNG, JPEG, GIF or BMP image (other content is not embedded).
fn data_uri(bytes: &[u8]) -> Option<String> {
    use base64::Engine;
    let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else {
        return None;
    };
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

// ---------------------------------------------------------------- helpers

fn floor_texture(r: &msh_model::Room) -> Option<&msh_model::Texture> {
    r.textures
        .iter()
        .find(|t| t.role.as_deref() == Some("floorTexture"))
}

pub(crate) fn collect_pieces<'a>(items: &'a [Furniture], out: &mut Vec<&'a Piece>) {
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
    let (hw, hd) = (
        a.width_in_plan.unwrap_or(a.width) / 2.0,
        a.depth_in_plan.unwrap_or(a.depth) / 2.0,
    );
    [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
        .map(|[x, y]| [a.x + x * c - y * s, a.y + x * s + y * c])
}

fn dimension_normal(xs: f32, ys: f32, xe: f32, ye: f32, offset: f32) -> (f32, f32) {
    let len = (xe - xs).hypot(ye - ys).max(1e-6);
    (-(ye - ys) / len * offset, (xe - xs) / len * offset)
}

fn css_color(c: Color) -> String {
    format!("#{:06x}", c.0 & 0xFF_FFFF)
}

fn points(pts: &[[f32; 2]]) -> String {
    pts.iter()
        .map(|p| format!("{},{}", p[0], p[1]))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Length in Sweet Home 3D's default unit format.
pub fn format_length(cm: f32) -> String {
    if cm >= 100.0 {
        format!("{:.2} m", cm / 100.0)
    } else {
        format!("{cm:.1} cm")
    }
}

pub(crate) fn escape(s: &str) -> String {
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
