//! More model formats for the furniture import, converted to OBJ + MTL (Sweet Home 3D reads
//! OBJ, DAE and 3DS only):
//!
//! - STL (binary and ASCII) and 3MF: meshes of 3D printing, in millimeters and with z up;
//!   they are turned to y up. 3MF colors (base materials, color groups) become materials.
//! - PLY (ASCII and binary): scans and meshes, units unknown (taken as cm); vertex colors
//!   become one average color.
//! - ZIP and KMZ archives: unpacked; the main model inside is read like a single file.
//! - XYZ and ASC (Esri ASCII grid): heights of terrain in meters, turned into a mesh around
//!   its middle. The package notes where that middle lies in the file's coordinates.

use crate::model_package::{ModelError, ModelPackage, collect};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

/// Color of meshes without colors (light gray, like Sweet Home 3D's default).
const DEFAULT_COLOR: [f32; 3] = [0.8, 0.8, 0.8];
/// Largest unpacked archive.
const MAX_ARCHIVE_BYTES: u64 = 400 * 1024 * 1024;

/// Triangles with one color each, before they are written as OBJ.
#[derive(Default)]
struct Mesh {
    positions: Vec<[f32; 3]>,
    /// Vertex indices and color index of each triangle
    triangles: Vec<([u32; 3], usize)>,
    colors: Vec<[f32; 3]>,
    /// What was taken off the coordinates of the file to keep the positions small (terrain
    /// in national coordinates lies millions of meters from the zero point)
    shift: [f64; 3],
}

impl Mesh {
    fn color_index(&mut self, color: [f32; 3]) -> usize {
        if let Some(i) = self.colors.iter().position(|c| *c == color) {
            return i;
        }
        self.colors.push(color);
        self.colors.len() - 1
    }

    /// The mesh as OBJ + MTL; `z_up` turns z up into y up, `cm_per_unit` gives the size.
    fn into_package(self, z_up: bool, cm_per_unit: f32) -> Result<ModelPackage, ModelError> {
        if self.triangles.is_empty() {
            return Err(ModelError::Empty);
        }
        let mut obj = String::from("mtllib model.mtl\n");
        let mut mtl = String::new();
        let colors = if self.colors.is_empty() {
            vec![DEFAULT_COLOR]
        } else {
            self.colors.clone()
        };
        for (i, c) in colors.iter().enumerate() {
            let _ = writeln!(
                mtl,
                "newmtl color{i}\nKd {} {} {}\nKa 0 0 0\n",
                c[0], c[1], c[2]
            );
        }
        let shift = if z_up {
            [self.shift[0], self.shift[2], -self.shift[1]]
        } else {
            self.shift
        };
        let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
        for p in &self.positions {
            let v = if z_up { [p[0], p[2], -p[1]] } else { *p };
            for i in 0..3 {
                lo[i] = lo[i].min(v[i]);
                hi[i] = hi[i].max(v[i]);
            }
            let _ = writeln!(obj, "v {} {} {}", v[0], v[1], v[2]);
        }
        // Grouped by color, one usemtl per color
        let mut by_color: Vec<Vec<[u32; 3]>> = vec![Vec::new(); colors.len()];
        for (t, c) in &self.triangles {
            by_color[(*c).min(colors.len() - 1)].push(*t);
        }
        for (c, tris) in by_color.iter().enumerate() {
            if tris.is_empty() {
                continue;
            }
            let _ = writeln!(obj, "usemtl color{c}");
            for t in tris {
                let _ = writeln!(obj, "f {} {} {}", t[0] + 1, t[1] + 1, t[2] + 1);
            }
        }
        Ok(ModelPackage {
            main: "model.obj".into(),
            files: vec![
                ("model.obj".into(), obj.into_bytes()),
                ("model.mtl".into(), mtl.into_bytes()),
            ],
            size_cm: Some([0, 1, 2].map(|i| (hi[i] - lo[i]) * cm_per_unit)),
            center_cm: Some(
                [0, 1, 2]
                    .map(|i| (f64::from(lo[i] + hi[i]) / 2.0 + shift[i]) * f64::from(cm_per_unit)),
            ),
            unit_cm: cm_per_unit,
        })
    }
}

fn invalid(format: &str, why: &str) -> ModelError {
    ModelError::Format(format!("invalid {format} file: {why}"))
}

// ---------------------------------------------------------------- STL

/// Reads an STL file (millimeters, z up).
pub(crate) fn convert_stl(data: &[u8]) -> Result<ModelPackage, ModelError> {
    parse_stl(data)?.into_package(true, 0.1)
}

fn parse_stl(data: &[u8]) -> Result<Mesh, ModelError> {
    let mut mesh = Mesh::default();
    let binary_len = data
        .get(80..84)
        .map(|b| 84 + 50 * u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize);
    if binary_len == Some(data.len()) {
        let f = |o: usize| f32::from_le_bytes([data[o], data[o + 1], data[o + 2], data[o + 3]]);
        let count = (data.len() - 84) / 50;
        for n in 0..count {
            // Each triangle: normal (12 bytes), three corners (36), attributes (2)
            let base = 84 + n * 50;
            let i = mesh.positions.len() as u32;
            for k in 0..3 {
                let o = base + 12 + k * 12;
                mesh.positions.push([f(o), f(o + 4), f(o + 8)]);
            }
            mesh.triangles.push(([i, i + 1, i + 2], 0));
        }
    } else {
        let text = String::from_utf8_lossy(data);
        if !text.trim_start().starts_with("solid") {
            return Err(invalid("STL", "neither binary nor ASCII"));
        }
        let mut face: Vec<[f32; 3]> = Vec::new();
        for line in text.lines() {
            let mut it = line.split_whitespace();
            match it.next() {
                Some("vertex") => {
                    let v: Vec<f32> = it.filter_map(|t| t.parse().ok()).collect();
                    if v.len() == 3 {
                        face.push([v[0], v[1], v[2]]);
                    }
                }
                Some("endloop") => {
                    // Polygons with more corners become a fan of triangles
                    let i = mesh.positions.len() as u32;
                    for k in 1..face.len().saturating_sub(1) as u32 {
                        mesh.triangles.push(([i, i + k, i + k + 1], 0));
                    }
                    mesh.positions.append(&mut face);
                }
                _ => {}
            }
        }
    }
    Ok(mesh)
}

