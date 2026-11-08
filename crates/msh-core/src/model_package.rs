//! Collects the files of a 3D model for importing it as furniture.
//!
//! - OBJ: the model, its MTL files and the textures they reference.
//! - DAE (Collada): the model and the images it references.
//! - 3DS: the model and the images next to it whose names appear in the file.
//! - glTF / GLB: converted to OBJ + MTL + textures, because Sweet Home 3D cannot
//!   read glTF. Positions are kept in meters (glTF units).
//!
//! - STL, 3MF, PLY, ZIP and KMZ: see `model_formats`.
//!
//! The size of OBJ, glTF, STL, 3MF and PLY models is computed from their vertices.

use base64::Engine;
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Component, Path, PathBuf};

/// Maximum total size of the files of an imported model.
const MAX_MODEL_BYTES: usize = 200 * 1024 * 1024;

/// The files of a model, ready to be stored in a library or a home.
#[derive(Debug, Clone)]
pub struct ModelPackage {
    /// Main model file (relative name inside the package)
    pub main: String,
    /// All files with their relative names
    pub files: Vec<(String, Vec<u8>)>,
    /// Size along x, y (up) and z in cm, if it could be computed
    pub size_cm: Option<[f32; 3]>,
}

/// Errors while reading a model.
#[derive(Debug, thiserror::Error)]
pub enum ModelError {
    #[error(
        "unsupported model format '{0}' (use OBJ, DAE, 3DS, glTF, GLB, 3MF, STL, PLY, ZIP or KMZ)"
    )]
    Unsupported(String),
    #[error("{0}")]
    Format(String),
    #[error("cannot read {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("invalid glTF model: {0}")]
    Gltf(String),
    #[error("the model files are larger than 200 MB")]
    TooLarge,
    #[error("the model contains no triangles")]
    Empty,
}

fn read(path: &Path) -> Result<Vec<u8>, ModelError> {
    std::fs::read(path).map_err(|source| ModelError::Io {
        path: path.to_owned(),
        source,
    })
}

/// A relative path inside the model folder that does not leave it.
fn safe_relative(name: &str) -> Option<PathBuf> {
    let p = PathBuf::from(name.replace('\\', "/"));
    p.components()
        .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
        .then_some(p)
}

/// Reads the model at `path` with all files it needs.
pub fn collect(path: &Path) -> Result<ModelPackage, ModelError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let dir = path.parent().unwrap_or(Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("model")
        .to_owned();
    let package = match ext.as_str() {
        "obj" => collect_obj(path, dir, &file_name)?,
        "dae" => collect_dae(path, dir, &file_name)?,
        "3ds" => collect_3ds(path, dir, &file_name)?,
        "gltf" | "glb" => convert_gltf(path, dir)?,
        "stl" => crate::model_formats::convert_stl(&read(path)?)?,
        "ply" => crate::model_formats::convert_ply(&read(path)?)?,
        "3mf" => crate::model_formats::convert_3mf(&read(path)?)?,
        "zip" | "kmz" => crate::model_formats::convert_archive(&read(path)?)?,
        other => return Err(ModelError::Unsupported(other.to_owned())),
    };
    let total: usize = package.files.iter().map(|(_, d)| d.len()).sum();
    if total > MAX_MODEL_BYTES {
        return Err(ModelError::TooLarge);
    }
    Ok(package)
}

/// Adds `name` (relative to `dir`) to `files` if it exists and is not there yet.
fn add_file(files: &mut Vec<(String, Vec<u8>)>, dir: &Path, name: &str) {
    let Some(rel) = safe_relative(name.trim()) else {
        return;
    };
    let key = rel.to_string_lossy().replace('\\', "/");
    if files.iter().any(|(n, _)| n.eq_ignore_ascii_case(&key)) {
        return;
    }
    if let Ok(data) = std::fs::read(dir.join(&rel)) {
        files.push((key, data));
    }
}

