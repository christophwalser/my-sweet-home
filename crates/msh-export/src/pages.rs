//! Paper pages: plans placed on a page at a scale, and PDF documents made of
//! SVG pages.

use crate::plan::{PlanDrawing, escape};
use std::fmt::Write;

/// Paper size in millimeters (portrait).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Paper {
    pub width_mm: f32,
    pub height_mm: f32,
}

impl Paper {
    pub const A4: Paper = Paper {
        width_mm: 210.0,
        height_mm: 297.0,
    };
    pub const A3: Paper = Paper {
        width_mm: 297.0,
        height_mm: 420.0,
    };
    pub const LETTER: Paper = Paper {
        width_mm: 215.9,
        height_mm: 279.4,
    };

    /// Paper by name: "a4", "a3" or "letter".
    pub fn by_name(name: &str) -> Option<Paper> {
        match name.to_ascii_lowercase().as_str() {
            "a4" => Some(Self::A4),
            "a3" => Some(Self::A3),
            "letter" => Some(Self::LETTER),
            _ => None,
        }
    }
}

/// Options of a plan page.
#[derive(Debug, Clone)]
pub struct PageOptions {
    pub paper: Paper,
    /// `None`: portrait or landscape, whichever fits the plan better
    pub landscape: Option<bool>,
    /// Page margin in mm
    pub margin_mm: f32,
    /// Scale denominator (100 for 1:100); `None` fits the plan to the page
    pub scale: Option<f32>,
    /// Heading at the top of the page (e.g. home and level name)
    pub title: Option<String>,
}

impl Default for PageOptions {
    fn default() -> Self {
        Self {
            paper: Paper::A4,
            landscape: None,
            margin_mm: 12.0,
            scale: None,
            title: None,
        }
    }
}

const MM_TO_PT: f32 = 72.0 / 25.4;

/// A page with the plan as SVG: width and height in points, drawing units in mm.
/// Returns the page and the scale denominator used.
pub fn plan_page_svg(plan: &PlanDrawing, opts: &PageOptions) -> (String, f32) {
    let [vx, vy, vw, vh] = plan.view_box;
    let landscape = opts.landscape.unwrap_or(vw > vh);
    let (pw, ph) = if landscape {
        (opts.paper.height_mm, opts.paper.width_mm)
    } else {
        (opts.paper.width_mm, opts.paper.height_mm)
    };
    let m = opts.margin_mm;
    let title_h = if opts.title.is_some() { 10.0 } else { 0.0 };
    let footer_h = 6.0;
    let (ax, ay) = (m, m + title_h);
    let (aw, ah) = (pw - 2.0 * m, ph - 2.0 * m - title_h - footer_h);
    // Millimeters on paper per centimeter of the plan
    let fit = (aw / vw).min(ah / vh);
    let (factor, denominator) = match opts.scale {
        Some(n) if n > 0.0 => (10.0 / n, n),
        _ => (fit, 10.0 / fit),
    };
    // Centered in the drawing area; a plan too large for the scale is clipped
    let (dw, dh) = (vw * factor, vh * factor);
    let (dx, dy) = (ax + (aw - dw) / 2.0, ay + (ah - dh) / 2.0);

    let mut s = String::with_capacity(plan.body.len() + 2048);
    let _ = write!(
        s,
        r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{}" height="{}" viewBox="0 0 {pw} {ph}" font-family="Segoe UI, Arial, sans-serif"><rect width="{pw}" height="{ph}" fill="#ffffff"/>"##,
        pw * MM_TO_PT,
        ph * MM_TO_PT
    );
    if let Some(t) = &opts.title {
        let _ = write!(
            s,
            r##"<text x="{m}" y="{}" font-size="5" font-weight="600" fill="#1c2026">{}</text>"##,
            m + 5.0,
            escape(t)
        );
    }
    let _ = write!(
        s,
        r#"<clipPath id="page-area"><rect x="{ax}" y="{ay}" width="{aw}" height="{ah}"/></clipPath><g clip-path="url(#page-area)"><g transform="translate({dx} {dy}) scale({factor}) translate({} {})">{}</g></g>"#,
        -vx, -vy, plan.body
    );
    let _ = write!(
        s,
        r##"<text x="{}" y="{}" font-size="3" text-anchor="end" fill="#6b7380">1:{}</text></svg>"##,
        pw - m,
        ph - m,
        round_scale(denominator)
    );
    (s, denominator)
}

/// Scale denominator for display: whole numbers, larger ones rounded to tens.
fn round_scale(n: f32) -> String {
    if n >= 20.0 {
        format!("{}", (n / 10.0).round() * 10.0)
    } else {
        format!("{}", n.round())
    }
}

/// PDF document with one page per SVG (page size from the SVG's width and height in points).
pub fn pdf_from_svg_pages(pages: &[String]) -> Result<Vec<u8>, String> {
    use krilla::Document;
    use krilla::geom::Size;
    use krilla::page::PageSettings;
    use krilla_svg::{SurfaceExt, SvgSettings};
    use resvg::usvg;

    let mut opt = usvg::Options::default();
    opt.fontdb_mut().load_system_fonts();
    let mut document = Document::new();
    for svg in pages {
        let tree = usvg::Tree::from_str(svg, &opt).map_err(|e| e.to_string())?;
        let size = tree.size();
        let (w, h) = (size.width(), size.height());
        let settings = PageSettings::from_wh(w, h).ok_or("invalid page size")?;
        let mut page = document.start_page_with(settings);
        let mut surface = page.surface();
        surface
            .draw_svg(
                &tree,
                Size::from_wh(w, h).ok_or("invalid page size")?,
                SvgSettings::default(),
            )
            .ok_or("the page could not be converted to PDF")?;
        surface.finish();
        page.finish();
    }
    document.finish().map_err(|e| format!("{e:?}"))
}