// ---------------------------------------------------------------- PLY

#[derive(Clone, Copy, PartialEq)]
enum PlyFormat {
    Ascii,
    LittleEndian,
    BigEndian,
}

#[derive(Clone)]
struct PlyProperty {
    name: String,
    /// Scalar type, or the item type of a list
    kind: String,
    /// Type of the item count of a list property
    list_count: Option<String>,
}

struct PlyElement {
    name: String,
    count: usize,
    properties: Vec<PlyProperty>,
}

fn ply_size(kind: &str) -> Option<usize> {
    Some(match kind {
        "char" | "uchar" | "int8" | "uint8" => 1,
        "short" | "ushort" | "int16" | "uint16" => 2,
        "int" | "uint" | "int32" | "uint32" | "float" | "float32" => 4,
        "double" | "float64" => 8,
        _ => return None,
    })
}

/// Reads one binary scalar of a PLY file as f64.
fn ply_value(kind: &str, b: &[u8], format: PlyFormat) -> f64 {
    let le = format == PlyFormat::LittleEndian;
    macro_rules! num {
        ($t:ty, $n:expr) => {{
            let mut a = [0u8; $n];
            a.copy_from_slice(&b[..$n]);
            (if le {
                <$t>::from_le_bytes(a)
            } else {
                <$t>::from_be_bytes(a)
            }) as f64
        }};
    }
    match kind {
        "char" | "int8" => b[0] as i8 as f64,
        "uchar" | "uint8" => b[0] as f64,
        "short" | "int16" => num!(i16, 2),
        "ushort" | "uint16" => num!(u16, 2),
        "int" | "int32" => num!(i32, 4),
        "uint" | "uint32" => num!(u32, 4),
        "float" | "float32" => num!(f32, 4),
        _ => num!(f64, 8),
    }
}

/// Reads a PLY file (units taken as cm, axes as they are).
pub(crate) fn convert_ply(data: &[u8]) -> Result<ModelPackage, ModelError> {
    let mesh = parse_ply(data)?;
    if mesh.triangles.is_empty() && !mesh.positions.is_empty() {
        return Err(ModelError::Format(
            "the PLY file is a point cloud (points without faces), which cannot be shown yet: \
             turn it into a mesh, or for terrain into a height grid (XYZ, ASC)"
                .into(),
        ));
    }
    mesh.into_package(false, 1.0)
}

fn parse_ply(data: &[u8]) -> Result<Mesh, ModelError> {
    let end = data
        .windows(10)
        .position(|w| w == b"end_header")
        .ok_or_else(|| invalid("PLY", "no end_header"))?;
    let header = String::from_utf8_lossy(&data[..end]);
    let mut body_start = end + 10;
    while body_start < data.len() && (data[body_start] == b'\r' || data[body_start] == b'\n') {
        body_start += 1;
        if data[body_start - 1] == b'\n' {
            break;
        }
    }
    let mut format = PlyFormat::Ascii;
    let mut elements: Vec<PlyElement> = Vec::new();
    for line in header.lines() {
        let t: Vec<&str> = line.split_whitespace().collect();
        match t.as_slice() {
            ["format", f, ..] => {
                format = match *f {
                    "ascii" => PlyFormat::Ascii,
                    "binary_little_endian" => PlyFormat::LittleEndian,
                    "binary_big_endian" => PlyFormat::BigEndian,
                    _ => return Err(invalid("PLY", "unknown format")),
                }
            }
            ["element", name, count] => elements.push(PlyElement {
                name: (*name).to_owned(),
                count: count
                    .parse()
                    .map_err(|_| invalid("PLY", "bad element count"))?,
                properties: Vec::new(),
            }),
            ["property", "list", count_kind, kind, name] => {
                if let Some(e) = elements.last_mut() {
                    e.properties.push(PlyProperty {
                        name: (*name).to_owned(),
                        kind: (*kind).to_owned(),
                        list_count: Some((*count_kind).to_owned()),
                    });
                }
            }
            ["property", kind, name] => {
                if let Some(e) = elements.last_mut() {
                    e.properties.push(PlyProperty {
                        name: (*name).to_owned(),
                        kind: (*kind).to_owned(),
                        list_count: None,
                    });
                }
            }
            _ => {}
        }
    }

    let mut mesh = Mesh::default();
    let mut color_sum = [0.0f64; 3];
    let mut colored = 0usize;
    // Values of one element row: scalars, or the items of a list
    let body = &data[body_start..];
    let text = (format == PlyFormat::Ascii).then(|| String::from_utf8_lossy(body).into_owned());
    let mut tokens = text.as_deref().map(|t| t.split_ascii_whitespace());
    let mut offset = 0usize;
    let mut next = |kind: &str| -> Result<f64, ModelError> {
        if let Some(tok) = tokens.as_mut() {
            tok.next()
                .and_then(|s| s.parse::<f64>().ok())
                .ok_or_else(|| invalid("PLY", "too few values"))
        } else {
            let size = ply_size(kind).ok_or_else(|| invalid("PLY", "unknown property type"))?;
            let b = body
                .get(offset..offset + size)
                .ok_or_else(|| invalid("PLY", "file ends too early"))?;
            offset += size;
            Ok(ply_value(kind, b, format))
        }
    };
    for e in &elements {
        for _ in 0..e.count {
            let mut row: HashMap<&str, f64> = HashMap::new();
            let mut list: Vec<u32> = Vec::new();
            for p in &e.properties {
                if let Some(count_kind) = &p.list_count {
                    let n = next(count_kind)? as usize;
                    let mut items = Vec::with_capacity(n);
                    for _ in 0..n {
                        items.push(next(&p.kind)? as u32);
                    }
                    if p.name == "vertex_indices" || p.name == "vertex_index" {
                        list = items;
                    }
                } else {
                    row.insert(p.name.as_str(), next(&p.kind)?);
                }
            }
            if e.name == "vertex" {
                let g = |k: &str| row.get(k).copied().unwrap_or(0.0) as f32;
                mesh.positions.push([g("x"), g("y"), g("z")]);
                if let (Some(r), Some(gr), Some(b)) =
                    (row.get("red"), row.get("green"), row.get("blue"))
                {
                    color_sum[0] += r;
                    color_sum[1] += gr;
                    color_sum[2] += b;
                    colored += 1;
                }
            } else if e.name == "face" {
                for k in 1..list.len().saturating_sub(1) {
                    mesh.triangles.push(([list[0], list[k], list[k + 1]], 0));
                }
            }
        }
    }
    let n = mesh.positions.len() as u32;
    mesh.triangles.retain(|(t, _)| t.iter().all(|&i| i < n));
    if colored > 0 {
        let avg = color_sum.map(|c| (c / colored as f64 / 255.0) as f32);
        mesh.color_index(avg);
    }
    Ok(mesh)
}

