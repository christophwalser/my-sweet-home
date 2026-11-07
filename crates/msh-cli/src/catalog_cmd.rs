//! `msh catalog …` – find, list and search libraries.

use anyhow::Result;
use clap::{Subcommand, ValueEnum};
use msh_catalog::{Catalog, CatalogKind, find_all_libraries, open_library};
use serde::Serialize;
use std::path::PathBuf;

/// Default language for catalog names and categories. Catalog content is user
/// data and comes in the language of the catalog translations.
const DEFAULT_CATALOG_LANG: &str = "de";

#[derive(Subcommand)]
pub enum CatalogCommand {
    /// Finds installed libraries (Sweet Home 3D, Store version, user libraries)
    Scan {
        /// Additional folder with .sh3f/.sh3t files (can be repeated)
        #[arg(long = "dir")]
        dirs: Vec<PathBuf>,
    },
    /// Lists the content of a library file
    List {
        file: PathBuf,
        /// Language for names and categories, e.g. de or en
        #[arg(long, default_value = DEFAULT_CATALOG_LANG)]
        lang: String,
    },
    /// Searches all found libraries by name, category, tags and creator
    Search {
        query: String,
        #[arg(long, value_enum)]
        kind: Option<Kind>,
        #[arg(long, default_value = DEFAULT_CATALOG_LANG)]
        lang: String,
        #[arg(long, default_value_t = 25)]
        limit: usize,
        #[arg(long = "dir")]
        dirs: Vec<PathBuf>,
    },
}

#[derive(Clone, Copy, ValueEnum)]
pub enum Kind {
    Furniture,
    Textures,
}

pub fn run(cmd: CatalogCommand, json: bool) -> Result<()> {
    match cmd {
        CatalogCommand::Scan { dirs } => scan(&dirs, json),
        CatalogCommand::List { file, lang } => {
            let catalogs = open_library(&file, Some(&lang))?;
            if json {
                println!("{}", serde_json::to_string_pretty(&catalogs)?);
            } else {
                for c in &catalogs {
                    print_header(c);
                    for f in &c.furniture {
                        println!(
                            "  {:<40} {:<18} {:>6.0}×{:>4.0}×{:>4.0} cm  {}",
                            f.name,
                            f.category,
                            f.width,
                            f.depth,
                            f.height,
                            f.id.as_deref().unwrap_or("")
                        );
                    }
                    for t in &c.textures {
                        println!(
                            "  {:<40} {:<18} {:>6.1}×{:>5.1} cm  {}",
                            t.name,
                            t.category,
                            t.width,
                            t.height,
                            t.id.as_deref().unwrap_or("")
                        );
                    }
                }
            }
            Ok(())
        }
        CatalogCommand::Search {
            query,
            kind,
            lang,
            limit,
            dirs,
        } => search(&query, kind, &lang, limit, &dirs, json),
    }
}

#[derive(Serialize)]
struct LibrarySummary {
    path: PathBuf,
    name: Option<String>,
    kind: CatalogKind,
    version: Option<String>,
    license: Option<String>,
    items: usize,
    skipped: usize,
}

fn scan(extra: &[PathBuf], json: bool) -> Result<()> {
    let mut list = Vec::new();
    let mut errors = Vec::new();
    for path in find_all_libraries(extra) {
        match open_library(&path, Some(DEFAULT_CATALOG_LANG)) {
            // Skip empty placeholder catalogs (e.g. ContributedFurnitureCatalog)
            Ok(cats) => list.extend(
                cats.into_iter()
                    .filter(|c| c.furniture.len() + c.textures.len() > 0)
                    .map(|c| LibrarySummary {
                        path: c.source.clone(),
                        name: c.name.clone(),
                        kind: c.kind,
                        version: c.version.clone(),
                        license: c.license.clone(),
                        items: c.furniture.len() + c.textures.len(),
                        skipped: c.skipped.len(),
                    }),
            ),
            Err(e) => errors.push(e.to_string()),
        }
    }
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(
                &serde_json::json!({ "libraries": list, "errors": errors })
            )?
        );
        return Ok(());
    }
    let (mut furniture, mut textures) = (0, 0);
    for l in &list {
        let kind = match l.kind {
            CatalogKind::Furniture => {
                furniture += l.items;
                "Furniture"
            }
            CatalogKind::Textures => {
                textures += l.items;
                "Textures"
            }
        };
        println!(
            "{:<9} {:>5}  {:<38} {}",
            kind,
            l.items,
            l.name.as_deref().unwrap_or("?"),
            l.path.display()
        );
        if let Some(lic) = &l.license {
            println!("{:17}License: {lic}", "");
        }
    }
    println!(
        "\nTotal: {furniture} pieces of furniture, {textures} textures in {} catalogs",
        list.len()
    );
    for e in errors {
        eprintln!("Error: {e}");
    }
    Ok(())
}

