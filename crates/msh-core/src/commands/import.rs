//! Importing textures and furniture into the user's own libraries.

use crate::catalog::CatalogIndex;
use crate::model_package::{collect, placeholder_icon};
use crate::registry::{CommandError, Registry};
use base64::Engine;
use msh_catalog::CatalogKind;
use msh_catalog::library_edit::{is_editable, record};
use msh_catalog::user_library::{
    NewFurniture, NewTexture, add_furniture, add_texture, default_library_path,
};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;
use std::path::{Path, PathBuf};

#[derive(Deserialize, JsonSchema)]
struct TextureImportParams {
    /// Image file (JPEG, PNG, BMP or GIF)
    path: PathBuf,
    /// Name in the catalog (default: the file name)
    name: Option<String>,
    /// Catalog category (default "My textures")
    category: Option<String>,
    /// Width of one tile of the texture in cm (default 100)
    width: Option<f32>,
    /// Height of one tile in cm (default: same as width)
    height: Option<f32>,
    creator: Option<String>,
    /// Target library (default: the user's own "My textures"); see library_list
    library: Option<PathBuf>,
}

#[derive(Deserialize, JsonSchema)]
struct FurnitureImportParams {
    /// 3D model file: OBJ (with its MTL and texture files next to it), DAE, 3DS, glTF, GLB,
    /// 3MF, STL, PLY, or a ZIP / KMZ archive with one of them. Formats other than OBJ, DAE and
    /// 3DS are converted to OBJ (FBX and VRML are converted by the app's import dialog).
    model_path: PathBuf,
    /// Name in the catalog (default: the file name)
    name: Option<String>,
    /// Catalog category (default "My furniture")
    category: Option<String>,
    /// Size in cm. Missing values are taken from the model (OBJ, glTF, 3MF, STL, PLY) keeping its
    /// proportions; DAE and 3DS models need at least one of them.
    width: Option<f32>,
    depth: Option<f32>,
    height: Option<f32>,
    /// Elevation above the floor in cm (default 0)
    elevation: Option<f32>,
    /// The piece is a door or window (cuts openings into walls)
    door_or_window: Option<bool>,
    /// The piece is a staircase: it cuts a hole in the floor of the level above and the
    /// virtual visitor can walk up its steps
    staircase: Option<bool>,
    /// Outline of that hole as SVG path in the unit square of the piece seen from above
    /// (x to the right, y to the front), e.g. "M0,0 L1,0 L1,1 L0,1 Z" (the default)
    staircase_cut_out_shape: Option<String>,
    /// The piece can be moved (default true)
    movable: Option<bool>,
    /// 3x3 rotation matrix (row major) that turns the model upright and to the front,
    /// e.g. [1,0,0, 0,0,1, 0,-1,0] for models with z up
    model_rotation: Option<[f32; 9]>,
    /// Icon as PNG (base64); a neutral placeholder is used if missing
    icon_png_base64: Option<String>,
    creator: Option<String>,
    /// Target library (default: the user's own "My furniture"); see library_list
    library: Option<PathBuf>,
}

/// The library an import goes to: the given one (it must be editable) or the user's own.
fn target_library(library: Option<PathBuf>, kind: CatalogKind) -> Result<PathBuf, CommandError> {
    match library {
        Some(p) if is_editable(&p) => Ok(p),
        Some(p) => Err(CommandError::failed(format!(
            "{} cannot be changed (only libraries in the user's library folders)",
            p.display()
        ))),
        None => default_library_path(kind).map_err(|e| CommandError::failed(e.to_string())),
    }
}

/// Cut-out of a staircase over its whole width and depth (as Sweet Home 3D's import).
const FULL_CUT_OUT: &str = "M0,0 v1 h1 v-1 z";

/// Size of the model after `rotation` (each axis of the result as extent of the rotated box).
fn rotated_size(size: [f32; 3], rotation: Option<[f32; 9]>) -> [f32; 3] {
    let Some(r) = rotation else { return size };
    let mut out = [0.0; 3];
    for (row, o) in out.iter_mut().enumerate() {
        *o = (0..3).map(|c| r[row * 3 + c].abs() * size[c]).sum();
    }
    out
}