// ---------------------------------------------------------------- 3MF

/// Reads a 3MF package (zip with an XML model, millimeters unless stated, z up).
pub(crate) fn convert_3mf(data: &[u8]) -> Result<ModelPackage, ModelError> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data))
        .map_err(|e| invalid("3MF", &e.to_string()))?;
    let name = (0..archive.len())
        .filter_map(|i| {
            archive
                .by_index(i)
                .ok()?
                .name()
                .ok()
                .map(|n| n.into_owned())
        })
        .find(|n| n.to_ascii_lowercase().ends_with(".model"))
        .ok_or_else(|| invalid("3MF", "no 3D model inside"))?;
    let mut entry = archive
        .by_name(&name)
        .map_err(|e| invalid("3MF", &e.to_string()))?;
    let declared = entry.size();
    let bytes = msh_format::limits::read_entry(&mut entry, declared)
        .map_err(|e| invalid("3MF", &e.to_string()))?;
    let xml = String::from_utf8(bytes).map_err(|e| invalid("3MF", &e.to_string()))?;
    let (mesh, cm_per_unit) = parse_3mf_model(&xml)?;
    mesh.into_package(true, cm_per_unit)
}

/// Color of a 3MF triangle: id of its property group (base materials, color group) and index.
type ColorRef = (String, usize);

#[derive(Default)]
struct Object3mf {
    vertices: Vec<[f32; 3]>,
    /// Vertex indices and the color (property group id, index) of each triangle
    triangles: Vec<([u32; 3], Option<ColorRef>)>,
    /// Default color of the object's triangles
    color: Option<ColorRef>,
    components: Vec<(String, [f32; 12])>,
}

const IDENTITY_3MF: [f32; 12] = [1., 0., 0., 0., 1., 0., 0., 0., 1., 0., 0., 0.];

fn parse_transform(s: &str) -> [f32; 12] {
    let v: Vec<f32> = s
        .split_whitespace()
        .filter_map(|t| t.parse().ok())
        .collect();
    v.try_into().unwrap_or(IDENTITY_3MF)
}

/// 3MF matrices are row vectors times a 4x3 matrix: p' = p * M.
fn apply(m: &[f32; 12], p: [f32; 3]) -> [f32; 3] {
    [
        p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9],
        p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10],
        p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11],
    ]
}

/// a then b
fn compose(a: &[f32; 12], b: &[f32; 12]) -> [f32; 12] {
    let mut r = [0.0; 12];
    for row in 0..4 {
        for col in 0..3 {
            let mut s = if row == 3 { b[9 + col] } else { 0.0 };
            for k in 0..3 {
                s += a[row * 3 + k] * b[k * 3 + col];
            }
            r[row * 3 + col] = s;
        }
    }
    r
}

fn parse_color(s: &str) -> Option<[f32; 3]> {
    let hex = s.trim().trim_start_matches('#');
    if hex.len() < 6 {
        return None;
    }
    let c = |i: usize| {
        u8::from_str_radix(&hex[i..i + 2], 16)
            .ok()
            .map(|v| v as f32 / 255.0)
    };
    Some([c(0)?, c(2)?, c(4)?])
}

