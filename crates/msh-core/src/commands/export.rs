//! File exports: plan as SVG, PNG or PDF, furniture list as CSV.

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

#[derive(Deserialize, JsonSchema)]
struct PlanParams {
    /// File to write (.svg, .png or .pdf)
    path: PathBuf,
    /// "svg", "png" or "pdf" (default: from the file extension)
    format: Option<PlanFormat>,
    /// Level ID (default: selected level); "all" exports every level (PDF: one page per
    /// level, SVG/PNG: one file per level with the level name appended)
    level: Option<String>,
    /// PDF: paper size "a4" (default), "a3" or "letter"
    paper: Option<String>,
    /// PDF: landscape page (default: whichever fits the plan better)
    landscape: Option<bool>,
    /// PDF: scale denominator, e.g. 100 for 1:100 (default: fit to the page)
    scale: Option<f32>,
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
    /// Paper size "a4" (default), "a3" or "letter"
    paper: Option<String>,
    /// Landscape pages (default: per page, whichever fits better)
    landscape: Option<bool>,
    /// Plan scale denominator, e.g. 100 for 1:100 (default: fit to the page)
    scale: Option<f32>,
    /// Columns of the furniture list (default: the home's furniture table columns)
    columns: Option<Vec<String>>,
    /// Image of the 3D view as PNG (base64 or data URL)
    view_3d_image: Option<String>,
    /// Furniture in the plans "top_view" (default: seen from above) or "catalog" (icons)
    furniture_icons: Option<FurnitureIcons>,
    /// Views from above rendered by the app (supplied by the app in live mode)
    top_views: Option<TopViews>,
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
        "Exports the 2D plan as shown in the app (walls with patterns, rooms, furniture seen from \
         above or as icons, doors and windows, dimensions, labels, compass) as SVG, PNG or PDF \
         file. PDF pages can use a scale such as 1:100.",
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
        None => match extension(&p.path).as_deref() {
            Some("svg") => PlanFormat::Svg,
            Some("png") => PlanFormat::Png,
            Some("pdf") => PlanFormat::Pdf,
            _ => {
                return Err(CommandError::failed(
                    "give a format or a file name ending in .svg, .png or .pdf",
                ));
            }
        },
    };

    let selected = select_levels(home, p.level.as_deref())?;
    let home_name = home_title(doc);
    let mut notes = Vec::new();
    let top_views = top_views(p.furniture_icons, p.top_views, &mut notes)?;
    let drawings = plan_drawings(doc, &selected, &top_views);

    match format {
        PlanFormat::Pdf => {
            let paper = paper(p.paper.as_deref())?;
            let mut scales = Vec::new();
            let pages: Vec<String> = drawings
                .iter()
                .map(|(level, drawing)| {
                    let title = match level {
                        Some(l) => format!("{home_name} - {}", l.attrs.name),
                        None => home_name.clone(),
                    };
                    let (page, scale) = msh_export::plan_page_svg(
                        drawing,
                        &msh_export::PageOptions {
                            paper,
                            landscape: p.landscape,
                            scale: p.scale,
                            title: Some(title),
                            ..Default::default()
                        },
                    );
                    scales.push(scale.round());
                    page
                })
                .collect();
            let pdf = msh_export::pdf_from_svg_pages(&pages).map_err(CommandError::failed)?;
            write(&p.path, &pdf)?;
            Ok(json!({ "path": p.path, "pages": pages.len(), "scales": scales, "notes": notes }))
        }
        PlanFormat::Svg | PlanFormat::Png => {
            let several = drawings.len() > 1;
            let mut paths = Vec::new();
            for (level, drawing) in &drawings {
                let path = match level {
                    Some(l) if several => with_suffix(&p.path, &l.attrs.name),
                    _ => p.path.clone(),
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
            CommandError::failed(format!("unknown paper '{name}' (a4, a3 or letter)"))
        }),
    }
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
            let (page, _) = msh_export::plan_page(
                &drawing,
                &msh_export::PageOptions {
                    paper,
                    landscape: p.landscape,
                    margin_mm: PAGE_MARGIN,
                    scale: p.scale,
                    title: Some(page_title),
                },
            );
            pages.push(page);
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
    let svgs = msh_export::page_svgs(&pages, paper, PAGE_MARGIN, Some(&title));
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
