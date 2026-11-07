//! File exports: plan as SVG, PNG or PDF, furniture list as CSV.

use crate::Document;
use crate::registry::{CommandError, Registry};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;
use std::path::{Path, PathBuf};

#[derive(Deserialize, JsonSchema, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
enum PlanFormat {
    Svg,
    Png,
    Pdf,
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
        "Exports the 2D plan as shown in the app (walls with patterns, rooms, furniture icons, \
         doors and windows, dimensions, labels, compass) as SVG, PNG or PDF file. PDF pages can \
         use a scale such as 1:100.",
        false,
        |doc, p: PlanParams| export_plan(doc, p),
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

    // Levels to export, lowest first
    let mut levels: Vec<&msh_model::Level> = home.levels.iter().collect();
    levels.sort_by(|a, b| {
        a.attrs
            .elevation
            .total_cmp(&b.attrs.elevation)
            .then(a.attrs.elevation_index.cmp(&b.attrs.elevation_index))
    });
    let selected: Vec<Option<&msh_model::Level>> = match p.level.as_deref() {
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
    };

    let home_name = home
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
    let home_name = match home_name.to_ascii_lowercase().strip_suffix(".sh3d") {
        Some(stem) => home_name[..stem.len()].to_string(),
        None => home_name,
    };
    let mut images = ImageSource::default();
    let drawings: Vec<(Option<&msh_model::Level>, msh_export::PlanDrawing)> = selected
        .iter()
        .map(|level| {
            let id = level.map(|l| l.attrs.id.clone());
            let mut opts = msh_export::PlanOptions::export(id.clone());
            opts.images = msh_export::plan_images(home, id.as_deref())
                .into_iter()
                .filter_map(|name| images.get(doc, &name).map(|data| (name, data)))
                .collect();
            (*level, msh_export::draw_plan(home, &opts))
        })
        .collect();

    match format {
        PlanFormat::Pdf => {
            let paper = match p.paper.as_deref() {
                None => msh_export::Paper::A4,
                Some(name) => msh_export::Paper::by_name(name).ok_or_else(|| {
                    CommandError::failed(format!("unknown paper '{name}' (a4, a3 or letter)"))
                })?,
            };
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
            Ok(json!({ "path": p.path, "pages": pages.len(), "scales": scales }))
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
            Ok(json!({ "paths": paths }))
        }
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