fn parse_3mf_model(xml: &str) -> Result<(Mesh, f32), ModelError> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut cm_per_unit = 0.1;
    let mut palettes: HashMap<String, Vec<[f32; 3]>> = HashMap::new();
    let mut objects: HashMap<String, Object3mf> = HashMap::new();
    let mut builds: Vec<(String, [f32; 12])> = Vec::new();
    let mut current_object: Option<String> = None;
    let mut current_palette: Option<String> = None;
    loop {
        let event = reader
            .read_event()
            .map_err(|e| invalid("3MF", &e.to_string()))?;
        let (e, empty) = match &event {
            Event::Start(e) => (e, false),
            Event::Empty(e) => (e, true),
            Event::End(e) => {
                let local = e.local_name();
                match local.as_ref() {
                    "object" => current_object = None,
                    "basematerials" | "colorgroup" => current_palette = None,
                    _ => {}
                }
                continue;
            }
            Event::Eof => break,
            _ => continue,
        };
        let attr = |name: &str| -> Option<String> {
            e.attributes().flatten().find_map(|a| {
                (a.key.local_name().as_ref() == name).then(|| a.value.clone().into_owned())
            })
        };
        let local = e.local_name();
        match local.as_ref() {
            "model" => {
                cm_per_unit = match attr("unit").as_deref() {
                    Some("micron") => 0.0001,
                    Some("centimeter") => 1.0,
                    Some("inch") => 2.54,
                    Some("foot") => 30.48,
                    Some("meter") => 100.0,
                    _ => 0.1,
                }
            }
            "basematerials" | "colorgroup" => {
                if let Some(id) = attr("id") {
                    palettes.entry(id.clone()).or_default();
                    current_palette = (!empty).then_some(id);
                }
            }
            "base" | "color" => {
                if let Some(p) = &current_palette {
                    let c = attr("displaycolor")
                        .or_else(|| attr("color"))
                        .and_then(|s| parse_color(&s))
                        .unwrap_or(DEFAULT_COLOR);
                    palettes.entry(p.clone()).or_default().push(c);
                }
            }
            "object" => {
                if let Some(id) = attr("id") {
                    let o = objects.entry(id.clone()).or_default();
                    if let (Some(pid), Some(pi)) = (attr("pid"), attr("pindex")) {
                        o.color = Some((pid, pi.parse().unwrap_or(0)));
                    }
                    current_object = (!empty).then_some(id);
                }
            }
            "vertex" => {
                if let Some(o) = current_object.as_ref().and_then(|id| objects.get_mut(id)) {
                    let g = |k: &str| attr(k).and_then(|v| v.parse().ok()).unwrap_or(0.0);
                    o.vertices.push([g("x"), g("y"), g("z")]);
                }
            }
            "triangle" => {
                if let Some(o) = current_object.as_ref().and_then(|id| objects.get_mut(id)) {
                    let g = |k: &str| attr(k).and_then(|v| v.parse().ok()).unwrap_or(0u32);
                    let color = attr("pid")
                        .map(|pid| (pid, attr("p1").and_then(|v| v.parse().ok()).unwrap_or(0)))
                        .or_else(|| o.color.clone());
                    o.triangles.push(([g("v1"), g("v2"), g("v3")], color));
                }
            }
            "component" => {
                if let (Some(o), Some(target)) = (
                    current_object.as_ref().and_then(|id| objects.get_mut(id)),
                    attr("objectid"),
                ) {
                    let m = attr("transform").map_or(IDENTITY_3MF, |t| parse_transform(&t));
                    o.components.push((target, m));
                }
            }
            "item" => {
                if let Some(target) = attr("objectid") {
                    let m = attr("transform").map_or(IDENTITY_3MF, |t| parse_transform(&t));
                    builds.push((target, m));
                }
            }
            _ => {}
        }
    }
    // Without build items every object with a mesh is placed as it is
    if builds.is_empty() {
        let mut ids: Vec<&String> = objects.keys().collect();
        ids.sort();
        builds = ids
            .into_iter()
            .map(|id| (id.clone(), IDENTITY_3MF))
            .collect();
    }
    let mut mesh = Mesh::default();
    let mut stack: Vec<(String, [f32; 12], usize)> =
        builds.into_iter().map(|(id, m)| (id, m, 0)).collect();
    while let Some((id, m, depth)) = stack.pop() {
        let Some(o) = objects.get(&id) else { continue };
        if depth > 16 {
            continue;
        }
        let base = mesh.positions.len() as u32;
        let n = o.vertices.len() as u32;
        mesh.positions
            .extend(o.vertices.iter().map(|p| apply(&m, *p)));
        for (t, color) in &o.triangles {
            if t.iter().any(|&i| i >= n) {
                continue;
            }
            let c = color
                .as_ref()
                .and_then(|(pid, i)| palettes.get(pid).and_then(|p| p.get(*i)))
                .copied();
            let ci = c.map_or(0, |c| mesh.color_index(c));
            if c.is_none() && mesh.colors.is_empty() {
                mesh.color_index(DEFAULT_COLOR);
            }
            mesh.triangles
                .push(([base + t[0], base + t[1], base + t[2]], ci));
        }
        for (child, cm) in &o.components {
            stack.push((child.clone(), compose(cm, &m), depth + 1));
        }
    }
    Ok((mesh, cm_per_unit))
}

// ---------------------------------------------------------------- Height grids (terrain)

/// Largest number of grid points along one side of a terrain mesh; finer grids are thinned.
const TERRAIN_MAX_SIDE: usize = 300;
/// Largest number of cells of a height grid while it is read.
const TERRAIN_MAX_CELLS: usize = 50_000_000;
/// Color of terrain meshes (a muted green).
const TERRAIN_COLOR: [f32; 3] = [0.56, 0.66, 0.45];