fn collect_obj(path: &Path, dir: &Path, file_name: &str) -> Result<ModelPackage, ModelError> {
    let data = read(path)?;
    let text = String::from_utf8_lossy(&data).into_owned();
    let mut files = vec![(file_name.to_owned(), data)];
    let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("v ") {
            let v: Vec<f32> = rest
                .split_whitespace()
                .take(3)
                .filter_map(|t| t.parse().ok())
                .collect();
            if v.len() == 3 {
                for i in 0..3 {
                    lo[i] = lo[i].min(v[i]);
                    hi[i] = hi[i].max(v[i]);
                }
            }
        } else if let Some(rest) = line.strip_prefix("mtllib ") {
            let mtl_name = rest.trim();
            add_file(&mut files, dir, mtl_name);
            if let Some((_, mtl)) = files
                .last()
                .filter(|(n, _)| n.ends_with(".mtl") || n.ends_with(".MTL"))
            {
                let mtl = String::from_utf8_lossy(mtl).into_owned();
                for tex in mtl_textures(&mtl) {
                    add_file(&mut files, dir, &tex);
                }
            }
        }
    }
    if lo[0] > hi[0] {
        return Err(ModelError::Empty);
    }
    let extent = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    // OBJ has no unit: small models are most likely in meters, others in cm
    let scale = if extent.iter().cloned().fold(0.0, f32::max) < 10.0 {
        100.0
    } else {
        1.0
    };
    Ok(ModelPackage {
        main: file_name.to_owned(),
        files,
        size_cm: Some(extent.map(|e| e * scale)),
    })
}

/// Texture files referenced by an MTL file (the last token of map_* and bump lines).
fn mtl_textures(mtl: &str) -> Vec<String> {
    mtl.lines()
        .filter_map(|line| {
            let line = line.trim();
            let key = line.split_whitespace().next()?.to_ascii_lowercase();
            let is_map = key.starts_with("map_")
                || matches!(key.as_str(), "bump" | "disp" | "decal" | "refl");
            is_map.then(|| {
                line.split_whitespace()
                    .last()
                    .unwrap_or_default()
                    .to_owned()
            })
        })
        .collect()
}

fn collect_dae(path: &Path, dir: &Path, file_name: &str) -> Result<ModelPackage, ModelError> {
    let data = read(path)?;
    let text = String::from_utf8_lossy(&data).into_owned();
    let mut files = vec![(file_name.to_owned(), data)];
    for part in text.split("<init_from>").skip(1) {
        if let Some(end) = part.find("</init_from>") {
            let name = part[..end]
                .trim()
                .trim_start_matches("file:///")
                .trim_start_matches("./");
            add_file(&mut files, dir, &percent_decode(name));
        }
    }
    Ok(ModelPackage {
        main: file_name.to_owned(),
        files,
        size_cm: None,
    })
}

/// Decodes %20 and similar escapes in Collada image paths.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16)
        {
            out.push(v);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn collect_3ds(path: &Path, dir: &Path, file_name: &str) -> Result<ModelPackage, ModelError> {
    let data = read(path)?;
    let haystack = String::from_utf8_lossy(&data).to_ascii_lowercase();
    let mut files = vec![(file_name.to_owned(), data)];
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let lower = name.to_ascii_lowercase();
            let is_image = [".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tga"]
                .iter()
                .any(|e| lower.ends_with(e));
            if is_image && haystack.contains(&lower) {
                add_file(&mut files, dir, &name);
            }
        }
    }
    Ok(ModelPackage {
        main: file_name.to_owned(),
        files,
        size_cm: None,
    })
}

// ---------------------------------------------------------------- glTF → OBJ

type Mat4 = [[f32; 4]; 4];

fn mul(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut r = [[0.0; 4]; 4];
    for (c, col) in r.iter_mut().enumerate() {
        for (row, v) in col.iter_mut().enumerate() {
            *v = (0..4).map(|k| a[k][row] * b[c][k]).sum();
        }
    }
    r
}

