//! Exports of My Sweet Home.
//!
//! - [`plan_svg`] draws the 2D plan of one level as SVG (plan coordinates in cm,
//!   y axis down, like Sweet Home 3D); [`svg_to_png`] rasterizes it. The
//!   default options give visual feedback for agents (`view_plan_image`),
//!   [`PlanOptions::export`] the plan as shown in the app (`export_plan`).
//! - [`plan_pages`] places a plan on paper pages at a scale (split into several pages if it
//!   is too large, with a title block if wanted) and
//!   [`pdf_from_svg_pages`] turns pages into a PDF document.
//! - [`furniture_pages`] and [`image_page`] make the other pages of a printed home;
//!   [`page_svgs`] adds titles, footers and page numbers.
//! - [`plan_dxf`] writes the plan as DXF drawing with a layer for each kind of element.
//! - [`furniture_csv`] writes the furniture list.

mod csv;
mod dimension;
mod dxf;
mod pages;
mod plan;

pub use csv::{COLUMNS as FURNITURE_COLUMNS, furniture_csv, resolve_columns};
pub use dimension::{
    DIMENSION_STYLE_PROPERTY, DimensionStyle, DimensionUnit, EndMark, dimension_style,
};
pub use dxf::{DxfUnit, LAYERS as DXF_LAYERS, plan_dxf};
pub use pages::{
    Page, PageFrame, PageOptions, Paper, PlanPages, TitleBlock, expand_page_format,
    furniture_pages, image_page, page_svgs, page_svgs_framed, pdf_from_svg_pages, plan_pages,
    plan_pages_svg,
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
        let (pages, laid) = plan_pages_svg(
            &drawing,
            &PageOptions {
                scale: Some(50.0),
                title: Some("Test".into()),
                ..Default::default()
            },
        );
        assert_eq!(laid.scale, 50.0);
        assert_eq!(pages.len(), 1);
        let pdf = pdf_from_svg_pages(&[pages[0].clone(), pages[0].clone()]).unwrap();
        assert!(pdf.starts_with(b"%PDF"));
    }

    #[test]
    fn a_plan_too_large_for_its_scale_is_split_into_pages() {
        // A wall of 4 m at 1:10 is 400 mm long: two A4 pages across in portrait, or one
        // landscape page (277 mm wide) is not enough either
        let drawing = draw_plan(&one_wall(), &PlanOptions::export(None));
        let opts = PageOptions {
            scale: Some(10.0),
            landscape: Some(false),
            ..Default::default()
        };
        let laid = plan_pages(&drawing, &opts);
        assert_eq!((laid.columns, laid.rows), (3, 1));
        assert_eq!(laid.pages.len(), 3);
        assert!(
            laid.pages[1]
                .note
                .as_deref()
                .unwrap()
                .contains("part 2 of 3")
        );
        // Fitted it stays on one page
        let fitted = plan_pages(&drawing, &PageOptions::default());
        assert_eq!(fitted.pages.len(), 1);
        // On A0 it fits at 1:10
        let a0 = plan_pages(
            &drawing,
            &PageOptions {
                paper: Paper::A0,
                ..opts
            },
        );
        assert_eq!(a0.pages.len(), 1);
    }

    #[test]
    fn papers_by_name_and_size() {
        assert_eq!(Paper::by_name("A1"), Some(Paper::A1));
        let custom = Paper::by_name("700 x 500").unwrap();
        assert_eq!((custom.width_mm, custom.height_mm), (500.0, 700.0));
        assert_eq!(Paper::by_name("b5"), None);
        assert_eq!(Paper::by_name("10x10"), None);
    }

    #[test]
    fn title_block_shows_scale_bar_north_and_sheet() {
        let drawing = draw_plan(&one_wall(), &PlanOptions::export(None));
        let (pages, _) = plan_pages_svg(
            &drawing,
            &PageOptions {
                scale: Some(50.0),
                title_block: Some(TitleBlock {
                    project: "House".into(),
                    drawing: "Ground floor".into(),
                    author: Some("CW".into()),
                    date: "2026-11-21".into(),
                    north: Some(0.0),
                }),
                ..Default::default()
            },
        );
        let svg = &pages[0];
        for text in [
            "House",
            "Ground floor",
            "Drawn by",
            "CW",
            "Sheet",
            "1 / 1",
            ">N<",
            "1:50",
        ] {
            assert!(svg.contains(text), "{text}");
        }
        // 1:50 in a cell of 30 mm: a bar of 1 m (20 mm)
        assert!(svg.contains(">1 m<"));
    }
}