/// Heights on a regular grid, `f64::NAN` where there is none. Row 0 is the southern one.
struct HeightGrid {
    cols: usize,
    rows: usize,
    /// Position of the first node (west, south)
    origin: [f64; 2],
    /// Distance of the nodes to the east and to the north
    step: [f64; 2],
    z: Vec<f64>,
}

impl HeightGrid {
    /// The grid as a mesh with z up, around its middle and above its lowest point.
    fn into_mesh(self) -> Result<Mesh, ModelError> {
        let low = self
            .z
            .iter()
            .copied()
            .filter(|v| v.is_finite())
            .fold(f64::INFINITY, f64::min);
        if !low.is_finite() {
            return Err(ModelError::Empty);
        }
        let stride = (self.cols.max(self.rows) - 1)
            .div_ceil(TERRAIN_MAX_SIDE - 1)
            .max(1);
        let cols: Vec<usize> = (0..self.cols).step_by(stride).collect();
        let rows: Vec<usize> = (0..self.rows).step_by(stride).collect();
        let shift = [
            self.origin[0] + self.step[0] * (self.cols - 1) as f64 / 2.0,
            self.origin[1] + self.step[1] * (self.rows - 1) as f64 / 2.0,
            low,
        ];
        let mut mesh = Mesh {
            shift,
            ..Mesh::default()
        };
        let color = mesh.color_index(TERRAIN_COLOR);
        let mut index = vec![u32::MAX; cols.len() * rows.len()];
        for (j, &row) in rows.iter().enumerate() {
            for (i, &col) in cols.iter().enumerate() {
                let z = self.z[row * self.cols + col];
                if z.is_finite() {
                    index[j * cols.len() + i] = mesh.positions.len() as u32;
                    mesh.positions.push([
                        (self.origin[0] + self.step[0] * col as f64 - shift[0]) as f32,
                        (self.origin[1] + self.step[1] * row as f64 - shift[1]) as f32,
                        (z - shift[2]) as f32,
                    ]);
                }
            }
        }
        for j in 0..rows.len() - 1 {
            for i in 0..cols.len() - 1 {
                let at = |i: usize, j: usize| index[j * cols.len() + i];
                // Counterclockwise seen from above
                let corners = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
                let there: Vec<u32> = corners.into_iter().filter(|v| *v != u32::MAX).collect();
                match there.as_slice() {
                    [a, b, c, d] => {
                        mesh.triangles.push(([*a, *b, *c], color));
                        mesh.triangles.push(([*a, *c, *d], color));
                    }
                    // A cell with one corner missing keeps its other half
                    [a, b, c] => mesh.triangles.push(([*a, *b, *c], color)),
                    _ => {}
                }
            }
        }
        Ok(mesh)
    }
}

/// Grids in degrees (geographic coordinates) have no length: they cannot become a mesh.
fn check_metric(origin: [f64; 2], step: [f64; 2], format: &str) -> Result<(), ModelError> {
    if step[0].max(step[1]) < 0.001 && origin[0].abs() <= 180.0 && origin[1].abs() <= 90.0 {
        return Err(invalid(
            format,
            "the grid seems to be in degrees; it must be in meters (a projected coordinate system)",
        ));
    }
    Ok(())
}

/// Reads an Esri ASCII grid (heights in meters on a square grid, rows from north to south).
pub(crate) fn convert_asc(data: &[u8]) -> Result<ModelPackage, ModelError> {
    parse_asc(&String::from_utf8_lossy(data))?
        .into_mesh()?
        .into_package(true, 100.0)
}

fn parse_asc(text: &str) -> Result<HeightGrid, ModelError> {
    let number = |t: &str| t.replace(',', ".").parse::<f64>().ok();
    let mut tokens = text.split_ascii_whitespace().peekable();
    let mut header: HashMap<String, f64> = HashMap::new();
    while let Some(key) = tokens.peek() {
        if !key.starts_with(|c: char| c.is_ascii_alphabetic()) {
            break;
        }
        let key = tokens.next().unwrap_or_default().to_ascii_lowercase();
        let value = tokens
            .next()
            .and_then(number)
            .ok_or_else(|| invalid("ASC", "a header line has no number"))?;
        header.insert(key, value);
    }
    let get = |k: &str| header.get(k).copied();
    let count = |k: &str| {
        get(k)
            .filter(|v| *v >= 2.0 && v.fract() == 0.0)
            .map(|v| v as usize)
            .ok_or_else(|| invalid("ASC", &format!("{k} is missing or below 2")))
    };
    let (cols, rows) = (count("ncols")?, count("nrows")?);
    if cols.saturating_mul(rows) > TERRAIN_MAX_CELLS {
        return Err(ModelError::TooLarge);
    }
    let dx = get("cellsize")
        .or_else(|| get("dx"))
        .filter(|v| *v > 0.0)
        .ok_or_else(|| invalid("ASC", "cellsize is missing"))?;
    let dy = get("dy").filter(|v| *v > 0.0).unwrap_or(dx);
    let origin = [
        get("xllcenter")
            .or_else(|| get("xllcorner").map(|v| v + dx / 2.0))
            .unwrap_or(0.0),
        get("yllcenter")
            .or_else(|| get("yllcorner").map(|v| v + dy / 2.0))
            .unwrap_or(0.0),
    ];
    check_metric(origin, [dx, dy], "ASC")?;
    let nodata = get("nodata_value").unwrap_or(-9999.0);
    let mut z = vec![f64::NAN; cols * rows];
    for row in (0..rows).rev() {
        for col in 0..cols {
            let v = tokens
                .next()
                .and_then(number)
                .ok_or_else(|| invalid("ASC", "fewer heights than ncols x nrows"))?;
            if (v - nodata).abs() > 1e-6 {
                z[row * cols + col] = v;
            }
        }
    }
    Ok(HeightGrid {
        cols,
        rows,
        origin,
        step: [dx, dy],
        z,
    })
}

