//! What roofs, stairs and floor openings share: they are pieces of furniture with a model made
//! here, that keep what they were made from in a property of our own.

use super::parse_color;
use crate::Document;
use crate::catalog::CatalogIndex;
use crate::registry::CommandError;
use msh_geometry::roof::P2;
use serde::{Deserialize, Serialize};
use std::fmt::Write;

/// A texture of a generated model. Its image lies among the files of the model, so the model
/// can be made again without the catalog the texture came from.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(super) struct ModelTexture {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_id: Option<String>,
    /// Name of the image among the files of the model
    pub file: String,
    /// Width and height of one tile of the image in cm
    pub width: f64,
    pub height: f64,
}

/// The image of a texture a generated model has, from the files of the model.
pub(super) fn kept_image(
    doc: &Document,
    model: Option<&str>,
    texture: &Option<ModelTexture>,
) -> Option<Vec<u8>> {
    let folder = model?.split_once('/')?.0;
    let name = format!("{folder}/{}", texture.as_ref()?.file);
    let content = doc.file.contents.iter().find(|c| c.name == name)?;
    Some(content.data.clone())
}

/// Sets a texture from a parameter: nothing if it is not given, no texture for "", else the
/// catalog texture with this ID. `stem` names its image among the files of the model.
pub(super) fn set_texture(
    texture: &mut Option<ModelTexture>,
    image: &mut Option<Vec<u8>>,
    given: &Option<String>,
    stem: &str,
) -> Result<(), CommandError> {
    let Some(id) = given else {
        return Ok(());
    };
    if id.is_empty() {
        *texture = None;
        *image = None;
        return Ok(());
    }
    let entry = CatalogIndex::get()
        .texture_by_id(id)
        .ok_or_else(|| CommandError::failed(format!("unknown texture '{id}'")))?
        .clone();
    let data = msh_catalog::read_resource(&entry.library, &entry.item.image)
        .map_err(|e| CommandError::failed(e.to_string()))?;
    let extension = if data.starts_with(b"\x89PNG") {
        "png".to_owned()
    } else if data.starts_with(&[0xFF, 0xD8]) {
        "jpg".to_owned()
    } else {
        std::path::Path::new(&entry.item.image)
            .extension()
            .and_then(|e| e.to_str())
            .filter(|e| e.chars().all(|c| c.is_ascii_alphanumeric()))
            .map_or_else(|| "png".to_owned(), str::to_ascii_lowercase)
    };
    let side = |v: f32| if v > 0.0 { f64::from(v) } else { 100.0 };
    *texture = Some(ModelTexture {
        name: entry.item.name.clone(),
        catalog_id: entry.item.id.clone(),
        file: format!("{stem}.{extension}"),
        width: side(entry.item.width),
        height: side(entry.item.height),
    });
    *image = Some(data);
    Ok(())
}

