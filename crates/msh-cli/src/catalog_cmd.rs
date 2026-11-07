//! `msh catalog scan|list` – find and list libraries (search is the registry command `catalog_search`).

use anyhow::Result;
use clap::Subcommand;
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
