//! The plan of a level as DXF drawing (AutoCAD R12 format, readable by about every CAD
//! program): walls, rooms, furniture, doors and windows, stairs, roofs, floor openings,
//! dimensions, texts, lines and the compass, each kind on a layer of its own. The y axis
//! points up as usual in CAD (the plan's points down).

use crate::dimension::{EndMark, dimension_style};
use crate::plan::{
    ARROW, DOT, MARK, collect_pieces, dimension_font, opening_outline, piece_corners, roof_lines,
    stair_symbol,
};
use msh_geometry::wall_shapes;
use msh_model::{Home, Piece, PieceKind};
use std::fmt::Write;

/// Unit of the drawing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DxfUnit {
    #[default]
    Millimeter,
    Centimeter,
    Meter,
}

impl DxfUnit {
    /// Unit by name: "mm", "cm" or "m".
    pub fn by_name(name: &str) -> Option<DxfUnit> {
        match name.trim().to_ascii_lowercase().as_str() {
            "mm" | "millimeter" | "millimeters" => Some(DxfUnit::Millimeter),
            "cm" | "centimeter" | "centimeters" => Some(DxfUnit::Centimeter),
            "m" | "meter" | "meters" => Some(DxfUnit::Meter),
            _ => None,
        }
    }

    /// Drawing units per cm of the plan.
    fn per_cm(self) -> f64 {
        match self {
            DxfUnit::Millimeter => 10.0,
            DxfUnit::Centimeter => 1.0,
            DxfUnit::Meter => 0.01,
        }
    }

    /// Value of `$INSUNITS`.
    fn code(self) -> u8 {
        match self {
            DxfUnit::Millimeter => 4,
            DxfUnit::Centimeter => 5,
            DxfUnit::Meter => 6,
        }
    }
}

/// Layers of the drawing with their color (AutoCAD color index).
pub const LAYERS: [(&str, u8); 12] = [
    ("WALLS", 7),
    ("ROOMS", 8),
    ("ROOM_NAMES", 7),
    ("FURNITURE", 3),
    ("DOORS_WINDOWS", 4),
    ("STAIRS", 6),
    ("ROOFS", 30),
    ("OPENINGS", 1),
    ("DIMENSIONS", 5),
    ("TEXTS", 7),
    ("LINES", 7),
    ("COMPASS", 7),
];

const ROOM_FONT: f32 = 24.0;
const LABEL_FONT: f32 = 18.0;

/// Writes group codes and values.
struct Writer {
    out: String,
    per_cm: f64,
}

impl Writer {
    fn pair(&mut self, code: i32, value: &str) {
        let _ = write!(self.out, "{code}\n{value}\n");
    }

    fn number(&mut self, code: i32, v: f64) {
        let mut text = format!("{v:.4}");
        if text.contains('.') {
            text = text.trim_end_matches('0').trim_end_matches('.').to_string();
        }
        if text == "-0" {
            text = "0".into();
        }
        self.pair(code, &text);
    }

    /// A point of the plan (cm, y down) in drawing units with the y axis up.
    fn point(&mut self, code: i32, p: [f32; 2]) {
        self.number(code, f64::from(p[0]) * self.per_cm);
        self.number(code + 10, -f64::from(p[1]) * self.per_cm);
        self.number(code + 20, 0.0);
    }

    fn line(&mut self, layer: &str, a: [f32; 2], b: [f32; 2]) {
        self.pair(0, "LINE");
        self.pair(8, layer);
        self.point(10, a);
        self.point(11, b);
    }

    fn polyline(&mut self, layer: &str, points: &[[f32; 2]], closed: bool) {
        if points.len() < 2 {
            return;
        }
        self.pair(0, "POLYLINE");
        self.pair(8, layer);
        self.pair(66, "1");
        self.point(10, [0.0, 0.0]);
        self.pair(70, if closed { "1" } else { "0" });
        for p in points {
            self.pair(0, "VERTEX");
            self.pair(8, layer);
            self.point(10, *p);
        }
        self.pair(0, "SEQEND");
        self.pair(8, layer);
    }

    fn circle(&mut self, layer: &str, center: [f32; 2], radius: f32) {
        self.pair(0, "CIRCLE");
        self.pair(8, layer);
        self.point(10, center);
        self.number(40, f64::from(radius) * self.per_cm);
    }

