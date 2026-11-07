//! `msh` – Kommandozeile von My Sweet Home.
//!
//! In Phase P3 werden die bearbeitenden Unterbefehle automatisch aus der
//! Command-Registry von `msh-core` erzeugt, und `msh mcp` startet den MCP-Server.

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use msh_format::Sh3dDocument;
use serde::Serialize;
use std::path::{Path, PathBuf};

mod catalog_cmd;

#[derive(Parser)]
#[command(name = "msh", version, about = "My Sweet Home – Kommandozeile")]
struct Cli {
    /// Ausgabe als JSON (für Skripte und KI)
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Zeigt Name und Version der Anwendung an
    Version,
    /// Zeigt eine Übersicht eines Projekts (.sh3d oder Home.xml)
    Info { file: PathBuf },
    /// Gibt das vollständige Projektmodell als JSON aus
    Dump { file: PathBuf },
    /// Liest ein Projekt und speichert es neu (Formattest)
    Resave { input: PathBuf, output: PathBuf },
    /// Möbel- und Texturbibliotheken
    #[command(subcommand)]
    Catalog(catalog_cmd::CatalogCommand),
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Version => {
            let info = msh_core::app_info();
            if cli.json {
                println!("{}", serde_json::to_string(&info)?);
            } else {
                println!("{} {}", info.name, info.version);
            }
        }
        Command::Info { file } => {
            let doc = open(&file)?;
            let summary = Summary::of(&doc);
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&summary)?);
            } else {
                summary.print();
            }
        }
        Command::Dump { file } => {
            let doc = open(&file)?;
            println!("{}", serde_json::to_string_pretty(&doc.home)?);
        }
        Command::Resave { input, output } => {
            let doc = open(&input)?;
            doc.save(&output)
                .with_context(|| format!("Speichern nach {} fehlgeschlagen", output.display()))?;
            if cli.json {
                println!("{}", serde_json::json!({ "saved": output }));
            } else {
                println!("Gespeichert: {}", output.display());
            }
        }
        Command::Catalog(cmd) => catalog_cmd::run(cmd, cli.json)?,
    }
    Ok(())
}

/// Öffnet eine `.sh3d`-Datei oder ein einzelnes `Home.xml`.
fn open(path: &Path) -> Result<Sh3dDocument> {
    let is_xml = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("xml"));
    let doc = if is_xml {
        let bytes = std::fs::read(path)?;
        Sh3dDocument::new(msh_format::read_home_xml(&bytes)?)
    } else {
        Sh3dDocument::open(path)?
    };
    Ok(doc)
}

#[derive(Serialize)]
struct Summary {
    name: Option<String>,
    format_version: Option<i64>,
    levels: Vec<String>,
    walls: usize,
    total_wall_length_m: f64,
    rooms: Vec<RoomSummary>,
    furniture: usize,
    doors_and_windows: usize,
    lights: usize,
    dimension_lines: usize,
    labels: usize,
    polylines: usize,
    resources: usize,
    resource_bytes: usize,
}

#[derive(Serialize)]
struct RoomSummary {
    name: Option<String>,
    area_m2: f64,
}

impl Summary {
    fn of(doc: &Sh3dDocument) -> Self {
        let h = &doc.home;
        let mut doors = 0;
        let mut lights = 0;
        h.for_each_piece(|p| match p.kind {
            msh_model::PieceKind::DoorOrWindow => doors += 1,
            msh_model::PieceKind::Light => lights += 1,
            _ => {}
        });
        Self {
            name: h.attrs.name.clone(),
            format_version: h.attrs.version,
            levels: h.levels.iter().map(|l| l.attrs.name.clone()).collect(),
            walls: h.walls.len(),
            total_wall_length_m: round2(
                h.walls
                    .iter()
                    .map(|w| f64::from(w.chord_length()))
                    .sum::<f64>()
                    / 100.0,
            ),
            rooms: h
                .rooms
                .iter()
                .map(|r| RoomSummary {
                    name: r.attrs.name.clone(),
                    area_m2: round2(f64::from(r.area()) / 10_000.0),
                })
                .collect(),
            furniture: h.piece_count(),
            doors_and_windows: doors,
            lights,
            dimension_lines: h.dimension_lines.len(),
            labels: h.labels.len(),
            polylines: h.polylines.len(),
            resources: doc.contents.len(),
            resource_bytes: doc.contents.iter().map(|c| c.data.len()).sum(),
        }
    }

    fn print(&self) {
        println!(
            "Projekt:       {}",
            self.name.as_deref().unwrap_or("(ohne Namen)")
        );
        if let Some(v) = self.format_version {
            println!("Formatversion: {v}");
        }
        if !self.levels.is_empty() {
            println!("Ebenen:        {}", self.levels.join(", "));
        }
        println!(
            "Wände:         {} ({:.2} m)",
            self.walls, self.total_wall_length_m
        );
        println!("Räume:         {}", self.rooms.len());
        for r in &self.rooms {
            println!(
                "  - {:<24} {:>8.2} m²",
                r.name.as_deref().unwrap_or("(ohne Namen)"),
                r.area_m2
            );
        }
        println!(
            "Möbel:         {} (davon {} Türen/Fenster, {} Lampen)",
            self.furniture, self.doors_and_windows, self.lights
        );
        println!("Masslinien:    {}", self.dimension_lines);
        println!("Beschriftungen:{:>2}", self.labels);
        println!("Polylinien:    {}", self.polylines);
        println!(
            "Ressourcen:    {} ({:.1} MB)",
            self.resources,
            self.resource_bytes as f64 / 1_048_576.0
        );
    }
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