/// Applies a column-major matrix to a point (w = 1) or a direction (w = 0).
fn transform(m: &Mat4, p: [f32; 3], w: f32) -> [f32; 3] {
    let mut out = [0.0; 3];
    for (row, o) in out.iter_mut().enumerate() {
        *o = m[0][row] * p[0] + m[1][row] * p[1] + m[2][row] * p[2] + m[3][row] * w;
    }
    out
}

fn convert_gltf(path: &Path, dir: &Path) -> Result<ModelPackage, ModelError> {
    let bytes = read(path)?;
    let gltf = gltf::Gltf::from_slice(&bytes).map_err(|e| ModelError::Gltf(e.to_string()))?;
    let decode_uri = |uri: &str| -> Result<Vec<u8>, ModelError> {
        if let Some(rest) = uri.strip_prefix("data:") {
            let b64 = rest.split_once(',').map(|(_, d)| d).unwrap_or_default();
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| ModelError::Gltf(e.to_string()))
        } else {
            let rel = safe_relative(&percent_decode(uri))
                .ok_or_else(|| ModelError::Gltf(format!("invalid resource path {uri}")))?;
            read(&dir.join(rel))
        }
    };
    let mut buffers = Vec::new();
    for buffer in gltf.document.buffers() {
        buffers.push(match buffer.source() {
            gltf::buffer::Source::Bin => gltf
                .blob
                .clone()
                .ok_or_else(|| ModelError::Gltf("missing binary chunk".into()))?,
            gltf::buffer::Source::Uri(uri) => decode_uri(uri)?,
        });
    }

    let mut obj =
        String::from("# Converted from glTF by My Sweet Home (units: meters)\nmtllib model.mtl\n");
    let mut mtl = String::from("# Converted from glTF by My Sweet Home\n");
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let mut materials_written: BTreeMap<Option<usize>, String> = BTreeMap::new();
    let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
    let (mut nv, mut nt, mut nn) = (0usize, 0usize, 0usize);

    let mut write_material = |material: gltf::Material,
                              files: &mut Vec<(String, Vec<u8>)>|
     -> Result<String, ModelError> {
        let key = material.index();
        if let Some(name) = materials_written.get(&key) {
            return Ok(name.clone());
        }
        let name = format!(
            "material_{}",
            key.map_or("default".into(), |i| i.to_string())
        );
        let pbr = material.pbr_metallic_roughness();
        let [r, g, b, a] = pbr.base_color_factor();
        let _ = writeln!(
            mtl,
            "\nnewmtl {name}\nKa 0 0 0\nKd {r} {g} {b}\nKs 0.1 0.1 0.1\nNs 20\nd {a}"
        );
        if let Some(info) = pbr.base_color_texture() {
            let image = info.texture().source();
            let (data, mime) = match image.source() {
                gltf::image::Source::View { view, mime_type } => {
                    let buf = &buffers[view.buffer().index()];
                    let start = view.offset();
                    let end = start + view.length();
                    (
                        buf.get(start..end).unwrap_or_default().to_vec(),
                        Some(mime_type),
                    )
                }
                gltf::image::Source::Uri { uri, mime_type } => (decode_uri(uri)?, mime_type),
            };
            let ext = match mime {
                Some("image/jpeg") => "jpg",
                Some("image/png") => "png",
                _ if data.starts_with(&[0xFF, 0xD8]) => "jpg",
                _ => "png",
            };
            let tex_name = format!("texture_{}.{ext}", image.index());
            if !files.iter().any(|(n, _)| n == &tex_name) {
                files.push((tex_name.clone(), data));
            }
            let _ = writeln!(mtl, "map_Kd {tex_name}");
        }
        materials_written.insert(key, name.clone());
        Ok(name)
    };

    let scene = gltf
        .document
        .default_scene()
        .or_else(|| gltf.document.scenes().next())
        .ok_or(ModelError::Empty)?;
    let identity: Mat4 = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ];
    let mut stack: Vec<(gltf::Node, Mat4)> = scene.nodes().map(|n| (n, identity)).collect();
    while let Some((node, parent)) = stack.pop() {
        let world = mul(&parent, &node.transform().matrix());
        for child in node.children() {
            stack.push((child, world));
        }
        let Some(mesh) = node.mesh() else { continue };
        let _ = writeln!(
            obj,
            "o {}",
            mesh.name()
                .unwrap_or("mesh")
                .replace(char::is_whitespace, "_")
        );
        for primitive in mesh.primitives() {
            if primitive.mode() != gltf::mesh::Mode::Triangles {
                continue;
            }
            let reader = primitive.reader(|b| buffers.get(b.index()).map(Vec::as_slice));
            let Some(positions) = reader.read_positions() else {
                continue;
            };
            let positions: Vec<[f32; 3]> = positions.map(|p| transform(&world, p, 1.0)).collect();
            let normals: Option<Vec<[f32; 3]>> = reader.read_normals().map(|it| {
                it.map(|n| {
                    let t = transform(&world, n, 0.0);
                    let len = (t[0] * t[0] + t[1] * t[1] + t[2] * t[2]).sqrt().max(1e-12);
                    [t[0] / len, t[1] / len, t[2] / len]
                })
                .collect()
            });
            let uvs: Option<Vec<[f32; 2]>> =
                reader.read_tex_coords(0).map(|t| t.into_f32().collect());
            let indices: Vec<u32> = match reader.read_indices() {
                Some(i) => i.into_u32().collect(),
                None => (0..positions.len() as u32).collect(),
            };
            let material = write_material(primitive.material(), &mut files)?;
            let _ = writeln!(obj, "usemtl {material}");
            for p in &positions {
                for i in 0..3 {
                    lo[i] = lo[i].min(p[i]);
                    hi[i] = hi[i].max(p[i]);
                }
                let _ = writeln!(obj, "v {} {} {}", p[0], p[1], p[2]);
            }
            if let Some(uvs) = &uvs {
                for t in uvs {
                    // glTF has its texture origin at the top, OBJ at the bottom
                    let _ = writeln!(obj, "vt {} {}", t[0], 1.0 - t[1]);
                }
            }
            if let Some(normals) = &normals {
                for n in normals {
                    let _ = writeln!(obj, "vn {} {} {}", n[0], n[1], n[2]);
                }
            }
            for tri in indices.as_chunks::<3>().0 {
                obj.push('f');
                for &i in tri {
                    let i = i as usize;
                    let v = nv + i + 1;
                    match (&uvs, &normals) {
                        (Some(_), Some(_)) => write!(obj, " {v}/{}/{}", nt + i + 1, nn + i + 1),
                        (Some(_), None) => write!(obj, " {v}/{}", nt + i + 1),
                        (None, Some(_)) => write!(obj, " {v}//{}", nn + i + 1),
                        (None, None) => write!(obj, " {v}"),
                    }
                    .ok();
                }
                obj.push('\n');
            }
            nv += positions.len();
            nt += uvs.as_ref().map_or(0, Vec::len);
            nn += normals.as_ref().map_or(0, Vec::len);
        }
    }
    if nv == 0 {
        return Err(ModelError::Empty);
    }
    let mut all = vec![
        ("model.obj".to_owned(), obj.into_bytes()),
        ("model.mtl".to_owned(), mtl.into_bytes()),
    ];
    all.extend(files);
    Ok(ModelPackage {
        main: "model.obj".into(),
        files: all,
        size_cm: Some([
            (hi[0] - lo[0]) * 100.0,
            (hi[1] - lo[1]) * 100.0,
            (hi[2] - lo[2]) * 100.0,
        ]),
    })
}

