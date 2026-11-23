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
    pub const A0: Paper = Paper {
        width_mm: 841.0,
        height_mm: 1189.0,
    };
    pub const A1: Paper = Paper {
        width_mm: 594.0,
        height_mm: 841.0,
    };
    pub const A2: Paper = Paper {
        width_mm: 420.0,
        height_mm: 594.0,
    };
    pub const A3: Paper = Paper {
        width_mm: 297.0,
        height_mm: 420.0,
    };
    pub const A4: Paper = Paper {
        width_mm: 210.0,
        height_mm: 297.0,
    };
    pub const A5: Paper = Paper {
        width_mm: 148.0,
        height_mm: 210.0,
    };
    pub const LETTER: Paper = Paper {
        width_mm: 215.9,
        height_mm: 279.4,
    };
    pub const LEGAL: Paper = Paper {
        width_mm: 215.9,
        height_mm: 355.6,
    };
    pub const TABLOID: Paper = Paper {
        width_mm: 279.4,
        height_mm: 431.8,
    };

    /// Paper by name: "a0" to "a5", "letter", "legal", "tabloid", or a size in mm such as
    /// "500x700" (each side 50 to 5000 mm).
    pub fn by_name(name: &str) -> Option<Paper> {
        let name = name.trim().to_ascii_lowercase();
        Some(match name.as_str() {
            "a0" => Self::A0,
            "a1" => Self::A1,
            "a2" => Self::A2,
            "a3" => Self::A3,
            "a4" => Self::A4,
            "a5" => Self::A5,
            "letter" => Self::LETTER,
            "legal" => Self::LEGAL,
            "tabloid" => Self::TABLOID,
            _ => {
                let (w, h) = name.split_once(['x', '\u{d7}', '*'])?;
                let w: f32 = w.trim().replace(',', ".").parse().ok()?;
                let h: f32 = h.trim().replace(',', ".").parse().ok()?;
                if !(50.0..=5000.0).contains(&w) || !(50.0..=5000.0).contains(&h) {
                    return None;
                }
                Paper {
                    width_mm: w.min(h),
                    height_mm: w.max(h),
                }
            }
        })
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
    /// Title block at the bottom right of plan pages
    pub title_block: Option<TitleBlock>,
}

impl Default for PageOptions {
    fn default() -> Self {
        Self {
            paper: Paper::A4,
            landscape: None,
            margin_mm: 12.0,
            scale: None,
            title: None,
            title_block: None,
        }
    }
}

/// What the title block of a plan page says. The scale and the sheet number come from the
/// page.
#[derive(Debug, Clone, Default)]
pub struct TitleBlock {
    /// Name of the project (the home)
    pub project: String,
    /// What the sheet shows (e.g. the level)
    pub drawing: String,
    /// Who drew the plan
    pub author: Option<String>,
    pub date: String,
    /// North direction of the compass in radians (clockwise in the plan); `None`: no arrow
    pub north: Option<f32>,
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
    /// Scale denominator of a plan page (100 for 1:100)
    pub scale: Option<f32>,
    /// Title block of a plan page
    pub block: Option<TitleBlock>,
}

const MM_TO_PT: f32 = 72.0 / 25.4;
/// Height of the title block and the space between it and the plan, in mm.
const BLOCK_HEIGHT: f32 = 26.0;
const BLOCK_GAP: f32 = 3.0;
/// Widest title block in mm.
const BLOCK_WIDTH: f32 = 150.0;
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

/// The plan on paper pages, with the scale used and how the pages are laid out.
#[derive(Debug, Clone)]
pub struct PlanPages {
    pub pages: Vec<Page>,
    /// Scale denominator (100 for 1:100)
    pub scale: f32,
    /// Columns and rows of pages a plan too large for one page at its scale is split into
    pub columns: usize,
    pub rows: usize,
}

