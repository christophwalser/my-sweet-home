//! File exports: plan as SVG, PNG, PDF or DXF, furniture list as CSV.

use crate::Document;
use crate::registry::{CommandError, Registry};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
enum PlanFormat {
    Svg,
    Png,
    Pdf,
    /// Drawing for CAD programs (AutoCAD R12), a layer for each kind of element
    Dxf,
}

/// How furniture is drawn in exported and printed plans.
#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
enum FurnitureIcons {
    /// Seen from above, rendered from the 3D models (needs `top_views`, which the running app
    /// supplies; otherwise the catalog icons are used)
    #[default]
    TopView,
    /// The catalog icons
    Catalog,
}

/// Views of the furniture from above, rendered by the app: PNG images (base64) by key and
/// the key of each piece (pieces that look the same share one image).
#[derive(Deserialize, JsonSchema, Default)]
struct TopViews {
    images: HashMap<String, String>,
    pieces: HashMap<String, String>,
}

/// The title block of plan pages.
#[derive(Deserialize, JsonSchema, Default)]
struct TitleBlockParams {
    /// Name of the project (default: the name of the home)
    project: Option<String>,
    /// Who drew the plan
    author: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct PlanParams {
    /// File to write (.svg, .png, .pdf or .dxf); a PDF without a path returns its pages as
    /// SVG documents (a preview)
    path: Option<PathBuf>,
    /// "svg", "png", "pdf" or "dxf" (default: from the file extension)
    format: Option<PlanFormat>,
    /// DXF: unit of the drawing "mm" (default), "cm" or "m"
    unit: Option<String>,
    /// Level ID (default: selected level); "all" exports every level (PDF: one page per
    /// level, SVG/PNG/DXF: one file per level with the level name appended)
    level: Option<String>,
    /// PDF: paper size "a0" to "a5", "letter", "legal", "tabloid" or a size in mm such as
    /// "500x700" (default "a4")
    paper: Option<String>,
    /// PDF: landscape page (default: whichever needs fewer pages or fits the plan better)
    landscape: Option<bool>,
    /// PDF: scale denominator, any number such as 100 for 1:100 or 75 for 1:75 (default: fit
    /// to the page). A plan too large for one page at this scale is split into several pages
    scale: Option<f32>,
    /// PDF: a title block at the bottom right of each page (project, level, author, date,
    /// scale, scale bar, north arrow, sheet number)
    title_block: Option<TitleBlockParams>,
    /// PNG: width in pixels (default 2000)
    width: Option<u32>,
    /// Furniture "top_view" (default: seen from above) or "catalog" (icons)
    furniture_icons: Option<FurnitureIcons>,
    /// Views from above rendered by the app (supplied by the app in live mode)
    top_views: Option<TopViews>,
}

#[derive(Deserialize, JsonSchema)]
struct DocumentParams {
    /// PDF file to write; without a path the pages are returned as SVG documents (for
    /// printing)
    path: Option<PathBuf>,
    /// Include the furniture list (default true)
    furniture: Option<bool>,
    /// Include the plan (default true)
    plan: Option<bool>,
    /// Include the 3D view (default true; needs `view_3d_image`, which the running app
    /// supplies in live mode)
    view_3d: Option<bool>,
    /// Plan level ID or "all" (default: all levels, one page each)
    level: Option<String>,
    /// Paper size "a0" to "a5", "letter", "legal", "tabloid" or a size in mm such as
    /// "500x700" (default "a4")
    paper: Option<String>,
    /// Landscape pages (default: per page, whichever fits better)
    landscape: Option<bool>,
    /// Plan scale denominator, any number such as 100 for 1:100 (default: fit to the page).
    /// A plan too large for one page at this scale is split into several pages
    scale: Option<f32>,
    /// A title block at the bottom right of each plan page
    title_block: Option<TitleBlockParams>,
    /// Columns of the furniture list (default: the home's furniture table columns)
    columns: Option<Vec<String>>,
    /// Image of the 3D view as PNG (base64 or data URL)
    view_3d_image: Option<String>,
    /// Furniture in the plans "top_view" (default: seen from above) or "catalog" (icons)
    furniture_icons: Option<FurnitureIcons>,
    /// Views from above rendered by the app (supplied by the app in live mode)
    top_views: Option<TopViews>,
    /// Header of each page, like Sweet Home 3D's page setup (default: the home's print
    /// settings). Variables: $pageNumber, $pageCount, $planScale, $name, $file, $date, $time,
    /// $$ for a dollar sign
    header: Option<String>,
    /// Footer of each page (default: the home's print settings, else name and page number)
    footer: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct CsvParams {
    /// File to write (.csv)
    path: PathBuf,
    /// Columns (Sweet Home 3D property names such as NAME, WIDTH, PRICE); default: the
    /// home's furniture table columns
    columns: Option<Vec<String>>,
    /// Field separator (default ",")
    separator: Option<char>,
}

pub(super) fn register(r: &mut Registry) {
    r.add(
        "export_plan",
        "Exports the 2D plan as shown in the app (walls with patterns, rooms, furniture seen from          above or as icons, doors and windows, dimensions, labels, compass) as SVG, PNG or PDF          file, or as DXF drawing for CAD programs (a layer for each kind of element, in mm, cm          or m). PDF pages (A0 to A5, Letter or any size) can use any scale such as 1:100, split          a plan too large for one page into several pages and carry a title block; without a          path the PDF pages are returned as SVG documents for a preview.",
        false,
        |doc, p: PlanParams| export_plan(doc, p),
    );
    r.add(
        "export_document",
        "Prints the home to a PDF document like Sweet Home 3D: furniture list, plan of each level \
         (fitted or at a scale such as 1:100) and the 3D view, with titles and page numbers.",
        false,
        |doc, p: DocumentParams| export_document(doc, p),
    );
    r.add(
        "export_furniture_csv",
        "Exports the furniture list (all levels, pieces inside groups included) as CSV file.",
        false,
        |doc, p: CsvParams| {
            let home = doc.home();
            let columns = msh_export::resolve_columns(home, p.columns.as_deref())
                .map_err(CommandError::failed)?;
            let csv = msh_export::furniture_csv(home, &columns, p.separator.unwrap_or(','));
            // BOM so that spreadsheet programs detect UTF-8
            write(
                &p.path,
                &[b"\xEF\xBB\xBF".as_slice(), csv.as_bytes()].concat(),
            )?;
            Ok(json!({ "path": p.path, "columns": columns, "rows": csv.lines().count() - 1 }))
        },
    );
}

fn export_plan(doc: &Document, p: PlanParams) -> Result<serde_json::Value, CommandError> {
    let home = doc.home();
    let format = match p.format {
        Some(f) => f,
        None if p.path.is_none() => PlanFormat::Pdf,
        None => match p.path.as_deref().and_then(extension).as_deref() {
            Some("svg") => PlanFormat::Svg,
            Some("png") => PlanFormat::Png,
            Some("pdf") => PlanFormat::Pdf,
            Some("dxf") => PlanFormat::Dxf,
            _ => {
                return Err(CommandError::failed(
                    "give a format or a file name ending in .svg, .png, .pdf or .dxf",
                ));
            }
        },
    };

    let selected = select_levels(home, p.level.as_deref())?;
    if format == PlanFormat::Dxf {
        let unit = match p.unit.as_deref() {
            None => msh_export::DxfUnit::default(),
            Some(name) => msh_export::DxfUnit::by_name(name).ok_or_else(|| {
                CommandError::failed(format!("unknown unit '{name}' (mm, cm or m)"))
            })?,
        };
        let Some(target) = &p.path else {
            return Err(CommandError::failed("give the path of the file to write"));
        };
        let mut paths = Vec::new();
        for level in &selected {
            let path = match level {
                Some(l) if selected.len() > 1 => with_suffix(target, &l.attrs.name),
                _ => target.clone(),
            };
            let dxf = msh_export::plan_dxf(home, level.map(|l| l.attrs.id.as_str()), unit);
            write(&path, dxf.as_bytes())?;
            paths.push(path);
        }
        return Ok(json!({ "paths": paths, "layers": msh_export::DXF_LAYERS.map(|l| l.0) }));
    }
    let home_name = home_title(doc);
    let mut notes = Vec::new();
    let top_views = top_views(p.furniture_icons, p.top_views, &mut notes)?;
    let drawings = plan_drawings(doc, &selected, &top_views);

    match format {
        PlanFormat::Pdf => {
            let paper = paper(p.paper.as_deref())?;
            let mut scales = Vec::new();
            let mut pages: Vec<String> = Vec::new();
            let mut landscape = Vec::new();
            for (level, drawing) in &drawings {
                let title = match level {
                    Some(l) => format!("{home_name} - {}", l.attrs.name),
                    None => home_name.clone(),
                };
                let opts = msh_export::PageOptions {
                    paper,
                    landscape: p.landscape,
                    scale: p.scale,
                    title: Some(title),
                    title_block: title_block(doc, p.title_block.as_ref(), *level),
                    ..Default::default()
                };
                let (svgs, laid) = msh_export::plan_pages_svg(drawing, &opts);
                if laid.pages.len() > 1 {
                    notes.push(split_note(*level, &laid, p.paper.as_deref()));
                }
                scales.push(laid.scale.round());
                landscape.extend(laid.pages.iter().map(|page| page.landscape));
                pages.extend(svgs);
            }
            // Sheet numbers of the title blocks count all pages
            let pages = renumber_sheets(pages);
            match &p.path {
                Some(path) => {
                    let pdf =
                        msh_export::pdf_from_svg_pages(&pages).map_err(CommandError::failed)?;
                    write(path, &pdf)?;
                    Ok(
                        json!({ "path": path, "pages": pages.len(), "scales": scales, "notes": notes }),
                    )
                }
                None => Ok(json!({
                    "pages": pages,
                    "landscape": landscape,
                    "paper_mm": [paper.width_mm, paper.height_mm],
                    "scales": scales,
                    "notes": notes,
                })),
            }
        }
        PlanFormat::Dxf => unreachable!("written above"),
        PlanFormat::Svg | PlanFormat::Png => {
            let Some(target) = &p.path else {
                return Err(CommandError::failed("give the path of the file to write"));
            };
            let several = drawings.len() > 1;
            let mut paths = Vec::new();
            for (level, drawing) in &drawings {
                let path = match level {
                    Some(l) if several => with_suffix(target, &l.attrs.name),
                    _ => target.clone(),
                };
                let [x, y, w, h] = drawing.view_box;
                let svg = format!(
                    r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="{x} {y} {w} {h}" width="{w}" height="{h}" font-family="Segoe UI, Arial, sans-serif">{}</svg>"#,
                    drawing.body
                );
                if format == PlanFormat::Svg {
                    write(&path, svg.as_bytes())?;
                } else {
                    let width = p.width.unwrap_or(2000).clamp(100, 10000);
                    let png = msh_export::svg_to_png(&svg, width).map_err(CommandError::failed)?;
                    write(&path, &png)?;
                }
                paths.push(path);
            }
            Ok(json!({ "paths": paths, "notes": notes }))
        }
    }
}

/// Levels to draw, lowest first: one by ID, "all", or the selected one (`None` entries for
/// homes without levels).
fn select_levels<'a>(
    home: &'a msh_model::Home,
    level: Option<&str>,
) -> Result<Vec<Option<&'a msh_model::Level>>, CommandError> {
    let mut levels: Vec<&msh_model::Level> = home.levels.iter().collect();
    levels.sort_by(|a, b| {
        a.attrs
            .elevation
            .total_cmp(&b.attrs.elevation)
            .then(a.attrs.elevation_index.cmp(&b.attrs.elevation_index))
    });
    Ok(match level {
        _ if levels.is_empty() => vec![None],
        Some("all") => levels.iter().map(|l| Some(*l)).collect(),
        Some(id) => {
            vec![Some(*levels.iter().find(|l| l.attrs.id == id).ok_or_else(
                || CommandError::failed(format!("unknown level '{id}'")),
            )?)]
        }
        None => {
            let id = home.attrs.selected_level.as_deref();
            vec![Some(
                levels
                    .iter()
                    .find(|l| Some(l.attrs.id.as_str()) == id)
                    .copied()
                    .unwrap_or(levels[0]),
            )]
        }
    })
}