    /// A text centered on `at` (baseline through it); `angle` in radians clockwise in the
    /// plan, `size` in cm.
    fn text(&mut self, layer: &str, at: [f32; 2], size: f32, angle: f32, value: &str) {
        let value = encode(value);
        if value.trim().is_empty() {
            return;
        }
        self.pair(0, "TEXT");
        self.pair(8, layer);
        self.point(10, at);
        self.number(40, f64::from(size) * self.per_cm);
        self.pair(1, &value);
        let degrees = -f64::from(angle).to_degrees();
        if degrees.abs() > 1e-6 {
            self.number(50, degrees);
        }
        // Centered: the alignment point is the one that counts
        self.pair(72, "1");
        self.point(11, at);
    }
}

/// Text for a DXF file: ASCII, other characters as `\U+XXXX`, no line breaks.
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\n' | '\r' | '\t' => out.push(' '),
            ' '..='~' => out.push(c),
            c if (c as u32) < 0x10000 => {
                let _ = write!(out, "\\U+{:04X}", c as u32);
            }
            _ => out.push('?'),
        }
    }
    out
}

/// The plan of one level (or of a home without levels with `level: None`) as DXF text.
pub fn plan_dxf(home: &Home, level: Option<&str>, unit: DxfUnit) -> String {
    let on_level = |l: &Option<String>| level.is_none() || l.as_deref() == level;
    let mut w = Writer {
        out: String::with_capacity(64 * 1024),
        per_cm: unit.per_cm(),
    };

    // Header and tables
    for (code, value) in [
        (0, "SECTION"),
        (2, "HEADER"),
        (9, "$ACADVER"),
        (1, "AC1009"),
    ] {
        w.pair(code, value);
    }
    w.pair(9, "$INSUNITS");
    w.pair(70, &unit.code().to_string());
    w.pair(9, "$DWGCODEPAGE");
    w.pair(3, "ANSI_1252");
    w.pair(0, "ENDSEC");
    w.pair(0, "SECTION");
    w.pair(2, "TABLES");
    w.pair(0, "TABLE");
    w.pair(2, "LTYPE");
    w.pair(70, "1");
    for (code, value) in [
        (0, "LTYPE"),
        (2, "CONTINUOUS"),
        (70, "0"),
        (3, "Solid line"),
        (72, "65"),
        (73, "0"),
        (40, "0.0"),
    ] {
        w.pair(code, value);
    }
    w.pair(0, "ENDTAB");
    w.pair(0, "TABLE");
    w.pair(2, "LAYER");
    w.pair(70, &LAYERS.len().to_string());
    for (name, color) in LAYERS {
        w.pair(0, "LAYER");
        w.pair(2, name);
        w.pair(70, "0");
        w.pair(62, &color.to_string());
        w.pair(6, "CONTINUOUS");
    }
    w.pair(0, "ENDTAB");
    w.pair(0, "ENDSEC");
    w.pair(0, "SECTION");
    w.pair(2, "BLOCKS");
    w.pair(0, "ENDSEC");
    w.pair(0, "SECTION");
    w.pair(2, "ENTITIES");

    // Rooms with names and areas
    for r in home
        .rooms
        .iter()
        .filter(|r| on_level(&r.attrs.level) && r.points.len() >= 3)
    {
        let points: Vec<[f32; 2]> = r.points.iter().map(|p| [p.x, p.y]).collect();
        w.polyline("ROOMS", &points, true);
        let (name_at, area_at) = msh_geometry::room_label_positions(r);
        let size = |role: &str| {
            r.text_styles
                .iter()
                .find(|t| t.role.as_deref() == Some(role))
                .map_or(ROOM_FONT, |t| t.font_size)
        };
        if let Some(name) = &r.attrs.name {
            w.text(
                "ROOM_NAMES",
                name_at,
                size("nameStyle"),
                r.attrs.name_angle.unwrap_or(0.0),
                name,
            );
        }
        if r.attrs.area_visible == Some(true) {
            w.text(
                "ROOM_NAMES",
                area_at,
                size("areaStyle"),
                r.attrs.area_angle.unwrap_or(0.0),
                &format!("{:.2} m\u{b2}", r.area() / 10_000.0),
            );
        }
    }

    // Walls as their outlines
    for (wall, shape) in home.walls.iter().zip(wall_shapes(home)) {
        if on_level(&wall.attrs.level) {
            w.polyline("WALLS", &shape.polygon(), true);
        }
    }

    // Furniture, doors and windows as their outlines; stairs, roofs and openings as the
    // lines the plan shows of them
    let mut pieces: Vec<&Piece> = Vec::new();
    collect_pieces(&home.furniture, &mut pieces);
    for p in pieces
        .into_iter()
        .filter(|p| on_level(&p.attrs.level) && p.attrs.is_visible())
    {
        if let Some((lines, walk)) = stair_symbol(p) {
            for (a, b) in lines {
                w.line("STAIRS", a, b);
            }
            w.polyline("STAIRS", &walk, false);
        } else if let Some(outline) = opening_outline(p) {
            w.polyline("OPENINGS", &outline, true);
            if let [a, b, c, d] = outline.as_slice() {
                w.line("OPENINGS", *a, *c);
                w.line("OPENINGS", *b, *d);
            }
        } else if let Some(lines) = roof_lines(p) {
            for line in lines {
                w.line("ROOFS", line.a, line.b);
            }
        } else {
            let layer = if p.kind == PieceKind::DoorOrWindow {
                "DOORS_WINDOWS"
            } else {
                "FURNITURE"
            };
            w.polyline(layer, &piece_corners(p), true);
        }
    }

    // Lines
    for pl in home
        .polylines
        .iter()
        .filter(|p| on_level(&p.attrs.level) && p.points.len() >= 2)
    {
        let points: Vec<[f32; 2]> = pl.points.iter().map(|p| [p.x, p.y]).collect();
        w.polyline("LINES", &points, pl.attrs.closed_path == Some(true));
    }

    // Dimensions: extension lines, the dimension line with its marks and the length
    let style = dimension_style(home);
    for d in home
        .dimension_lines
        .iter()
        .filter(|d| on_level(&d.attrs.level))
    {
        let a = &d.attrs;
        let (dx, dy) = (a.x_end - a.x_start, a.y_end - a.y_start);
        let length = dx.hypot(dy);
        if length == 0.0 {
            continue;
        }
        let (ux, uy) = (dx / length, dy / length);
        // The side of the offset, as the plan draws it
        let (nx, ny) = (-uy, ux);
        let off = a.offset;
        let along = |s: f32, o: f32| [a.x_start + ux * s + nx * o, a.y_start + uy * s + ny * o];
        let beyond = off + off.signum() * 5.0;
        w.line("DIMENSIONS", along(0.0, 0.0), along(0.0, beyond));
        w.line("DIMENSIONS", along(length, 0.0), along(length, beyond));
        w.line("DIMENSIONS", along(0.0, off), along(length, off));
        for (s, inward) in [(0.0, 1.0), (length, -1.0)] {
            match style.mark {
                EndMark::Slash => w.line(
                    "DIMENSIONS",
                    along(s - MARK, off + MARK),
                    along(s + MARK, off - MARK),
                ),
                EndMark::Arrow => {
                    for side in [ARROW * 0.25, -ARROW * 0.25] {
                        w.line(
                            "DIMENSIONS",
                            along(s, off),
                            along(s + inward * ARROW, off + side),
                        );
                    }
                }
                EndMark::Dot => w.circle("DIMENSIONS", along(s, off), DOT),
                EndMark::None => {}
            }
        }
        let size = d
            .text_style
            .as_ref()
            .map_or(dimension_font(&style), |t| t.font_size);
        let gap = if off > 0.0 { size * 1.0 } else { -size * 0.3 };
        let mut angle = dy.atan2(dx);
        // Readable from below or from the right
        if angle > std::f32::consts::FRAC_PI_2 + 1e-3 || angle < -std::f32::consts::FRAC_PI_2 {
            angle += std::f32::consts::PI;
        }
        w.text(
            "DIMENSIONS",
            along(length / 2.0, off + gap),
            size,
            angle,
            &style.format(length),
        );
    }

    // Texts, line by line
    for l in home.labels.iter().filter(|l| on_level(&l.attrs.level)) {
        let size = l.text_style.as_ref().map_or(LABEL_FONT, |t| t.font_size);
        let lines: Vec<&str> = l.text.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            let dy = (i as f32 - (lines.len() as f32 - 1.0)) * size * 1.2;
            w.text(
                "TEXTS",
                [l.attrs.x, l.attrs.y + dy],
                size,
                l.attrs.angle.unwrap_or(0.0),
                line,
            );
        }
    }

    // Compass
    if let Some(c) = home
        .compass
        .as_ref()
        .map(|c| &c.attrs)
        .filter(|c| c.visible != Some(false))
    {
        let r = c.diameter / 2.0;
        let north = c.north_direction.unwrap_or(0.0);
        let (s, k) = north.sin_cos();
        let tip = [c.x + r * s, c.y - r * k];
        w.circle("COMPASS", [c.x, c.y], r);
        w.line("COMPASS", [c.x - r * s, c.y + r * k], tip);
        w.text(
            "COMPASS",
            [c.x + r * 1.25 * s, c.y - r * 1.25 * k],
            r * 0.5,
            north,
            "N",
        );
    }

    w.pair(0, "ENDSEC");
    w.pair(0, "EOF");
    w.out
}

