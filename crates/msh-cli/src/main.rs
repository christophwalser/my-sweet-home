//! `msh` – Kommandozeile von My Sweet Home.
//!
//! In Phase P3 werden die Unterbefehle automatisch aus der Command-Registry
//! von `msh-core` erzeugt, und `msh mcp` startet den MCP-Server.

use anyhow::Result;
use clap::{Parser, Subcommand};

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
    /// Zeigt Name und Version an
    Info,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Info => {
            let info = msh_core::app_info();
            if cli.json {
                println!("{}", serde_json::to_string(&info)?);
            } else {
                println!("{} {}", info.name, info.version);
            }
        }
    }
    Ok(())
}