/// Reads height points as text, one "x y z" per line (east, north and height in meters),
/// separated by blanks, tabs, commas or semicolons. Points of a regular grid keep their grid;
/// scattered points are averaged on a grid of their mean distance.
pub(crate) fn convert_xyz(data: &[u8]) -> Result<ModelPackage, ModelError> {
    grid_of_points(&parse_xyz(&String::from_utf8_lossy(data)))?
        .into_mesh()?
        .into_package(true, 100.0)
}

fn parse_xyz(text: &str) -> Vec<[f64; 3]> {
    text.lines()
        .filter_map(|line| {
            // With semicolons between the values a comma is the decimal sign
            let decimal_comma = line.contains(';');
            let mut values = line
                .split(|c: char| {
                    c.is_ascii_whitespace() || c == ';' || (c == ',' && !decimal_comma)
                })
                .filter(|t| !t.is_empty())
                .map(|t| {
                    t.replace(',', ".")
                        .parse::<f64>()
                        .ok()
                        .filter(|v| v.is_finite())
                });
            // Lines that do not start with three numbers (titles, comments) are skipped
            Some([values.next()??, values.next()??, values.next()??])
        })
        .collect()
}

/// Distance of the grid lines along an axis if the coordinates repeat (a regular grid).
fn axis_step(points: &[[f64; 3]], axis: usize, extent: f64) -> Option<f64> {
    let mut values: Vec<f64> = points.iter().map(|p| p[axis]).collect();
    values.sort_by(f64::total_cmp);
    values.dedup_by(|a, b| (*a - *b).abs() < extent * 1e-7);
    if values.len() < 2 || values.len() * 2 > points.len() {
        return None;
    }
    let mut steps: Vec<f64> = values.windows(2).map(|w| w[1] - w[0]).collect();
    steps.sort_by(f64::total_cmp);
    Some(steps[steps.len() / 2])
}

fn grid_of_points(points: &[[f64; 3]]) -> Result<HeightGrid, ModelError> {
    if points.len() < 3 {
        return Err(invalid(
            "XYZ",
            "fewer than three lines with x, y and z (east, north, height)",
        ));
    }
    let (mut lo, mut hi) = ([f64::MAX; 2], [f64::MIN; 2]);
    for p in points {
        for i in 0..2 {
            lo[i] = lo[i].min(p[i]);
            hi[i] = hi[i].max(p[i]);
        }
    }
    let extent = [hi[0] - lo[0], hi[1] - lo[1]];
    if !(extent[0] > 0.0 && extent[1] > 0.0) {
        return Err(invalid("XYZ", "the points lie on one line"));
    }
    let regular = axis_step(points, 0, extent[0]).zip(axis_step(points, 1, extent[1]));
    let mut step = match regular {
        Some((x, y)) => [x, y],
        None => {
            // Scattered points: cells a little larger than their mean distance, so that most
            // cells get a point
            let mean = (extent[0] * extent[1] / points.len() as f64).sqrt() * 1.5;
            [mean, mean]
        }
    };
    check_metric(lo, step, "XYZ")?;
    let size = |step: [f64; 2]| {
        [
            (extent[0] / step[0]).round() as usize + 1,
            (extent[1] / step[1]).round() as usize + 1,
        ]
    };
    while size(step)[0].saturating_mul(size(step)[1]) > TERRAIN_MAX_CELLS {
        step = [step[0] * 2.0, step[1] * 2.0];
    }
    let [cols, rows] = size(step);
    if cols < 2 || rows < 2 {
        return Err(invalid("XYZ", "the points lie on one line"));
    }
    let mut sum = vec![0.0f64; cols * rows];
    let mut count = vec![0u32; cols * rows];
    for p in points {
        let col = (((p[0] - lo[0]) / step[0]).round() as usize).min(cols - 1);
        let row = (((p[1] - lo[1]) / step[1]).round() as usize).min(rows - 1);
        sum[row * cols + col] += p[2];
        count[row * cols + col] += 1;
    }
    let mut z: Vec<f64> = sum
        .iter()
        .zip(&count)
        .map(|(s, n)| if *n > 0 { s / f64::from(*n) } else { f64::NAN })
        .collect();
    if regular.is_none() {
        // Empty cells between scattered points take the mean of their neighbors
        for _ in 0..3 {
            let before = z.clone();
            for row in 0..rows {
                for col in 0..cols {
                    if before[row * cols + col].is_finite() {
                        continue;
                    }
                    let (mut total, mut n) = (0.0, 0);
                    for (dc, dr) in [(-1i64, 0i64), (1, 0), (0, -1), (0, 1)] {
                        let (c, r) = (col as i64 + dc, row as i64 + dr);
                        if c < 0 || r < 0 || c >= cols as i64 || r >= rows as i64 {
                            continue;
                        }
                        let v = before[r as usize * cols + c as usize];
                        if v.is_finite() {
                            total += v;
                            n += 1;
                        }
                    }
                    if n >= 2 {
                        z[row * cols + col] = total / f64::from(n);
                    }
                }
            }
        }
    }
    Ok(HeightGrid {
        cols,
        rows,
        origin: lo,
        step,
        z,
    })
}

// ---------------------------------------------------------------- ZIP / KMZ