#[derive(Serialize)]
struct Hit {
    kind: CatalogKind,
    id: Option<String>,
    name: String,
    category: String,
    creator: Option<String>,
    size_cm: [f32; 3],
    library: Option<String>,
    path: PathBuf,
}

fn search(
    query: &str,
    kind: Option<Kind>,
    lang: &str,
    limit: usize,
    extra: &[PathBuf],
    json: bool,
) -> Result<()> {
    let words: Vec<String> = query
        .to_lowercase()
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    let matches = |fields: &[&str]| {
        let hay = fields.join(" ").to_lowercase();
        words.iter().all(|w| hay.contains(w.as_str()))
    };

    let mut hits = Vec::new();
    for path in find_all_libraries(extra) {
        let Ok(cats) = open_library(&path, Some(lang)) else {
            continue;
        };
        for c in cats {
            collect_hits(&c, kind, &matches, &mut hits);
        }
    }
    let total = hits.len();
    hits.truncate(limit);

    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({ "total": total, "hits": hits }))?
        );
    } else {
        for h in &hits {
            println!(
                "{:<38} {:<16} {:>5.0}×{:>4.0}×{:>4.0}  {:<28} {}",
                h.name,
                h.category,
                h.size_cm[0],
                h.size_cm[1],
                h.size_cm[2],
                h.id.as_deref().unwrap_or(""),
                h.library.as_deref().unwrap_or("")
            );
        }
        println!("\n{} of {total} hits", hits.len());
    }
    Ok(())
}

fn collect_hits(
    c: &Catalog,
    kind: Option<Kind>,
    matches: &dyn Fn(&[&str]) -> bool,
    hits: &mut Vec<Hit>,
) {
    if !matches!(kind, Some(Kind::Textures)) {
        for f in &c.furniture {
            let tags = f.tags.join(" ");
            let fields = [
                f.name.as_str(),
                f.category.as_str(),
                tags.as_str(),
                f.creator.as_deref().unwrap_or(""),
                f.id.as_deref().unwrap_or(""),
            ];
            if matches(&fields) {
                hits.push(Hit {
                    kind: CatalogKind::Furniture,
                    id: f.id.clone(),
                    name: f.name.clone(),
                    category: f.category.clone(),
                    creator: f.creator.clone(),
                    size_cm: [f.width, f.depth, f.height],
                    library: c.name.clone(),
                    path: c.source.clone(),
                });
            }
        }
    }
    if !matches!(kind, Some(Kind::Furniture)) {
        for t in &c.textures {
            let fields = [
                t.name.as_str(),
                t.category.as_str(),
                t.creator.as_deref().unwrap_or(""),
                t.id.as_deref().unwrap_or(""),
            ];
            if matches(&fields) {
                hits.push(Hit {
                    kind: CatalogKind::Textures,
                    id: t.id.clone(),
                    name: t.name.clone(),
                    category: t.category.clone(),
                    creator: t.creator.clone(),
                    size_cm: [t.width, t.height, 0.0],
                    library: c.name.clone(),
                    path: c.source.clone(),
                });
            }
        }
    }
}

fn print_header(c: &Catalog) {
    println!(
        "{} ({}, {} entries){}",
        c.name.as_deref().unwrap_or("Catalog"),
        c.version.as_deref().unwrap_or("?"),
        c.furniture.len() + c.textures.len(),
        c.license
            .as_deref()
            .map(|l| format!(" – License: {l}"))
            .unwrap_or_default()
    );
    for (i, reason) in &c.skipped {
        println!("  skipped #{i}: {reason}");
    }
}