/// The plan on pages: fitted to one page, or at a scale, split into as many pages as it needs
/// (each shows its part of the plan, the whole is centered on them). Without a given
/// orientation a page is portrait or landscape, whichever needs fewer pages or fits better.
pub fn plan_pages(plan: &PlanDrawing, opts: &PageOptions) -> PlanPages {
    let [vx, vy, vw, vh] = plan.view_box;
    let area = |landscape: bool| {
        let mut a = content_area(opts.paper, landscape, opts.margin_mm, opts.title.is_some());
        if opts.title_block.is_some() {
            a[3] = (a[3] - BLOCK_HEIGHT - BLOCK_GAP).max(10.0);
        }
        a
    };
    // Pages across and down for a plan drawn at `factor` mm per cm
    let grid = |landscape: bool, factor: f32| {
        let [_, _, aw, ah] = area(landscape);
        let across = ((vw * factor / aw) - 0.001).ceil().max(1.0) as usize;
        let down = ((vh * factor / ah) - 0.001).ceil().max(1.0) as usize;
        (across, down)
    };
    let given = opts.scale.filter(|n| *n > 0.0);
    let landscape = match (opts.landscape, given) {
        (Some(l), _) => l,
        (None, Some(n)) => {
            let (pc, pr) = grid(false, 10.0 / n);
            let (lc, lr) = grid(true, 10.0 / n);
            if pc * pr == lc * lr {
                vw > vh
            } else {
                lc * lr < pc * pr
            }
        }
        (None, None) => vw > vh,
    };
    let [ax, ay, aw, ah] = area(landscape);
    // Millimeters on paper per centimeter of the plan
    let fit = (aw / vw).min(ah / vh);
    let (factor, denominator) = match given {
        Some(n) => (10.0 / n, n),
        None => (fit, 10.0 / fit),
    };
    let (columns, rows) = if given.is_some() {
        grid(landscape, factor)
    } else {
        (1, 1)
    };
    // The whole plan centered on the pages
    let ox = (columns as f32 * aw - vw * factor) / 2.0;
    let oy = (rows as f32 * ah - vh * factor) / 2.0;
    let count = columns * rows;
    let mut pages = Vec::with_capacity(count);
    for r in 0..rows {
        for c in 0..columns {
            let dx = ax + ox - c as f32 * aw;
            let dy = ay + oy - r as f32 * ah;
            let body = format!(
                r#"<clipPath id="plan-area"><rect x="{ax}" y="{ay}" width="{aw}" height="{ah}"/></clipPath><g clip-path="url(#plan-area)"><g transform="translate({dx} {dy}) scale({factor}) translate({} {})">{}</g></g>"#,
                -vx, -vy, plan.body
            );
            let scale = format!("1:{}", round_scale(denominator));
            let note = if count > 1 {
                format!(
                    "{scale} \u{b7} part {} of {count} (row {}, column {})",
                    r * columns + c + 1,
                    r + 1,
                    c + 1
                )
            } else {
                scale
            };
            pages.push(Page {
                landscape,
                title: opts.title.clone(),
                body,
                note: Some(note),
                scale: Some(denominator),
                block: opts.title_block.clone(),
            });
        }
    }
    PlanPages {
        pages,
        scale: denominator,
        columns,
        rows,
    }
}