/// Model formats in the order an archive's main model is chosen.
const ARCHIVE_MODELS: [&str; 8] = ["gltf", "glb", "obj", "dae", "3ds", "3mf", "stl", "ply"];

/// Unpacks a ZIP or KMZ archive into a temporary folder and reads its main model.
pub(crate) fn convert_archive(data: &[u8]) -> Result<ModelPackage, ModelError> {
    let dir = std::env::temp_dir().join(format!("msh-archive-{}", uuid::Uuid::new_v4()));
    let result = unpack(data, &dir).and_then(|files| {
        let main = main_model(&files).ok_or_else(|| {
            let fbx = files.iter().any(|f| has_extension(f, "fbx"));
            ModelError::Format(if fbx {
                "the archive contains an FBX model: import the FBX file in the app".into()
            } else {
                "the archive contains no supported model (OBJ, DAE, 3DS, glTF, GLB, 3MF, STL, PLY)"
                    .into()
            })
        })?;
        collect(&dir.join(main))
    });
    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn has_extension(path: &Path, ext: &str) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

/// The main model of the unpacked files: the preferred format, then the shallowest path.
fn main_model(files: &[PathBuf]) -> Option<&PathBuf> {
    ARCHIVE_MODELS.iter().find_map(|ext| {
        files
            .iter()
            .filter(|f| has_extension(f, ext))
            .min_by_key(|f| (f.components().count(), f.to_string_lossy().len()))
    })
}

/// Unpacks all files of the archive into `dir`; returns their relative paths.
fn unpack(data: &[u8], dir: &Path) -> Result<Vec<PathBuf>, ModelError> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data))
        .map_err(|e| invalid("ZIP", &e.to_string()))?;
    let io = |source: std::io::Error| ModelError::Io {
        path: dir.to_owned(),
        source,
    };
    let mut files = Vec::new();
    let mut total = 0u64;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| invalid("ZIP", &e.to_string()))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().map_err(|e| invalid("ZIP", &e.to_string()))?;
        let rel = PathBuf::from(name.replace('\\', "/"));
        if !rel.components().all(|c| matches!(c, Component::Normal(_))) {
            continue;
        }
        // The declared size rejects large archives early; the bytes actually copied count
        if total.saturating_add(entry.size()) > MAX_ARCHIVE_BYTES {
            return Err(ModelError::TooLarge);
        }
        let target = dir.join(&rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(io)?;
        }
        let mut out = std::fs::File::create(&target).map_err(io)?;
        let remaining = MAX_ARCHIVE_BYTES - total;
        total += std::io::copy(&mut (&mut entry).take(remaining + 1), &mut out).map_err(io)?;
        if total > MAX_ARCHIVE_BYTES {
            return Err(ModelError::TooLarge);
        }
        files.push(rel);
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj_text(p: &ModelPackage) -> String {
        String::from_utf8_lossy(&p.files[0].1).into_owned()
    }

    #[test]
    fn ascii_stl_becomes_obj_with_y_up_in_cm() {
        let stl = "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 100 0 0\nvertex 0 50 20\nendloop\nendfacet\nendsolid t\n";
        let p = convert_stl(stl.as_bytes()).unwrap();
        assert_eq!(p.main, "model.obj");
        assert!(obj_text(&p).contains("f 1 2 3"));
        // 100 x 50 x 20 mm, z up -> 10 cm wide, 2 cm high, 5 cm deep
        assert_eq!(p.size_cm, Some([10.0, 2.0, 5.0]));
    }

    #[test]
    fn binary_stl_is_read() {
        let mut data = vec![0u8; 80];
        data.extend(1u32.to_le_bytes());
        data.extend([0u8; 12]);
        for v in [[0.0f32, 0.0, 0.0], [10.0, 0.0, 0.0], [0.0, 10.0, 0.0]] {
            for c in v {
                data.extend(c.to_le_bytes());
            }
        }
        data.extend([0u8; 2]);
        let p = convert_stl(&data).unwrap();
        assert_eq!(obj_text(&p).matches("\nv ").count() + 1, 4);
    }

    #[test]
    fn ascii_ply_with_quad_and_colors() {
        let ply = "ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0 255 0 0\n1 0 0 255 0 0\n1 1 0 255 0 0\n0 1 0 255 0 0\n4 0 1 2 3\n";
        let p = convert_ply(ply.as_bytes()).unwrap();
        let obj = obj_text(&p);
        assert!(obj.contains("f 1 2 3") && obj.contains("f 1 3 4"));
        let mtl = String::from_utf8_lossy(&p.files[1].1).into_owned();
        assert!(mtl.contains("Kd 1 0 0"));
    }

    #[test]
    fn three_mf_model_with_colors_and_units() {
        let xml = r##"<?xml version="1.0"?>
<model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <basematerials id="5"><base name="red" displaycolor="#FF0000FF"/></basematerials>
  <object id="1" type="model" pid="5" pindex="0"><mesh>
   <vertices><vertex x="0" y="0" z="0"/><vertex x="40" y="0" z="0"/><vertex x="0" y="30" z="80"/></vertices>
   <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
  </mesh></object>
 </resources>
 <build><item objectid="1"/></build>
</model>"##;
        let (mesh, cm) = parse_3mf_model(xml).unwrap();
        assert_eq!(cm, 1.0);
        assert_eq!(mesh.triangles.len(), 1);
        assert_eq!(mesh.colors, vec![[1.0, 0.0, 0.0]]);
        let p = mesh.into_package(true, cm).unwrap();
        assert_eq!(p.size_cm, Some([40.0, 80.0, 30.0]));
    }

    #[test]
    fn asc_grid_becomes_a_terrain_mesh_around_its_middle() {
        // 3 x 2 nodes, 10 m apart, lower left cell corner at 500000 / 5200000, rows from north
        let asc = "ncols 3\nnrows 2\nxllcorner 500000\nyllcorner 5200000\ncellsize 10\n\
                   NODATA_value -9999\n402 404 406\n400 401 403\n";
        let p = convert_asc(asc.as_bytes()).unwrap();
        // 20 m wide (x), 6 m high (y up), 10 m deep (z)
        assert_eq!(p.size_cm, Some([2000.0, 600.0, 1000.0]));
        assert_eq!(p.unit_cm, 100.0);
        // The middle of the nodes, in cm from the zero point of the file: east, height, −north
        let c = p.center_cm.unwrap();
        assert_eq!(c, [50_001_500.0, 40_300.0, -520_001_000.0]);
        let obj = obj_text(&p);
        // South-west node: 10 m west and 5 m south of the middle, at the lowest height
        assert!(obj.contains("v -10 0 5\n"), "{obj}");
        // North-east node: 6 m above the lowest one
        assert!(obj.contains("v 10 6 -5\n"), "{obj}");
        assert_eq!(obj.matches("\nf ").count(), 4);
    }

    #[test]
    fn asc_cells_without_height_leave_a_hole() {
        let asc = "ncols 3\nnrows 3\nxllcenter 0\nyllcenter 0\ncellsize 1\nnodata_value -1\n\
                   1 1 1\n1 1 1\n-1 1 1\n";
        let p = convert_asc(asc.as_bytes()).unwrap();
        // Four cells give eight triangles; the cell with the missing corner keeps one of two
        assert_eq!(obj_text(&p).matches("\nf ").count(), 7);
    }

    #[test]
    fn xyz_points_of_a_grid_keep_their_grid() {
        // Title line, then a 3 x 3 grid of 2 m with a decimal comma in the heights
        let mut xyz = String::from("x;y;z\n");
        for row in 0..3 {
            for col in 0..3 {
                xyz.push_str(&format!(
                    "{};{};{},5\n",
                    100 + col * 2,
                    200 + row * 2,
                    row + col
                ));
            }
        }
        let p = convert_xyz(xyz.as_bytes()).unwrap();
        assert_eq!(p.size_cm, Some([400.0, 400.0, 400.0]));
        assert_eq!(p.center_cm, Some([10_200.0, 250.0, -20_200.0]));
        assert_eq!(obj_text(&p).matches("\nf ").count(), 8);
    }

    #[test]
    fn scattered_xyz_points_are_averaged_on_a_grid() {
        // 400 points at odd places on a slope rising to the east
        let mut xyz = String::new();
        for i in 0..400u32 {
            let x = f64::from(i * 7919 % 1000) / 10.0;
            let y = f64::from(i * 104_729 % 1000) / 10.0;
            xyz.push_str(&format!("{x} {y} {}\n", x / 10.0));
        }
        let p = convert_xyz(xyz.as_bytes()).unwrap();
        let size = p.size_cm.unwrap();
        // About 100 m wide and deep, and 10 m high
        assert!((size[0] - 10_000.0).abs() < 800.0, "{size:?}");
        assert!((size[2] - 10_000.0).abs() < 800.0, "{size:?}");
        assert!((size[1] - 1000.0).abs() < 150.0, "{size:?}");
        assert!(obj_text(&p).matches("\nf ").count() > 200);
    }

    #[test]
    fn large_grids_are_thinned() {
        let n = 1000;
        let mut asc = format!("ncols {n}\nnrows {n}\nxllcorner 0\nyllcorner 0\ncellsize 1\n");
        for row in 0..n {
            for col in 0..n {
                asc.push_str(&format!("{} ", (row + col) % 7));
            }
            asc.push('\n');
        }
        let p = convert_asc(asc.as_bytes()).unwrap();
        let vertices = obj_text(&p).matches("\nv ").count();
        assert!(
            vertices <= TERRAIN_MAX_SIDE * TERRAIN_MAX_SIDE,
            "{vertices}"
        );
        assert!(vertices > 200 * 200, "{vertices}");
    }

    #[test]
    fn grids_in_degrees_and_point_clouds_are_refused_with_a_reason() {
        let asc = "ncols 2\nnrows 2\nxllcorner 9.5\nyllcorner 47.2\ncellsize 0.0001\n1 2\n3 4\n";
        let e = convert_asc(asc.as_bytes()).unwrap_err().to_string();
        assert!(e.contains("degrees"), "{e}");
        let ply = "ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\n\
                   property float z\nend_header\n0 0 0\n1 1 1\n";
        let e = convert_ply(ply.as_bytes()).unwrap_err().to_string();
        assert!(e.contains("point cloud"), "{e}");
    }

    #[test]
    fn zip_with_obj_is_unpacked_and_read() {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            let opt = zip::write::SimpleFileOptions::default();
            w.start_file("chair/readme.txt", opt).unwrap();
            std::io::Write::write_all(&mut w, b"hello").unwrap();
            w.start_file("chair/chair.obj", opt).unwrap();
            std::io::Write::write_all(&mut w, b"v 0 0 0\nv 50 0 0\nv 0 90 40\nf 1 2 3\n").unwrap();
            w.finish().unwrap();
        }
        let p = convert_archive(buf.get_ref()).unwrap();
        assert_eq!(p.main, "chair.obj");
        assert_eq!(p.size_cm, Some([50.0, 90.0, 40.0]));
    }
}