/// Name of the home for page titles: its name or file name, without ".sh3d".
fn home_title(doc: &Document) -> String {
    let name = doc
        .home()
        .attrs
        .name
        .clone()
        .or_else(|| {
            doc.path
                .as_ref()
                .and_then(|p| p.file_stem())
                .map(|s| s.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "Home".into());
    // Homes named after their file often keep the extension in the name
    match name.to_ascii_lowercase().strip_suffix(".sh3d") {
        Some(stem) => name[..stem.len()].to_string(),
        None => name,
    }
}

/// Decoded views from above: images by name and the image name of each piece.
#[derive(Default)]
struct DecodedTopViews {
    images: HashMap<String, Vec<u8>>,
    pieces: HashMap<String, String>,
}

/// The views from above to draw: decoded from the app's images, or none for catalog icons
/// (with a note when top views were wanted but not supplied).
fn top_views(
    icons: Option<FurnitureIcons>,
    given: Option<TopViews>,
    notes: &mut Vec<String>,
) -> Result<DecodedTopViews, CommandError> {
    use base64::Engine;
    if icons.unwrap_or_default() == FurnitureIcons::Catalog {
        return Ok(DecodedTopViews::default());
    }
    let Some(given) = given else {
        notes.push(
            "furniture drawn as catalog icons: the views from above are rendered by the running \
             app (use --live or the app's export dialog)"
                .into(),
        );
        return Ok(DecodedTopViews::default());
    };
    let mut images = HashMap::new();
    for (key, data) in given.images {
        let raw = data.split_once(',').map_or(data.as_str(), |(_, b)| b);
        let png = base64::engine::general_purpose::STANDARD
            .decode(raw.trim())
            .map_err(|e| CommandError::failed(format!("invalid top view '{key}': {e}")))?;
        images.insert(format!("top-view:{key}"), png);
    }
    let pieces = given
        .pieces
        .into_iter()
        .map(|(id, key)| (id, format!("top-view:{key}")))
        .filter(|(_, name)| images.contains_key(name))
        .collect();
    Ok(DecodedTopViews { images, pieces })
}

/// Plans of the levels as the app draws them, with icons (or views from above) and textures.
fn plan_drawings<'a>(
    doc: &Document,
    levels: &[Option<&'a msh_model::Level>],
    top_views: &DecodedTopViews,
) -> Vec<(Option<&'a msh_model::Level>, msh_export::PlanDrawing)> {
    let home = doc.home();
    let mut images = ImageSource::default();
    levels
        .iter()
        .map(|level| {
            let id = level.map(|l| l.attrs.id.clone());
            let mut opts = msh_export::PlanOptions::export(id.clone());
            opts.images = msh_export::plan_images(home, id.as_deref())
                .into_iter()
                .filter_map(|name| images.get(doc, &name).map(|data| (name, data)))
                .collect();
            opts.images
                .extend(top_views.images.iter().map(|(k, v)| (k.clone(), v.clone())));
            opts.top_views = top_views.pieces.clone();
            (*level, msh_export::draw_plan(home, &opts))
        })
        .collect()
}

fn paper(name: Option<&str>) -> Result<msh_export::Paper, CommandError> {
    match name {
        None => Ok(msh_export::Paper::A4),
        Some(name) => msh_export::Paper::by_name(name).ok_or_else(|| {
            CommandError::failed(format!(
                "unknown paper '{name}' (a0 to a5, letter, legal, tabloid, or width x height in \
                 mm such as 500x700)"
            ))
        }),
    }
}

/// The title block of the plan pages of a level, if wanted.
fn title_block(
    doc: &Document,
    given: Option<&TitleBlockParams>,
    level: Option<&msh_model::Level>,
) -> Option<msh_export::TitleBlock> {
    let given = given?;
    let home = doc.home();
    Some(msh_export::TitleBlock {
        project: given
            .project
            .clone()
            .filter(|p| !p.trim().is_empty())
            .unwrap_or_else(|| home_title(doc)),
        drawing: match level {
            Some(l) => format!("Plan - {}", l.attrs.name),
            None => "Plan".into(),
        },
        author: given.author.clone().filter(|a| !a.trim().is_empty()),
        date: chrono::Local::now().format("%Y-%m-%d").to_string(),
        north: home
            .compass
            .as_ref()
            .map(|c| c.attrs.north_direction.unwrap_or(0.0)),
    })
}

/// What a plan split into several pages says in the notes of the result.
fn split_note(
    level: Option<&msh_model::Level>,
    laid: &msh_export::PlanPages,
    paper: Option<&str>,
) -> String {
    let what = level.map_or_else(
        || "the plan".to_string(),
        |l| format!("the plan of {}", l.attrs.name),
    );
    format!(
        "{what} does not fit on one {} page at 1:{}: it is split into {} pages ({} across, {} \
         down); choose a larger paper or a smaller scale for one page",
        paper.unwrap_or("a4").to_ascii_uppercase(),
        laid.scale.round(),
        laid.pages.len(),
        laid.columns,
        laid.rows
    )
}

/// Replaces the sheet numbers of the title blocks ("1 / 1" per plan) by the numbers among
/// all pages.
fn renumber_sheets(pages: Vec<String>) -> Vec<String> {
    let count = pages.len();
    pages
        .into_iter()
        .enumerate()
        .map(|(i, svg)| sheet_number(svg, i + 1, count))
        .collect()
}

fn sheet_number(svg: String, sheet: usize, count: usize) -> String {
    // The sheet cell is the only text after the label "Sheet"
    let Some(label) = svg.find(">Sheet</text>") else {
        return svg;
    };
    let rest = &svg[label..];
    let Some(open) = rest[13..].find('>').map(|i| label + 13 + i + 1) else {
        return svg;
    };
    let Some(close) = svg[open..].find("</text>").map(|i| open + i) else {
        return svg;
    };
    format!("{}{sheet} / {count}{}", &svg[..open], &svg[close..])
}

const PAGE_MARGIN: f32 = 12.0;

/// Pages of the printed home: furniture list, plan of each level and the 3D view, like
/// Sweet Home 3D's print. Written as PDF, or returned as SVG pages for printing.
fn export_document(doc: &Document, p: DocumentParams) -> Result<serde_json::Value, CommandError> {
    use base64::Engine;
    let home = doc.home();
    let paper = paper(p.paper.as_deref())?;
    let title = home_title(doc);
    let mut pages: Vec<msh_export::Page> = Vec::new();
    let mut notes: Vec<String> = Vec::new();

    if p.furniture.unwrap_or(true) {
        let columns = msh_export::resolve_columns(home, p.columns.as_deref())
            .map_err(CommandError::failed)?;
        pages.extend(msh_export::furniture_pages(
            home,
            &columns,
            paper,
            p.landscape,
            PAGE_MARGIN,
            &format!("{title} - Furniture"),
        ));
    }
    if p.plan.unwrap_or(true) {
        let levels = select_levels(home, Some(p.level.as_deref().unwrap_or("all")))?;
        let top_views = top_views(p.furniture_icons, p.top_views, &mut notes)?;
        for (level, drawing) in plan_drawings(doc, &levels, &top_views) {
            let page_title = match level {
                Some(l) => format!("{title} - {}", l.attrs.name),
                None => format!("{title} - Plan"),
            };
            let laid = msh_export::plan_pages(
                &drawing,
                &msh_export::PageOptions {
                    paper,
                    landscape: p.landscape,
                    margin_mm: PAGE_MARGIN,
                    scale: p.scale,
                    title: Some(page_title),
                    title_block: title_block(doc, p.title_block.as_ref(), level),
                },
            );
            if laid.pages.len() > 1 {
                notes.push(split_note(level, &laid, p.paper.as_deref()));
            }
            pages.extend(laid.pages);
        }
    }
    if p.view_3d.unwrap_or(true) {
        match &p.view_3d_image {
            Some(data) => {
                let base64 = data.split_once(',').map_or(data.as_str(), |(_, b)| b);
                let png = base64::engine::general_purpose::STANDARD
                    .decode(base64)
                    .map_err(|e| CommandError::failed(format!("invalid view_3d_image: {e}")))?;
                let page = msh_export::image_page(
                    &png,
                    paper,
                    p.landscape,
                    PAGE_MARGIN,
                    &format!("{title} - 3D view"),
                )
                .ok_or_else(|| CommandError::failed("view_3d_image must be a PNG image"))?;
                pages.push(page);
            }
            None => notes.push(
                "3D view not included: it is rendered by the running app (use --live or the \
                 app's print dialog)"
                    .into(),
            ),
        }
    }
    if pages.is_empty() {
        return Err(CommandError::failed(
            "nothing to print: choose at least one part",
        ));
    }

    let landscape: Vec<bool> = pages.iter().map(|p| p.landscape).collect();
    let print = home.print.as_ref().map(|p| &p.attrs);
    let now = chrono::Local::now();
    let frame = msh_export::PageFrame {
        header: p
            .header
            .clone()
            .or_else(|| print.and_then(|a| a.header_format.clone())),
        footer: p
            .footer
            .clone()
            .or_else(|| print.and_then(|a| a.footer_format.clone())),
        name: title.clone(),
        file: doc
            .path
            .as_ref()
            .and_then(|p| p.file_name())
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default(),
        date: now.format("%Y-%m-%d").to_string(),
        time: now.format("%H:%M").to_string(),
    };
    let svgs = renumber_sheets(msh_export::page_svgs_framed(
        &pages,
        paper,
        PAGE_MARGIN,
        Some(&title),
        &frame,
    ));
    match &p.path {
        Some(path) => {
            let pdf = msh_export::pdf_from_svg_pages(&svgs).map_err(CommandError::failed)?;
            write(path, &pdf)?;
            Ok(json!({ "path": path, "pages": svgs.len(), "notes": notes }))
        }
        None => Ok(json!({
            "pages": svgs,
            "landscape": landscape,
            "paper_mm": [paper.width_mm, paper.height_mm],
            "notes": notes,
        })),
    }
}

/// Images of icons and textures: from the open file, else from the installed libraries
/// (example homes reference Sweet Home 3D's catalog resources by class path).
#[derive(Default)]
struct ImageSource {
    libraries: Option<Vec<PathBuf>>,
}

impl ImageSource {
    fn get(&mut self, doc: &Document, name: &str) -> Option<Vec<u8>> {
        if let Some(c) = doc.file.contents.iter().find(|c| c.name == name) {
            return Some(c.data.clone());
        }
        let libraries = self
            .libraries
            .get_or_insert_with(|| msh_catalog::find_all_libraries(&[]));
        libraries
            .iter()
            .find_map(|lib| msh_catalog::read_resource(lib, name).ok())
    }
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
}

/// `plan.svg` + "Level 1" → `plan - Level 1.svg` (characters not allowed in file names removed).
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let clean: String = suffix
        .chars()
        .filter(|c| !r#"\/:*?"<>|"#.contains(*c))
        .collect();
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let name = match path.extension() {
        Some(e) => format!("{stem} - {clean}.{}", e.to_string_lossy()),
        None => format!("{stem} - {clean}"),
    };
    path.with_file_name(name)
}

fn write(path: &Path, data: &[u8]) -> Result<(), CommandError> {
    std::fs::write(path, data)
        .map_err(|e| CommandError::failed(format!("cannot write {}: {e}", path.display())))
}