/// A small placeholder icon (light gray square with a frame) as PNG, for imports
/// without a rendered icon.
pub fn placeholder_icon() -> Vec<u8> {
    const SIZE: u32 = 64;
    let mut raw = Vec::new();
    for y in 0..SIZE {
        raw.push(0); // filter: none
        for x in 0..SIZE {
            let edge = x < 4 || y < 4 || x >= SIZE - 4 || y >= SIZE - 4;
            let v = if edge { 120 } else { 210 };
            raw.extend_from_slice(&[v, v, v]);
        }
    }
    png_rgb(SIZE, SIZE, &raw)
}

/// Minimal PNG encoder (RGB, stored deflate blocks).
fn png_rgb(width: u32, height: u32, raw: &[u8]) -> Vec<u8> {
    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xFFFF_FFFFu32;
        for &b in data {
            crc ^= u32::from(b);
            for _ in 0..8 {
                crc = if crc & 1 != 0 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }
    fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let mut body = kind.to_vec();
        body.extend_from_slice(data);
        out.extend_from_slice(&body);
        out.extend_from_slice(&crc32(&body).to_be_bytes());
    }
    let mut zlib = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = raw.chunks(65_535).collect();
    for (i, block) in blocks.iter().enumerate() {
        zlib.push(u8::from(i + 1 == blocks.len()));
        let len = block.len() as u16;
        zlib.extend_from_slice(&len.to_le_bytes());
        zlib.extend_from_slice(&(!len).to_le_bytes());
        zlib.extend_from_slice(block);
    }
    let (mut a, mut b) = (1u32, 0u32);
    for &byte in raw {
        a = (a + u32::from(byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    zlib.extend_from_slice(&((b << 16) | a).to_be_bytes());
    let mut out = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(&mut out, b"IHDR", &ihdr);
    chunk(&mut out, b"IDAT", &zlib);
    chunk(&mut out, b"IEND", &[]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obj_with_mtl_and_texture_is_collected_with_its_size() {
        let dir = std::env::temp_dir().join(format!("msh-obj-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("tex")).unwrap();
        std::fs::write(
            dir.join("box.obj"),
            "mtllib box.mtl\nv 0 0 0\nv 50 0 0\nv 50 80 30\nusemtl m\nf 1 2 3\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("box.mtl"),
            "newmtl m\nKd 1 0 0\nmap_Kd -s 1 1 1 tex/wood.png\n",
        )
        .unwrap();
        std::fs::write(dir.join("tex/wood.png"), placeholder_icon()).unwrap();
        let p = collect(&dir.join("box.obj")).unwrap();
        let names: Vec<&str> = p.files.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, vec!["box.obj", "box.mtl", "tex/wood.png"]);
        assert_eq!(p.size_cm, Some([50.0, 80.0, 30.0]));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn gltf_triangle_is_converted_to_obj() {
        // One triangle (1 m wide, 2 m high) as embedded glTF with a data URI buffer
        let positions: [f32; 9] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 2.0, 0.0];
        let bytes: Vec<u8> = positions.iter().flat_map(|v| v.to_le_bytes()).collect();
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let json = format!(
            r#"{{"asset":{{"version":"2.0"}},"scene":0,"scenes":[{{"nodes":[0]}}],
            "nodes":[{{"mesh":0}}],"meshes":[{{"primitives":[{{"attributes":{{"POSITION":0}}}}]}}],
            "accessors":[{{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3",
            "min":[0,0,0],"max":[1,2,0]}}],
            "bufferViews":[{{"buffer":0,"byteLength":36}}],
            "buffers":[{{"byteLength":36,"uri":"data:application/octet-stream;base64,{b64}"}}]}}"#
        );
        let dir = std::env::temp_dir().join(format!("msh-gltf-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("tri.gltf"), json).unwrap();
        let p = collect(&dir.join("tri.gltf")).unwrap();
        assert_eq!(p.main, "model.obj");
        let obj = String::from_utf8(p.files[0].1.clone()).unwrap();
        assert!(obj.contains("v 1 0 0") && obj.contains("f 1 2 3"), "{obj}");
        assert_eq!(p.size_cm, Some([100.0, 200.0, 0.0]));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn placeholder_icon_is_a_png() {
        let png = placeholder_icon();
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']));
    }
}