pub(super) fn round(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

pub(super) fn rgb(color: &str) -> Result<[f32; 3], CommandError> {
    let c = parse_color(color)?.0;
    Ok([(c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF].map(|v| v as f32 / 255.0))
}

/// A number parameter clamped to a range, or an error if it is not a number.
pub(super) fn limited(
    name: &str,
    v: Option<f32>,
    min: f64,
    max: f64,
) -> Result<Option<f64>, CommandError> {
    match v {
        None => Ok(None),
        Some(v) if v.is_finite() => Ok(Some(f64::from(v).clamp(min, max))),
        Some(_) => Err(CommandError::failed(format!("{name} must be a number"))),
    }
}

pub(super) fn bounds(points: &[P2]) -> (P2, P2) {
    let (mut lo, mut hi) = ([f64::MAX; 2], [f64::MIN; 2]);
    for p in points {
        for i in 0..2 {
            lo[i] = lo[i].min(p[i]);
            hi[i] = hi[i].max(p[i]);
        }
    }
    (lo, hi)
}

pub(super) fn checked_points(points: &[[f32; 2]]) -> Result<Vec<P2>, CommandError> {
    if points.iter().flatten().any(|v| !v.is_finite()) {
        return Err(CommandError::failed("points must be numbers"));
    }
    Ok(points
        .iter()
        .map(|p| [f64::from(p[0]), f64::from(p[1])])
        .collect())
}

/// The middle of an outline in the plan, the angle its piece is turned by and its corners
/// relative to that middle before the turn. The longest edge runs along the width or the
/// depth of the piece, turned by no more than 45°.
pub(super) fn frame(points: &[P2]) -> (P2, f64, Vec<P2>) {
    let n = points.len();
    let mut longest = (0.0, 0.0);
    for i in 0..n {
        let (a, b) = (points[i], points[(i + 1) % n]);
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        if dx.hypot(dy) > longest.0 + 1e-6 {
            longest = (dx.hypot(dy), dy.atan2(dx));
        }
    }
    let quarter = std::f64::consts::FRAC_PI_2;
    let mut angle = longest.1.rem_euclid(quarter);
    if angle > quarter / 2.0 {
        angle -= quarter;
    }
    if angle.abs() < 1e-9 {
        angle = 0.0;
    }
    let (sin, cos) = angle.sin_cos();
    let turned: Vec<P2> = points
        .iter()
        .map(|p| [p[0] * cos + p[1] * sin, -p[0] * sin + p[1] * cos])
        .collect();
    let (lo, hi) = bounds(&turned);
    let mid = [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0];
    let local = turned
        .iter()
        .map(|p| [p[0] - mid[0], p[1] - mid[1]])
        .collect();
    (
        [mid[0] * cos - mid[1] * sin, mid[0] * sin + mid[1] * cos],
        angle,
        local,
    )
}

/// A surface of a generated model with its material.
pub(super) struct ModelPart {
    /// Name of the group and of the material
    pub name: &'static str,
    pub color: [f32; 3],
    /// Shown instead of the color
    pub texture: Option<(ModelTexture, Vec<u8>)>,
}

/// A triangle of a generated model: its corners, its normal and the index of its part.
pub(super) struct ModelTriangle {
    pub corners: [u32; 3],
    pub normal: [f64; 3],
    pub part: usize,
}

/// Writes a model as OBJ and MTL with the images of its textures, stores it in the document
/// and returns the resource name of the OBJ and the size of all files. `uvs` are in cm; they
/// are divided by the size of the texture of the part (one meter without one).
pub(super) fn store_model(
    doc: &mut Document,
    stem: &str,
    positions: &[[f64; 3]],
    uvs: &[[f64; 2]],
    triangles: &[ModelTriangle],
    parts: Vec<ModelPart>,
) -> (String, i64) {
    let number = |v: f64| {
        let v = (v * 1000.0).round() / 1000.0;
        // No "-0"
        if v == 0.0 { 0.0 } else { v }
    };
    let fine = |v: f64| {
        let v = (v * 10000.0).round() / 10000.0;
        if v == 0.0 { 0.0 } else { v }
    };
    let mut obj = format!("mtllib {stem}.mtl\n");
    for p in positions {
        let _ = writeln!(obj, "v {} {} {}", number(p[0]), number(p[1]), number(p[2]));
    }
    let mut tiles = vec![[100.0, 100.0]; positions.len()];
    for t in triangles {
        let tile = parts[t.part]
            .texture
            .as_ref()
            .map_or([100.0, 100.0], |(texture, _)| {
                [texture.width, texture.height]
            });
        for corner in t.corners {
            tiles[corner as usize] = tile;
        }
    }
    for (uv, tile) in uvs.iter().zip(&tiles) {
        let _ = writeln!(
            obj,
            "vt {} {}",
            fine(uv[0] / tile[0]),
            fine(uv[1] / tile[1])
        );
    }
    for t in triangles {
        let [x, y, z] = t.normal.map(number);
        let _ = writeln!(obj, "vn {x} {y} {z}");
    }
    let mut mtl = String::new();
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for (index, part) in parts.into_iter().enumerate() {
        if !triangles.iter().any(|t| t.part == index) {
            continue;
        }
        let name = part.name;
        match part.texture {
            // The texture is shown as it is, not tinted by the color
            Some((texture, image)) => {
                let _ = writeln!(
                    mtl,
                    "newmtl {name}\nKd 1 1 1\nKa 0 0 0\nmap_Kd {}\n",
                    texture.file
                );
                if !files.iter().any(|f| f.0 == texture.file) {
                    files.push((texture.file.clone(), image));
                }
            }
            None => {
                let [r, g, b] = part.color;
                let _ = writeln!(mtl, "newmtl {name}\nKd {r} {g} {b}\nKa 0 0 0\n");
            }
        }
        let _ = writeln!(obj, "g {name}\nusemtl {name}");
        for (i, t) in triangles.iter().enumerate() {
            if t.part == index {
                let [a, b, c] = t.corners.map(|c| c + 1);
                let n = i + 1;
                let _ = writeln!(obj, "f {a}/{a}/{n} {b}/{b}/{n} {c}/{c}/{n}");
            }
        }
    }
    let model_size =
        (obj.len() + mtl.len() + files.iter().map(|f| f.1.len()).sum::<usize>()) as i64;
    files.push((format!("{stem}.obj"), obj.into_bytes()));
    files.push((format!("{stem}.mtl"), mtl.into_bytes()));
    let folder = doc.add_or_reuse_folder(files);
    (format!("{folder}/{stem}.obj"), model_size)
}

/// The value of a property of a piece read as JSON.
pub(super) fn property_data<T: serde::de::DeserializeOwned>(
    piece: &msh_model::Piece,
    name: &str,
) -> Option<T> {
    let value = &piece.properties.iter().find(|p| p.name == name)?.value;
    serde_json::from_str(value).ok()
}