/// File name without extension.
pub(super) fn stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Imported")
        .to_owned()
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "furniture_import",
        "Imports a 3D model (OBJ, DAE, 3DS, glTF, GLB, 3MF, STL, PLY, or a ZIP / KMZ archive \
         with one of them) as piece of furniture into the user's furniture library 'My furniture' (shared with Sweet Home 3D). Returns its catalog ID; \
         place it with furniture_add.",
        false,
        |_doc, p: FurnitureImportParams| {
            let package =
                collect(&p.model_path).map_err(|e| CommandError::failed(e.to_string()))?;
            // Size: given values, the rest from the model keeping its proportions
            let model = package.size_cm.map(|s| rotated_size(s, p.model_rotation));
            let size = match (p.width, p.depth, p.height, model) {
                (Some(w), Some(d), Some(h), _) => [w, d, h],
                (w, d, h, Some([mx, my, mz])) => {
                    let base = [mx, mz, my]; // width = x, depth = z, height = y (up)
                    let factor = [w, d, h]
                        .iter()
                        .zip(base)
                        .find_map(|(given, b)| given.filter(|_| b > 0.0).map(|g| g / b))
                        .unwrap_or(1.0);
                    [
                        w.unwrap_or(base[0] * factor),
                        d.unwrap_or(base[1] * factor),
                        h.unwrap_or(base[2] * factor),
                    ]
                }
                _ => {
                    return Err(CommandError::failed(
                        "the size of DAE and 3DS models cannot be computed: give width, depth \
                         and height",
                    ));
                }
            };
            let size = size.map(|v| (v * 10.0).round() / 10.0);
            if size.iter().any(|v| *v <= 0.0) {
                return Err(CommandError::failed(format!(
                    "the model has no extent in one direction ({size:?} cm); give its size"
                )));
            }
            let icon = match &p.icon_png_base64 {
                Some(b64) => base64::engine::general_purpose::STANDARD
                    .decode(b64.trim_start_matches("data:image/png;base64,"))
                    .map_err(|e| CommandError::failed(format!("invalid icon: {e}")))?,
                None => placeholder_icon(),
            };
            let target = target_library(p.library, CatalogKind::Furniture)?;
            let added = record("import", std::slice::from_ref(&target), || add_furniture(NewFurniture {
                name: p.name.unwrap_or_else(|| stem(&p.model_path)),
                category: p.category.unwrap_or_else(|| "My furniture".into()),
                creator: p.creator,
                icon,
                model: package.main.clone(),
                model_files: package.files,
                width: size[0],
                depth: size[1],
                height: size[2],
                elevation: p.elevation.unwrap_or(0.0),
                movable: p.movable.unwrap_or(true),
                door_or_window: p.door_or_window.unwrap_or(false),
                model_rotation: p.model_rotation,
                staircase_cut_out_shape: p.staircase_cut_out_shape.or_else(|| {
                    p.staircase
                        .unwrap_or(false)
                        .then(|| FULL_CUT_OUT.to_owned())
                }),
                library: Some(target.clone()),
            }))
            .map_err(|e| CommandError::failed(e.to_string()))?;
            CatalogIndex::reload();
            Ok(json!({
                "catalog_id": added.catalog_id,
                "library": added.library,
                "width": size[0],
                "depth": size[1],
                "height": size[2],
            }))
        },
    );
    r.add(
        "texture_import",
        "Imports an image as texture into the user's texture library 'My textures' (shared \
         with Sweet Home 3D): JPEG, PNG, BMP, GIF, WebP, TIFF, SVG, or a PBR material package \
         (ZIP, its color map is used). Returns its catalog ID, usable as wall, floor or \
         ceiling texture.",
        false,
        |_doc, p: TextureImportParams| {
            let texture = crate::texture_formats::read_texture(Path::new(&p.path))
                .map_err(CommandError::failed)?;
            let width = p.width.unwrap_or(100.0);
            let height = p.height.unwrap_or(width);
            if width <= 0.0 || height <= 0.0 {
                return Err(CommandError::failed("width and height must be positive"));
            }
            let target = target_library(p.library, CatalogKind::Textures)?;
            let added = record("import", std::slice::from_ref(&target), || {
                add_texture(NewTexture {
                    // From a material package: the package's name, not the color map's
                    name: p.name.unwrap_or_else(|| stem(&p.path)),
                    category: p.category.unwrap_or_else(|| "My textures".into()),
                    creator: p.creator,
                    image: texture.data,
                    image_extension: texture.extension,
                    width,
                    height,
                    library: Some(target.clone()),
                })
            })
            .map_err(|e| CommandError::failed(e.to_string()))?;
            CatalogIndex::reload();
            Ok(json!({ "catalog_id": added.catalog_id, "library": added.library }))
        },
    );
}
