//! `msh` – command line interface of My Sweet Home.
//!
//! In phase P3 the editing subcommands are generated from the command registry
//! of `msh-core`, and `msh mcp` starts the MCP server.

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use msh_format::Sh3dDocument;
use serde::Serialize;
use std::path::{Path, PathBuf};

mod catalog_cmd;

#[derive(Parser)]
#[command(
    name = "msh",
    version,
    about = "My Sweet Home – command line interface"
)]
struct Cli {
    /// Output as JSON (for scripts and AI agents)
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Shows the application name and version
    Version,
    /// Shows a summary of a project (.sh3d or Home.xml)
    Info { file: PathBuf },
    /// Prints the complete project model as JSON
    Dump { file: PathBuf },
    /// Reads a project and saves it again (format test)
    Resave { input: PathBuf, output: PathBuf },
    /// Furniture and texture libraries
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
                .with_context(|| format!("failed to save {}", output.display()))?;
            if cli.json {
                println!("{}", serde_json::json!({ "saved": output }));
            } else {
                println!("Saved: {}", output.display());
            }
        }
        Command::Catalog(cmd) => catalog_cmd::run(cmd, cli.json)?,
    }
    Ok(())
}

/// Opens a `.sh3d` file or a standalone `Home.xml`.
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
            "Project:         {}",
            self.name.as_deref().unwrap_or("(unnamed)")
        );
        if let Some(v) = self.format_version {
            println!("Format version:  {v}");
        }
        if !self.levels.is_empty() {
            println!("Levels:          {}", self.levels.join(", "));
        }
        println!(
            "Walls:           {} ({:.2} m)",
            self.walls, self.total_wall_length_m
        );
        println!("Rooms:           {}", self.rooms.len());
        for r in &self.rooms {
            println!(
                "  - {:<24} {:>8.2} m²",
                r.name.as_deref().unwrap_or("(unnamed)"),
                r.area_m2
            );
        }
        println!(
            "Furniture:       {} ({} doors/windows, {} lights)",
            self.furniture, self.doors_and_windows, self.lights
        );
        println!("Dimension lines: {}", self.dimension_lines);
        println!("Labels:          {}", self.labels);
        println!("Polylines:       {}", self.polylines);
        println!(
            "Resources:       {} ({:.1} MB)",
            self.resources,
            self.resource_bytes as f64 / 1_048_576.0
        );
    }
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