/// The pages of a plan as SVG documents (see [`plan_pages`] and [`page_svgs`]).
pub fn plan_pages_svg(plan: &PlanDrawing, opts: &PageOptions) -> (Vec<String>, PlanPages) {
    let laid = plan_pages(plan, opts);
    let svgs = page_svgs(&laid.pages, opts.paper, opts.margin_mm, None);
    (svgs, laid)
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
                scale: None,
                block: None,
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
        scale: None,
        block: None,
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
            let scale_text = page.scale.map(|n| format!("1:{}", round_scale(n)));
            let scale = scale_text.as_deref();
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
            if let Some(block) = &page.block {
                title_block(&mut s, block, pw, ph, m, page.scale, i + 1, count);
            }
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

/// Draws a title block at the bottom right of a page, above the footer: north arrow, scale
/// bar, project, drawing, author, date, scale and sheet number.
#[allow(clippy::too_many_arguments)]
fn title_block(
    s: &mut String,
    block: &TitleBlock,
    pw: f32,
    ph: f32,
    margin: f32,
    scale: Option<f32>,
    sheet: usize,
    sheets: usize,
) {
    let w = (pw - 2.0 * margin).min(BLOCK_WIDTH);
    let h = BLOCK_HEIGHT;
    let x0 = pw - margin - w;
    let y0 = ph - margin - FOOTER_HEIGHT - h + 1.0;
    let line = 0.25;
    let _ = write!(
        s,
        r##"<rect x="{x0}" y="{y0}" width="{w}" height="{h}" fill="#ffffff" stroke="{TEXT}" stroke-width="0.35"/>"##
    );
    // Cells: north arrow, scale bar, texts
    let arrow_w = if block.north.is_some() { 16.0 } else { 0.0 };
    let bar_w = if scale.is_some() { 38.0 } else { 0.0 };
    let text_x = x0 + arrow_w + bar_w;
    for x in [x0 + arrow_w, text_x] {
        if x > x0 + 0.1 {
            let _ = write!(
                s,
                r#"<line x1="{x}" y1="{y0}" x2="{x}" y2="{}" stroke="{TEXT}" stroke-width="{line}"/>"#,
                y0 + h
            );
        }
    }
    if let Some(north) = block.north {
        let (cx, cy, r) = (x0 + arrow_w / 2.0, y0 + h / 2.0 + 2.0, 5.5);
        let _ = write!(
            s,
            r#"<g transform="translate({cx} {cy}) rotate({})"><circle r="{r}" fill="none" stroke="{TEXT}" stroke-width="{line}"/><path d="M0 {}L{} {}L0 {}L{} {}Z" fill="{TEXT}"/><text y="{}" font-size="3" text-anchor="middle" fill="{TEXT}">N</text></g>"#,
            north.to_degrees(),
            -r,
            r * 0.35,
            r * 0.55,
            r * 0.3,
            -r * 0.35,
            r * 0.55,
            -r - 1.2
        );
    }
    if let Some(denominator) = scale {
        // The longest round length that fits the cell, in m
        let room_mm = bar_w - 8.0;
        let mm_per_m = 1000.0 / denominator;
        let length = [
            0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 500.0, 1000.0,
        ]
        .into_iter()
        .rev()
        .find(|m| m * mm_per_m <= room_mm)
        .unwrap_or(0.1);
        let bar = length * mm_per_m;
        let (bx, by) = (x0 + arrow_w + 4.0, y0 + h / 2.0);
        for k in 0..4 {
            let fill = if k % 2 == 0 { TEXT } else { "#ffffff" };
            let _ = write!(
                s,
                r#"<rect x="{}" y="{by}" width="{}" height="1.6" fill="{fill}" stroke="{TEXT}" stroke-width="0.15"/>"#,
                bx + bar * k as f32 / 4.0,
                bar / 4.0
            );
        }
        let label = if length < 1.0 {
            format!("{} cm", (length * 100.0).round())
        } else {
            format!("{length} m")
        };
        let _ = write!(
            s,
            r#"<text x="{bx}" y="{}" font-size="2.4" text-anchor="middle" fill="{TEXT}">0</text><text x="{}" y="{}" font-size="2.4" text-anchor="middle" fill="{TEXT}">{label}</text><text x="{}" y="{}" font-size="3.2" font-weight="600" text-anchor="middle" fill="{TEXT}">1:{}</text>"#,
            by - 1.2,
            bx + bar,
            by - 1.2,
            x0 + arrow_w + bar_w / 2.0,
            y0 + h - 4.0,
            round_scale(denominator)
        );
    }
    // Texts: project, drawing, then author, date and sheet in small cells
    let tw = x0 + w - text_x;
    let row1 = y0 + 9.0;
    let row2 = y0 + 16.5;
    let _ = write!(
        s,
        r#"<line x1="{text_x}" y1="{}" x2="{}" y2="{}" stroke="{TEXT}" stroke-width="{line}"/>"#,
        y0 + 19.0,
        x0 + w,
        y0 + 19.0
    );
    let fit = |text: &str, width: f32, font: f32| {
        let max = ((width - 3.0) / (font * 0.55)).max(1.0) as usize;
        if text.chars().count() > max {
            let cut: String = text.chars().take(max.saturating_sub(1)).collect();
            format!("{cut}\u{2026}")
        } else {
            text.to_string()
        }
    };
    let _ = write!(
        s,
        r#"<text x="{}" y="{row1}" font-size="4.6" font-weight="600" fill="{TEXT}">{}</text><text x="{}" y="{row2}" font-size="3.4" fill="{TEXT}">{}</text>"#,
        text_x + 2.0,
        escape(&fit(&block.project, tw, 4.6)),
        text_x + 2.0,
        escape(&fit(&block.drawing, tw, 3.4)),
    );
    let cells = [
        ("Drawn by", block.author.clone().unwrap_or_default()),
        ("Date", block.date.clone()),
        ("Sheet", format!("{sheet} / {sheets}")),
    ];
    let cell_w = tw / cells.len() as f32;
    for (k, (label, value)) in cells.iter().enumerate() {
        let cx = text_x + cell_w * k as f32;
        if k > 0 {
            let _ = write!(
                s,
                r#"<line x1="{cx}" y1="{}" x2="{cx}" y2="{}" stroke="{TEXT}" stroke-width="{line}"/>"#,
                y0 + 19.0,
                y0 + h
            );
        }
        let _ = write!(
            s,
            r#"<text x="{}" y="{}" font-size="1.8" fill="{MUTED}">{label}</text><text x="{}" y="{}" font-size="2.6" fill="{TEXT}">{}</text>"#,
            cx + 1.5,
            y0 + 21.3,
            cx + 1.5,
            y0 + 24.6,
            escape(&fit(value, cell_w, 2.6))
        );
    }
}

/// Scale denominator for display: a given whole number as it is (1:75), a fitted scale as a
/// whole number, larger ones rounded to tens.
fn round_scale(n: f32) -> String {
    if (n - n.round()).abs() < 0.01 {
        format!("{}", n.round())
    } else if n >= 20.0 {
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
