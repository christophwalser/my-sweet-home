//! Exports of My Sweet Home.
//!
//! - [`plan_svg`] draws the 2D plan of one level as SVG (plan coordinates in cm,
//!   y axis down, like Sweet Home 3D); [`svg_to_png`] rasterizes it. The
//!   default options give visual feedback for agents (`view_plan_image`),
//!   [`PlanOptions::export`] the plan as shown in the app (`export_plan`).
//! - [`plan_page_svg`] places a plan on a paper page at a scale and
//!   [`pdf_from_svg_pages`] turns pages into a PDF document.
//! - [`furniture_pages`] and [`image_page`] make the other pages of a printed home;
//!   [`page_svgs`] adds titles, footers and page numbers.
//! - [`furniture_csv`] writes the furniture list.

mod csv;
mod pages;
mod plan;

pub use csv::{COLUMNS as FURNITURE_COLUMNS, furniture_csv, resolve_columns};
pub use pages::{
    Page, PageFrame, PageOptions, Paper, expand_page_format, furniture_pages, image_page,
    page_svgs, page_svgs_framed, pdf_from_svg_pages, plan_page, plan_page_svg,
};
pub use plan::{PlanDrawing, PlanOptions, draw_plan, format_length, plan_images, plan_svg};

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

#[cfg(test)]
mod tests {
    use super::*;
    use msh_model::{Home, Wall, WallAttrs};

    fn one_wall() -> Home {
        Home {
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
        }
    }

    #[test]
    fn plan_of_one_wall_renders_to_png() {
        let svg = plan_svg(&one_wall(), &PlanOptions::default());
        assert!(svg.contains("<polygon"));
        let png = svg_to_png(&svg, 400).unwrap();
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']));
    }

    #[test]
    fn exported_plan_uses_wall_patterns_and_no_grid() {
        let svg = plan_svg(&one_wall(), &PlanOptions::export(None));
        assert!(svg.contains("<pattern"));
        assert!(!svg.contains("1 m</text>"));
    }

    #[test]
    fn plan_page_becomes_a_pdf() {
        let drawing = draw_plan(&one_wall(), &PlanOptions::export(None));
        let (page, scale) = plan_page_svg(
            &drawing,
            &PageOptions {
                scale: Some(50.0),
                title: Some("Test".into()),
                ..Default::default()
            },
        );
        assert_eq!(scale, 50.0);
        let pdf = pdf_from_svg_pages(&[page.clone(), page]).unwrap();
        assert!(pdf.starts_with(b"%PDF"));
    }
}
