//! Images for the texture import. Sweet Home 3D reads JPEG, PNG, BMP and GIF; WebP and TIFF
//! are converted to PNG, SVG is rendered to PNG, and from PBR material packages (ZIP) the
//! color map is taken.

use std::path::Path;

/// Width in pixels of rendered SVG textures.
const SVG_PX: u32 = 1024;

/// Name parts of color maps in PBR packages, best first.
const COLOR_MAP_NAMES: [&str; 7] = [
    "basecolor",
    "base_color",
    "albedo",
    "diffuse",
    "color",
    "_col",
    "_diff",
];
/// Name parts of the other maps of PBR packages.
const OTHER_MAP_NAMES: [&str; 14] = [
    "normal",
    "rough",
    "metal",
    "_ao",
    "ambientocclusion",
    "occlusion",
    "disp",
    "height",
    "bump",
    "spec",
    "gloss",
    "opacity",
    "alpha",
    "emiss",
];

fn extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

/// An image of a texture: bytes and their file extension (jpg, png, bmp or gif).
pub(crate) struct TextureImage {
    pub data: Vec<u8>,
    pub extension: String,
    /// Name of the image inside a package, for the texture's default name
    pub inner_name: Option<String>,
}

/// Reads the image of a texture from a file in any supported format.
pub(crate) fn read_texture(path: &Path) -> Result<TextureImage, String> {
    let name = path.to_string_lossy().into_owned();
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    if extension(&name) == "zip" {
        return from_package(&data);
    }
    convert(data, &extension(&name))
}

fn convert(data: Vec<u8>, ext: &str) -> Result<TextureImage, String> {
    let png = |data: Vec<u8>| TextureImage {
        data,
        extension: "png".into(),
        inner_name: None,
    };
    match ext {
        "jpg" | "jpeg" | "png" | "bmp" | "gif" => {
            // Kept as it is, so at least its first bytes must be those of an image
            if !matches!(
                image::guess_format(&data),
                Ok(image::ImageFormat::Jpeg
                    | image::ImageFormat::Png
                    | image::ImageFormat::Bmp
                    | image::ImageFormat::Gif)
            ) {
                return Err("cannot read the image: it is no JPEG, PNG, BMP or GIF".into());
            }
            Ok(TextureImage {
                data,
                extension: if ext == "jpeg" {
                    "jpg".into()
                } else {
                    ext.into()
                },
                inner_name: None,
            })
        }
        "webp" | "tif" | "tiff" => {
            let format = if ext == "webp" {
                image::ImageFormat::WebP
            } else {
                image::ImageFormat::Tiff
            };
            let img = image::load_from_memory_with_format(&data, format)
                .map_err(|e| format!("cannot read the image: {e}"))?;
            let mut out = std::io::Cursor::new(Vec::new());
            img.write_to(&mut out, image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
            Ok(png(out.into_inner()))
        }
        "svg" => render_svg(&data).map(png),
        _ => Err(
            "textures must be JPEG, PNG, BMP, GIF, WebP, TIFF or SVG images, or a ZIP \
                  material package"
                .into(),
        ),
    }
}

fn render_svg(data: &[u8]) -> Result<Vec<u8>, String> {
    use resvg::{tiny_skia, usvg};
    let tree = usvg::Tree::from_data(data, &usvg::Options::default()).map_err(|e| e.to_string())?;
    let size = tree.size();
    let scale = SVG_PX as f32 / size.width().max(1.0);
    let height = ((size.height() * scale).round() as u32).max(1);
    let mut pixmap = tiny_skia::Pixmap::new(SVG_PX, height).ok_or("the SVG image is too large")?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    pixmap.encode_png().map_err(|e| e.to_string())
}

/// The color map of a PBR material package (ZIP with several maps).
fn from_package(data: &[u8]) -> Result<TextureImage, String> {
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(|e| e.to_string())?;
    let images: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            archive
                .by_index(i)
                .ok()?
                .name()
                .ok()
                .map(|n| n.into_owned())
        })
        .filter(|n| {
            matches!(
                extension(n).as_str(),
                "jpg" | "jpeg" | "png" | "bmp" | "gif" | "webp" | "tif" | "tiff"
            )
        })
        .collect();
    let file_part = |n: &String| n.rsplit('/').next().unwrap_or(n).to_ascii_lowercase();
    let chosen = COLOR_MAP_NAMES
        .iter()
        .find_map(|part| images.iter().find(|n| file_part(n).contains(part)))
        .or_else(|| {
            // Otherwise the only image that is no other map
            let rest: Vec<&String> = images
                .iter()
                .filter(|n| !OTHER_MAP_NAMES.iter().any(|o| file_part(n).contains(o)))
                .collect();
            (rest.len() == 1).then(|| rest[0])
        })
        .ok_or("the ZIP file contains no color map (an image named like *_Color or *_BaseColor)")?
        .clone();
    let mut entry = archive.by_name(&chosen).map_err(|e| e.to_string())?;
    let declared = entry.size();
    let bytes = msh_format::limits::read_entry(&mut entry, declared).map_err(|e| e.to_string())?;
    drop(entry);
    let mut image = convert(bytes, &extension(&chosen))?;
    image.inner_name = Some(chosen);
    Ok(image)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn svg_is_rendered_to_png() {
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#c00"/></svg>"##;
        let img = convert(svg.to_vec(), "svg").unwrap();
        assert_eq!(img.extension, "png");
        let decoded = image::load_from_memory(&img.data).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (SVG_PX, SVG_PX / 2));
    }

    #[test]
    fn color_map_is_taken_from_a_pbr_package() {
        let mut png = std::io::Cursor::new(Vec::new());
        image::RgbImage::new(4, 4)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            let opt = zip::write::SimpleFileOptions::default();
            for name in ["Wood_Normal.png", "Wood_Roughness.png", "Wood_Color.png"] {
                w.start_file(name, opt).unwrap();
                std::io::Write::write_all(&mut w, png.get_ref()).unwrap();
            }
            w.finish().unwrap();
        }
        let img = from_package(buf.get_ref()).unwrap();
        assert_eq!(img.inner_name.as_deref(), Some("Wood_Color.png"));
        assert_eq!(img.extension, "png");
    }

    #[test]
    fn webp_is_converted_to_png() {
        let mut webp = std::io::Cursor::new(Vec::new());
        image::RgbImage::new(3, 2)
            .write_to(&mut webp, image::ImageFormat::WebP)
            .unwrap();
        let img = convert(webp.into_inner(), "webp").unwrap();
        assert_eq!(img.extension, "png");
        assert_eq!(image::load_from_memory(&img.data).unwrap().width(), 3);
    }
}