#[cfg(test)]
mod tests {
    use super::*;
    use msh_model::{Wall, WallAttrs};

    fn pairs(dxf: &str) -> Vec<(i32, String)> {
        let lines: Vec<&str> = dxf.lines().collect();
        assert_eq!(lines.len() % 2, 0, "group codes and values come in pairs");
        lines
            .chunks(2)
            .map(|c| (c[0].trim().parse().unwrap(), c[1].to_string()))
            .collect()
    }

    #[test]
    fn walls_are_closed_polylines_in_millimeters_with_y_up() {
        let home = Home {
            walls: vec![Wall {
                attrs: WallAttrs {
                    id: "w".into(),
                    x_start: 0.0,
                    y_start: 100.0,
                    x_end: 400.0,
                    y_end: 100.0,
                    thickness: 20.0,
                    ..Default::default()
                },
                ..Default::default()
            }],
            ..Default::default()
        };
        let dxf = plan_dxf(&home, None, DxfUnit::Millimeter);
        let p = pairs(&dxf);
        assert_eq!(p.first(), Some(&(0, "SECTION".into())));
        assert_eq!(p.last(), Some(&(0, "EOF".into())));
        assert!(p.contains(&(9, "$INSUNITS".into())) && p.contains(&(70, "4".into())));
        let layers = p.iter().filter(|(c, v)| *c == 0 && v == "LAYER").count();
        assert_eq!(layers, LAYERS.len());
        // One polyline on the layer of walls with the corners 0..4000 mm, y from -900 to
        // -1100 mm (100 cm down in the plan, 10 cm each side)
        let start = p
            .iter()
            .position(|(c, v)| *c == 0 && v == "POLYLINE")
            .unwrap();
        assert_eq!(p[start + 1], (8, "WALLS".into()));
        let end = start
            + p[start..]
                .iter()
                .position(|(c, v)| *c == 0 && v == "SEQEND")
                .unwrap();
        // The y of each vertex (the first 20 is the polyline's own, always 0)
        let ys: Vec<f64> = p[start..end]
            .iter()
            .filter(|(c, _)| *c == 20)
            .skip(1)
            .map(|(_, v)| v.parse().unwrap())
            .collect();
        assert!(ys.len() >= 4);
        assert!(ys.iter().all(|y| (-1100.0..=-900.0).contains(y)), "{ys:?}");
        assert!(p.iter().any(|(c, v)| *c == 10 && v == "4000"));
    }

    #[test]
    fn texts_are_ascii_with_unicode_escapes() {
        assert_eq!(encode("Küche\n1"), "K\\U+00FCche 1");
        let home = Home {
            labels: vec![msh_model::Label {
                text: "Wohnzimmer – Süd".into(),
                attrs: msh_model::LabelAttrs {
                    x: 10.0,
                    y: 20.0,
                    ..Default::default()
                },
                ..Default::default()
            }],
            ..Default::default()
        };
        let dxf = plan_dxf(&home, None, DxfUnit::Meter);
        assert!(dxf.is_ascii());
        assert!(dxf.contains("Wohnzimmer \\U+2013 S\\U+00FCd"));
        // 18 cm text in meters
        assert!(dxf.contains("40\n0.18\n"));
        assert!(dxf.contains("10\n0.1\n20\n-0.2\n"));
    }
}
