//! Paper pages and PDF documents: plans placed on a page at a scale, the
//! furniture list as a table, an image of the 3D view, and PDF documents made
//! of SVG pages. Page contents are drawn in millimeters.

use crate::csv;
use crate::plan::{PlanDrawing, collect_pieces, escape};
use msh_model::Home;
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

    /// Width and height of the page in mm.
    fn size(&self, landscape: bool) -> (f32, f32) {
        if landscape {
            (self.height_mm, self.width_mm)
        } else {
            (self.width_mm, self.height_mm)
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

/// One page before its frame (title, footer) is added.
#[derive(Debug, Clone)]
pub struct Page {
    pub landscape: bool,
    pub title: Option<String>,
    /// Drawing in page millimeters, inside the content area
    pub body: String,
    /// Text at the right of the footer (e.g. "1:100")
    pub note: Option<String>,
}

const MM_TO_PT: f32 = 72.0 / 25.4;
const TITLE_HEIGHT: f32 = 10.0;
const FOOTER_HEIGHT: f32 = 6.0;
const TEXT: &str = "#1c2026";
const MUTED: &str = "#6b7380";
const RULE: &str = "#c9ced6";

/// Content area of a page (x, y, width, height in mm) inside margin, title and footer.
fn content_area(paper: Paper, landscape: bool, margin: f32, title: bool) -> [f32; 4] {
    let (pw, ph) = paper.size(landscape);
    let title_h = if title { TITLE_HEIGHT } else { 0.0 };
    [
        margin,
        margin + title_h,
        pw - 2.0 * margin,
        ph - 2.0 * margin - title_h - FOOTER_HEIGHT,
    ]
}

/// The plan on one page. Returns the page and the scale denominator used.
pub fn plan_page(plan: &PlanDrawing, opts: &PageOptions) -> (Page, f32) {
    let [vx, vy, vw, vh] = plan.view_box;
    let landscape = opts.landscape.unwrap_or(vw > vh);
    let [ax, ay, aw, ah] =
        content_area(opts.paper, landscape, opts.margin_mm, opts.title.is_some());
    // Millimeters on paper per centimeter of the plan
    let fit = (aw / vw).min(ah / vh);
    let (factor, denominator) = match opts.scale {
        Some(n) if n > 0.0 => (10.0 / n, n),
        _ => (fit, 10.0 / fit),
    };
    // Centered in the content area; a plan too large for the scale is clipped
    let (dx, dy) = (ax + (aw - vw * factor) / 2.0, ay + (ah - vh * factor) / 2.0);
    let body = format!(
        r#"<clipPath id="plan-area"><rect x="{ax}" y="{ay}" width="{aw}" height="{ah}"/></clipPath><g clip-path="url(#plan-area)"><g transform="translate({dx} {dy}) scale({factor}) translate({} {})">{}</g></g>"#,
        -vx, -vy, plan.body
    );
    (
        Page {
            landscape,
            title: opts.title.clone(),
            body,
            note: Some(format!("1:{}", round_scale(denominator))),
        },
        denominator,
    )
}

/// A page with the plan as SVG (see [`plan_page`] and [`page_svgs`]).
pub fn plan_page_svg(plan: &PlanDrawing, opts: &PageOptions) -> (String, f32) {
    let (page, scale) = plan_page(plan, opts);
    let svg = page_svgs(&[page], opts.paper, opts.margin_mm, None)
        .pop()
        .unwrap_or_default();
    (svg, scale)
}

/// The furniture list as table pages (all levels, pieces of groups one by one).
/// `landscape: None` turns the pages when there are many columns.
pub fn furniture_pages(
    home: &Home,
    columns: &[String],
    paper: Paper,
    landscape: Option<bool>,
    margin: f32,
    title: &str,
) -> Vec<Page> {
    let mut pieces = Vec::new();
    collect_pieces(&home.furniture, &mut pieces);
    let weights: Vec<f32> = columns.iter().map(|c| column_weight(c)).collect();
    let landscape = landscape.unwrap_or(weights.iter().sum::<f32>() > 9.0);
    let [ax, ay, aw, ah] = content_area(paper, landscape, margin, true);
    let total: f32 = weights.iter().sum();
    let widths: Vec<f32> = weights.iter().map(|w| w / total * aw).collect();
    let font = 2.8;
    let row_h = 5.0;
    let rows_per_page = (((ah - row_h * 2.0) / row_h).floor() as usize).max(1);

    let rows: Vec<Vec<String>> = pieces
        .iter()
        .map(|p| {
            columns
                .iter()
                .map(|c| match csv::cell(home, p, c).as_str() {
                    "true" => "\u{2713}".to_string(),
                    "false" => String::new(),
                    v => v.to_string(),
                })
                .collect()
        })
        .collect();
    // Sum of the price columns on the last page (only for columns with prices)
    let sums: Vec<Option<f64>> = columns
        .iter()
        .enumerate()
        .map(|(i, c)| {
            if !matches!(
                c.as_str(),
                "PRICE" | "VALUE_ADDED_TAX" | "PRICE_VALUE_ADDED_TAX_INCLUDED"
            ) {
                return None;
            }
            let values: Vec<f64> = rows.iter().filter_map(|r| r[i].parse().ok()).collect();
            (!values.is_empty()).then(|| values.iter().sum())
        })
        .collect();
    let has_sums = sums.iter().any(Option::is_some);

    let chunks: Vec<&[Vec<String>]> = if rows.is_empty() {
        vec![&[]]
    } else {
        rows.chunks(rows_per_page).collect()
    };
    let count = chunks.len();
    chunks
        .into_iter()
        .enumerate()
        .map(|(page_index, chunk)| {
            let mut s = String::new();
            let mut y = ay;
            // Header row
            let _ = write!(
                s,
                r##"<rect x="{ax}" y="{y}" width="{aw}" height="{row_h}" fill="#eef0f3"/>"##
            );
            row(&mut s, ax, y, row_h, font, &widths, columns, |c| {
                csv::header(c).to_string()
            }, true);
            y += row_h;
            for r in chunk {
                row(&mut s, ax, y, row_h, font, &widths, columns, |c| {
                    let i = columns.iter().position(|x| x == c).unwrap_or(0);
                    r[i].clone()
                }, false);
                let _ = write!(
                    s,
                    r#"<line x1="{ax}" y1="{}" x2="{}" y2="{}" stroke="{RULE}" stroke-width="0.15"/>"#,
                    y + row_h,
                    ax + aw,
                    y + row_h
                );
                y += row_h;
            }
            if has_sums && page_index == count - 1 {
                let _ = write!(
                    s,
                    r#"<line x1="{ax}" y1="{y}" x2="{}" y2="{y}" stroke="{TEXT}" stroke-width="0.3"/>"#,
                    ax + aw
                );
                row(&mut s, ax, y, row_h, font, &widths, columns, |c| {
                    let i = columns.iter().position(|x| x == c).unwrap_or(0);
                    match sums[i] {
                        Some(v) => format!("{v:.2}"),
                        None if i == 0 => "Total".to_string(),
                        None => String::new(),
                    }
                }, true);
            }
            Page {
                landscape,
                title: Some(title.to_string()),
                body: s,
                note: Some(format!("{} pieces", rows.len())),
            }
        })
        .collect()
}

/// One table row: text clipped to its cell, numbers right-aligned.
#[allow(clippy::too_many_arguments)]
fn row(
    s: &mut String,
    x0: f32,
    y: f32,
    h: f32,
    font: f32,
    widths: &[f32],
    columns: &[String],
    value: impl Fn(&str) -> String,
    bold: bool,
) {
    let mut x = x0;
    let weight = if bold { r#" font-weight="600""# } else { "" };
    for (c, w) in columns.iter().zip(widths) {
        let text = value(c);
        if !text.is_empty() {
            let numeric = is_numeric_column(c);
            // Rough text width: cut long texts so they stay inside the cell
            let max_chars = ((w - 2.0) / (font * 0.52)).max(1.0) as usize;
            let text = if text.chars().count() > max_chars {
                let cut: String = text.chars().take(max_chars.saturating_sub(1)).collect();
                format!("{cut}\u{2026}")
            } else {
                text
            };
            let (tx, anchor) = if numeric {
                (x + w - 1.0, "end")
            } else {
                (x + 1.0, "start")
            };
            let _ = write!(
                s,
                r#"<text x="{tx}" y="{}" font-size="{font}" text-anchor="{anchor}" fill="{TEXT}"{weight}>{}</text>"#,
                y + h * 0.68,
                escape(&text)
            );
        }
        x += w;
    }
}

fn is_numeric_column(c: &str) -> bool {
    matches!(
        c,
        "WIDTH"
            | "DEPTH"
            | "HEIGHT"
            | "X"
            | "Y"
            | "ELEVATION"
            | "ANGLE"
            | "MODEL_SIZE"
            | "PRICE"
            | "VALUE_ADDED_TAX_PERCENTAGE"
            | "VALUE_ADDED_TAX"
            | "PRICE_VALUE_ADDED_TAX_INCLUDED"
    )
}

/// Relative column width.
fn column_weight(c: &str) -> f32 {
    match c {
        "NAME" | "DESCRIPTION" => 4.0,
        "CATALOG_ID" | "CREATOR" | "LICENSE" | "TEXTURE" | "LEVEL" => 2.5,
        "PRICE_VALUE_ADDED_TAX_INCLUDED" | "MODEL_SIZE" => 1.6,
        "VISIBLE" | "MOVABLE" | "DOOR_OR_WINDOW" | "COLOR" => 1.2,
        _ => 1.3,
    }
}

/// A page with an image (e.g. the 3D view), fitted and centered.
pub fn image_page(
    png: &[u8],
    paper: Paper,
    landscape: Option<bool>,
    margin: f32,
    title: &str,
) -> Option<Page> {
    use base64::Engine;
    let (iw, ih) = png_size(png)?;
    let landscape = landscape.unwrap_or(iw >= ih);
    let [ax, ay, aw, ah] = content_area(paper, landscape, margin, true);
    let scale = (aw / iw as f32).min(ah / ih as f32);
    let (w, h) = (iw as f32 * scale, ih as f32 * scale);
    let (x, y) = (ax + (aw - w) / 2.0, ay + (ah - h) / 2.0);
    let body = format!(
        r#"<image x="{x}" y="{y}" width="{w}" height="{h}" preserveAspectRatio="none" xlink:href="data:image/png;base64,{}"/><rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="{RULE}" stroke-width="0.2"/>"#,
        base64::engine::general_purpose::STANDARD.encode(png)
    );
    Some(Page {
        landscape,
        title: Some(title.to_string()),
        body,
        note: None,
    })
}

/// Width and height of a PNG image from its header.
fn png_size(png: &[u8]) -> Option<(u32, u32)> {
    if png.len() < 24 || !png.starts_with(&[0x89, b'P', b'N', b'G']) {
        return None;
    }
    let w = u32::from_be_bytes(png[16..20].try_into().ok()?);
    let h = u32::from_be_bytes(png[20..24].try_into().ok()?);
    (w > 0 && h > 0).then_some((w, h))
}

/// Header and footer of printed pages, like Sweet Home 3D's page setup: format strings with
/// the variables `$pageNumber`, `$pageCount`, `$planScale`, `$name` (home name), `$file`
/// (file name), `$date`, `$time` and `$$` for a dollar sign.
#[derive(Debug, Clone, Default)]
pub struct PageFrame {
    /// Header, written at the top right of each page
    pub header: Option<String>,
    /// Footer, written at the bottom left instead of the default text
    pub footer: Option<String>,
    pub name: String,
    pub file: String,
    pub date: String,
    pub time: String,
}

/// A header or footer format with its variables replaced.
pub fn expand_page_format(
    format: &str,
    frame: &PageFrame,
    page: usize,
    count: usize,
    scale: Option<&str>,
) -> String {
    let mut out = String::with_capacity(format.len());
    let mut rest = format;
    const VARS: &[&str] = &[
        "$$",
        "$pageNumber",
        "$pageCount",
        "$planScale",
        "$name",
        "$file",
        "$date",
        "$time",
    ];
    while let Some(i) = rest.find('$') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        match VARS.iter().find(|v| tail.starts_with(**v)) {
            Some(v) => {
                match *v {
                    "$$" => out.push('$'),
                    "$pageNumber" => out.push_str(&page.to_string()),
                    "$pageCount" => out.push_str(&count.to_string()),
                    "$planScale" => out.push_str(scale.unwrap_or("")),
                    "$name" => out.push_str(&frame.name),
                    "$file" => out.push_str(&frame.file),
                    "$date" => out.push_str(&frame.date),
                    _ => out.push_str(&frame.time),
                }
                rest = &tail[v.len()..];
            }
            None => {
                out.push('$');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// SVG documents of the pages with title, footer text and page numbers ("Page 2 of 5"
/// when there is more than one page). Width and height in points, drawing in mm.
pub fn page_svgs(pages: &[Page], paper: Paper, margin: f32, footer: Option<&str>) -> Vec<String> {
    page_svgs_framed(pages, paper, margin, footer, &PageFrame::default())
}

/// Like [`page_svgs`], with a header and a footer of the page setup (`frame`); a footer
/// format replaces the default footer text.
pub fn page_svgs_framed(
    pages: &[Page],
    paper: Paper,
    margin: f32,
    footer: Option<&str>,
    frame: &PageFrame,
) -> Vec<String> {
    let count = pages.len();
    pages
        .iter()
        .enumerate()
        .map(|(i, page)| {
            let (pw, ph) = paper.size(page.landscape);
            let m = margin;
            let mut s = String::with_capacity(page.body.len() + 2048);
            let _ = write!(
                s,
                r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{}" height="{}" viewBox="0 0 {pw} {ph}" font-family="Segoe UI, Arial, sans-serif"><rect width="{pw}" height="{ph}" fill="#ffffff"/>"##,
                pw * MM_TO_PT,
                ph * MM_TO_PT
            );
            if let Some(t) = &page.title {
                let _ = write!(
                    s,
                    r#"<text x="{m}" y="{}" font-size="5" font-weight="600" fill="{TEXT}">{}</text>"#,
                    m + 5.0,
                    escape(t)
                );
            }
            // The note of a plan page is its scale ("1:100")
            let scale = page.note.as_deref().filter(|n| n.starts_with("1:"));
            if let Some(h) = frame.header.as_deref().filter(|h| !h.is_empty()) {
                let text = expand_page_format(h, frame, i + 1, count, scale);
                let _ = write!(
                    s,
                    r#"<text x="{}" y="{}" font-size="3" text-anchor="end" fill="{MUTED}">{}</text>"#,
                    pw - m,
                    m + 5.0,
                    escape(&text)
                );
            }
            s.push_str(&page.body);
            let fy = ph - m;
            let left = match frame.footer.as_deref().filter(|f| !f.is_empty()) {
                Some(f) => expand_page_format(f, frame, i + 1, count, scale),
                None => {
                    let mut left = footer.map(str::to_string).unwrap_or_default();
                    if count > 1 {
                        if !left.is_empty() {
                            left.push_str(" \u{b7} ");
                        }
                        let _ = write!(left, "Page {} of {count}", i + 1);
                    }
                    left
                }
            };
            if !left.is_empty() {
                let _ = write!(
                    s,
                    r#"<text x="{m}" y="{fy}" font-size="3" fill="{MUTED}">{}</text>"#,
                    escape(&left)
                );
            }
            if let Some(note) = &page.note {
                let _ = write!(
                    s,
                    r#"<text x="{}" y="{fy}" font-size="3" text-anchor="end" fill="{MUTED}">{}</text>"#,
                    pw - m,
                    escape(note)
                );
            }
            s.push_str("</svg>");
            s
        })
        .collect()
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
