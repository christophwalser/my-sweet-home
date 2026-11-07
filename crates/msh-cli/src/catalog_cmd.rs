//! `msh catalog …` – Bibliotheken finden, auflisten, durchsuchen.

use anyhow::Result;
use clap::{Subcommand, ValueEnum};
use msh_catalog::{Catalog, CatalogKind, find_libraries, open_library};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Subcommand)]
pub enum CatalogCommand {
    /// Sucht installierte Bibliotheken (Sweet Home 3D, Store-Version, eigene)
    Scan {
        /// Zusätzlicher Ordner mit .sh3f/.sh3t-Dateien (mehrfach möglich)
        #[arg(long = "dir")]
        dirs: Vec<PathBuf>,
    },
    /// Listet den Inhalt einer Bibliotheksdatei
    List {
        file: PathBuf,
        /// Sprache für Namen und Kategorien, z. B. de
        #[arg(long, default_value = "de")]
        lang: String,
    },
    /// Durchsucht alle gefundenen Bibliotheken nach Name, Kategorie, Tags, Hersteller
    Search {
        query: String,
        #[arg(long, value_enum)]
        kind: Option<Kind>,
        #[arg(long, default_value = "de")]
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

/// Bibliotheksordner inkl. Store-Version.
fn library_dirs(extra: &[PathBuf]) -> Vec<PathBuf> {
    let mut dirs = extra.to_vec();
    if let Some(store) = store_resources_dir() {
        dirs.push(store.join("furniture"));
        dirs.push(store.join("textures"));
    }
    dirs
}

/// Ressourcenordner der Microsoft-Store-Version, falls installiert.
fn store_resources_dir() -> Option<PathBuf> {
    let out = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-AppxPackage -Name eTeks.SweetHome3D | Select-Object -First 1).InstallLocation",
        ])
        .output()
        .ok()?;
    let loc = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    if loc.is_empty() {
        return None;
    }
    let dir = PathBuf::from(loc).join("Sweet Home 3D").join("resources");
    dir.is_dir().then_some(dir)
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
    for path in find_libraries(&library_dirs(extra)) {
        match open_library(&path, Some("de")) {
            // Leere Platzhalter-Kataloge (z. B. ContributedFurnitureCatalog) weglassen
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
                "Möbel"
            }
            CatalogKind::Textures => {
                textures += l.items;
                "Texturen"
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
            println!("{:17}Lizenz: {lic}", "");
        }
    }
    println!(
        "\nGesamt: {furniture} Möbel, {textures} Texturen in {} Katalogen",
        list.len()
    );
    for e in errors {
        eprintln!("Fehler: {e}");
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
    for path in find_libraries(&library_dirs(extra)) {
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
        println!("\n{} von {total} Treffern", hits.len());
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
        "{} ({}, {} Einträge){}",
        c.name.as_deref().unwrap_or("Katalog"),
        c.version.as_deref().unwrap_or("?"),
        c.furniture.len() + c.textures.len(),
        c.license
            .as_deref()
            .map(|l| format!(" – Lizenz: {l}"))
            .unwrap_or_default()
    );
    for (i, reason) in &c.skipped {
        println!("  übersprungen #{i}: {reason}");
    }
}
