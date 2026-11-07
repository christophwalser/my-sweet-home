//! `msh` – command line interface of My Sweet Home.
//!
//! Besides a few fixed commands (`info`, `dump`, `resave`, `catalog scan|list`,
//! `commands`, `exec`, `mcp`), all subcommands are generated from the command
//! registry of `msh-core`: the command `wall_add_path` becomes
//! `msh wall add-path --points '[[0,0],[500,0]]'`. With `--file`, the home is
//! loaded from that file and saved back after a modifying command.

use anyhow::{Context, Result, anyhow, bail};
use clap::{Arg, ArgAction, ArgMatches, Command, FromArgMatches, Subcommand, value_parser};
use msh_core::{Document, Registry};
use msh_format::Sh3dDocument;
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};

mod catalog_cmd;
mod mcp;

fn main() -> Result<()> {
    let registry = Registry::standard();
    let matches = build_cli(&registry).get_matches();
    let json_output = matches.get_flag("json");
    match matches.subcommand() {
        Some(("version", _)) => {
            let info = msh_core::app_info();
            if json_output {
                println!("{}", serde_json::to_string(&info)?);
            } else {
                println!("{} {}", info.name, info.version);
            }
        }
        Some(("info", m)) => {
            let doc = open_file(m.get_one::<PathBuf>("path").expect("required"))?;
            let summary = Summary::of(&doc);
            if json_output {
                println!("{}", serde_json::to_string_pretty(&summary)?);
            } else {
                summary.print();
            }
        }
        Some(("dump", m)) => {
            let doc = open_file(m.get_one::<PathBuf>("path").expect("required"))?;
            println!("{}", serde_json::to_string_pretty(&doc.home)?);
        }
        Some(("resave", m)) => {
            let doc = open_file(m.get_one::<PathBuf>("input").expect("required"))?;
            let output = m.get_one::<PathBuf>("output").expect("required");
            doc.save(output)
                .with_context(|| format!("failed to save {}", output.display()))?;
            if json_output {
                println!("{}", json!({ "saved": output }));
            } else {
                println!("Saved: {}", output.display());
            }
        }
        Some(("commands", _)) => {
            let list: Vec<Value> = registry
                .list()
                .iter()
                .map(|c| {
                    json!({
                        "name": c.name,
                        "description": c.description,
                        "modifies": c.modifies,
                        "params": c.params_schema,
                    })
                })
                .collect();
            println!("{}", serde_json::to_string_pretty(&list)?);
        }
        Some(("exec", _)) => exec(&registry, &matches)?,
        Some(("mcp", _)) => {
            let file = matches.get_one::<PathBuf>("home_file").cloned();
            mcp::serve(&registry, file, matches.get_flag("live"))?;
        }
        Some(("screenshot", m)) => {
            let mut client = msh_ipc::Client::connect()?;
            let mode = m.get_one::<String>("mode").cloned();
            let result = client.call("capture_3d", json!({ "mode": mode }))?;
            print_result(result, matches.get_one::<PathBuf>("out"))?;
        }
        Some(("status", _)) => {
            let mut client = msh_ipc::Client::connect()?;
            println!(
                "{}",
                serde_json::to_string_pretty(&client.call("status", Value::Null)?)?
            );
        }
        Some(("catalog", m)) if matches!(m.subcommand_name(), Some("scan" | "list")) => {
            let cmd = catalog_cmd::CatalogCommand::from_arg_matches(m)?;
            catalog_cmd::run(cmd, json_output)?;
        }
        Some((group, m)) => {
            let (action, am) = m
                .subcommand()
                .ok_or_else(|| anyhow!("missing action for '{group}'"))?;
            let name = format!("{group}_{}", action.replace('-', "_"));
            run_registry_command(&registry, &matches, &name, am)?;
        }
        None => {
            build_cli(&registry).print_help()?;
        }
    }
    Ok(())
}

/// Builds the clap command tree: fixed commands plus one group per registry prefix.
fn build_cli(registry: &Registry) -> Command {
    let mut cli = Command::new("msh")
        .version(env!("CARGO_PKG_VERSION"))
        .about("My Sweet Home – command line interface")
        .after_help(
            "Lengths in cm, y axis points down, angles in degrees (clockwise), colors #RRGGBB.\n\
             Example: msh --file house.sh3d wall add-path --points '[[0,0],[800,0],[800,600],[0,600]]' --closed",
        )
        .arg(
            Arg::new("json")
                .long("json")
                .global(true)
                .action(ArgAction::SetTrue)
                .help("Output as JSON (for scripts and AI agents)"),
        )
        .arg(
            Arg::new("home_file")
                .long("file")
                .short('f')
                .global(true)
                .value_parser(value_parser!(PathBuf))
                .help("Home file (.sh3d) to work on; saved after modifying commands"),
        )
        .arg(
            Arg::new("out")
                .long("out")
                .short('o')
                .global(true)
                .value_parser(value_parser!(PathBuf))
                .help("Output file for images (view plan-image)"),
        )
        .arg(
            Arg::new("dry_run")
                .long("dry-run")
                .global(true)
                .action(ArgAction::SetTrue)
                .help("Do not save the home after a modifying command"),
        )
        .arg(
            Arg::new("live")
                .long("live")
                .short('l')
                .global(true)
                .action(ArgAction::SetTrue)
                .help("Send commands to the running My Sweet Home app (changes appear in its window)"),
        )
        .subcommand(Command::new("version").about("Shows the application name and version"))
        .subcommand(
            Command::new("info")
                .about("Shows a summary of a project (.sh3d or Home.xml)")
                .arg(Arg::new("path").required(true).value_parser(value_parser!(PathBuf))),
        )
        .subcommand(
            Command::new("dump")
                .about("Prints the complete project model as JSON")
                .arg(Arg::new("path").required(true).value_parser(value_parser!(PathBuf))),
        )
        .subcommand(
            Command::new("resave")
                .about("Reads a project and saves it again (format test)")
                .arg(Arg::new("input").required(true).value_parser(value_parser!(PathBuf)))
                .arg(Arg::new("output").required(true).value_parser(value_parser!(PathBuf))),
        )
        .subcommand(Command::new("commands").about("Lists all registry commands with their JSON schemas"))
        .subcommand(Command::new("exec").about(
            "Executes commands from stdin, one JSON object per line: {\"command\": \"wall_add\", \"params\": {...}}",
        ))
        .subcommand(Command::new("mcp").about(
            "Starts the MCP server on stdin/stdout (for Claude and other AI agents); with --live it controls the running app",
        ))
        .subcommand(
            Command::new("screenshot")
                .about("Saves a PNG of the 3D view of the running app (use with --out)")
                .arg(
                    Arg::new("mode")
                        .long("mode")
                        .value_parser(["aerial", "observer"])
                        .help("aerial (default) or observer (virtual visit)"),
                ),
        )
        .subcommand(Command::new("status").about("Shows whether the app is running and which home is open"));

    // One subcommand group per registry prefix; "catalog" also keeps scan/list
    let mut groups: BTreeMap<&str, Command> = BTreeMap::new();
    groups.insert(
        "catalog",
        catalog_cmd::CatalogCommand::augment_subcommands(
            Command::new("catalog").about("Furniture and texture catalogs"),
        ),
    );
    for spec in registry.list() {
        let (group, action) = spec.group_action();
        let entry = groups
            .remove(group)
            .unwrap_or_else(|| Command::new(group).about(group_about(group)));
        let mut sub = Command::new(action.replace('_', "-")).about(spec.description);
        let required: Vec<&str> = spec.params_schema["required"]
            .as_array()
            .map(|a| a.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        if let Some(props) = spec.params_schema["properties"].as_object() {
            for (name, schema) in props {
                let mut arg = Arg::new(name.clone())
                    .long(name.replace('_', "-"))
                    .required(required.contains(&name.as_str()))
                    .help(schema["description"].as_str().unwrap_or("").to_owned());
                if json_type(schema) == Some("boolean") {
                    // `--closed` alone means true; `--closed=false` is also accepted
                    arg = arg
                        .num_args(0..=1)
                        .default_missing_value("true")
                        .require_equals(true);
                } else {
                    // Coordinates may be negative: `--y -80`
                    arg = arg.allow_hyphen_values(true);
                }
                sub = sub.arg(arg);
            }
        }
        groups.insert(group, entry.subcommand(sub));
    }
    for (_, g) in groups {
        cli = cli.subcommand(g.subcommand_required(true));
    }
    cli
}

fn group_about(group: &str) -> &'static str {
    match group {
        "home" => "Create, open, save and inspect homes",
        "level" => "Levels (storeys)",
        "wall" => "Walls",
        "room" => "Rooms",
        "furniture" => "Furniture, doors and windows",
        "label" => "Text labels",
        "dimension" => "Dimension lines",
        "edit" => "Delete, undo, redo",
        "view" => "Images of the home",
        _ => "Commands",
    }
}

/// Primary JSON type of a property schema (ignoring `null` of optional values).
fn json_type(schema: &Value) -> Option<&str> {
    match &schema["type"] {
        Value::String(s) => Some(s.as_str()),
        Value::Array(a) => a.iter().filter_map(Value::as_str).find(|t| *t != "null"),
        _ => None,
    }
}

/// Converts CLI argument strings into JSON parameters according to the schema.
fn params_from_matches(schema: &Value, m: &ArgMatches) -> Result<Value> {
    let mut params = Map::new();
    if let Some(props) = schema["properties"].as_object() {
        for (name, prop) in props {
            let Some(raw) = m.get_one::<String>(name) else {
                continue;
            };
            let value = match json_type(prop) {
                Some("number") => json!(
                    raw.parse::<f64>()
                        .with_context(|| format!("--{name}: not a number"))?
                ),
                Some("integer") => json!(
                    raw.parse::<i64>()
                        .with_context(|| format!("--{name}: not an integer"))?
                ),
                Some("boolean") => json!(
                    raw.parse::<bool>()
                        .with_context(|| format!("--{name}: expected true or false"))?
                ),
                Some("string") => Value::String(raw.clone()),
                // Arrays, objects and enums: JSON if possible, otherwise a plain string
                _ => serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.clone())),
            };
            params.insert(name.clone(), value);
        }
    }
    Ok(Value::Object(params))
}

/// Loads the document for a registry command (from `--file` if given).
fn load_document(file: Option<&PathBuf>, command: &str) -> Result<Document> {
    match file {
        Some(path) if path.exists() && command != "home_new" => {
            Document::open(path).with_context(|| format!("cannot open {}", path.display()))
        }
        Some(path) if command != "home_new" && command != "home_open" => {
            bail!(
                "{} does not exist (create it with `msh --file … home new`)",
                path.display()
            )
        }
        _ => Ok(Document::default()),
    }
}

fn run_registry_command(
    registry: &Registry,
    global: &ArgMatches,
    name: &str,
    m: &ArgMatches,
) -> Result<()> {
    let spec = registry
        .get(name)
        .ok_or_else(|| anyhow!("unknown command '{name}'"))?;
    let params = params_from_matches(&spec.params_schema, m)?;
    if global.get_flag("live") {
        // The running app executes the command; its window shows the change
        let result = msh_ipc::Client::connect()?.execute(name, params)?;
        return print_result(result, global.get_one::<PathBuf>("out"));
    }
    let file = global.get_one::<PathBuf>("home_file");
    let mut doc = load_document(file, name)?;
    if name == "home_new" {
        doc.path = file.cloned();
    }
    let result = registry.execute(&mut doc, name, params)?;
    if (spec.modifies || name == "home_new")
        && !global.get_flag("dry_run")
        && let Some(path) = file
    {
        doc.save(Some(path))?;
    }
    print_result(result, global.get_one::<PathBuf>("out"))
}

/// Prints a command result; images are written to `--out`.
fn print_result(mut result: Value, out: Option<&PathBuf>) -> Result<()> {
    use base64::Engine;
    if let Some(b64) = result.get("image_base64").and_then(Value::as_str) {
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64)?;
        match out {
            Some(path) => {
                std::fs::write(path, &bytes)?;
                result = json!({ "written": path, "bytes": bytes.len() });
            }
            None => {
                result["image_base64"] =
                    json!(format!("<{} bytes, use --out to save>", bytes.len()));
            }
        }
    } else if let (Some(svg), Some(path)) = (result.get("svg").and_then(Value::as_str), out) {
        std::fs::write(path, svg)?;
        result = json!({ "written": path });
    }
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

/// `msh exec`: runs JSON commands from stdin on one document and saves once.
fn exec(registry: &Registry, global: &ArgMatches) -> Result<()> {
    if global.get_flag("live") {
        return exec_live();
    }
    let file = global.get_one::<PathBuf>("home_file");
    let mut doc: Option<Document> = None;
    let mut modified = false;
    let stdin = std::io::stdin();
    for (n, line) in stdin.lock().lines().enumerate() {
        let line = line?;
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let req: Value =
            serde_json::from_str(&line).with_context(|| format!("line {}: invalid JSON", n + 1))?;
        let name = req["command"]
            .as_str()
            .ok_or_else(|| anyhow!("line {}: missing \"command\"", n + 1))?;
        let d = match &mut doc {
            Some(d) => d,
            None => {
                let mut d = load_document(file, name)?;
                if name == "home_new" {
                    d.path = file.cloned();
                }
                doc.insert(d)
            }
        };
        match registry.execute(d, name, req["params"].clone()) {
            Ok(v) => {
                modified |= registry.get(name).is_some_and(|s| s.modifies) || name == "home_new";
                println!(
                    "{}",
                    json!({ "ok": true, "command": name, "result": strip_image(v) })
                );
            }
            Err(e) => {
                println!(
                    "{}",
                    json!({ "ok": false, "command": name, "error": e.to_string() })
                );
                bail!("line {}: {e}", n + 1);
            }
        }
    }
    if let (Some(d), Some(path), true) = (&mut doc, file, modified)
        && !global.get_flag("dry_run")
    {
        d.save(Some(path))?;
    }
    Ok(())
}

/// `msh --live exec`: forwards JSON commands from stdin to the running app.
fn exec_live() -> Result<()> {
    let mut client = msh_ipc::Client::connect()?;
    for (n, line) in std::io::stdin().lock().lines().enumerate() {
        let line = line?;
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let req: Value =
            serde_json::from_str(&line).with_context(|| format!("line {}: invalid JSON", n + 1))?;
        let name = req["command"]
            .as_str()
            .ok_or_else(|| anyhow!("line {}: missing \"command\"", n + 1))?;
        match client.execute(name, req["params"].clone()) {
            Ok(v) => println!(
                "{}",
                json!({ "ok": true, "command": name, "result": strip_image(v) })
            ),
            Err(e) => {
                println!(
                    "{}",
                    json!({ "ok": false, "command": name, "error": e.to_string() })
                );
                bail!("line {}: {e}", n + 1);
            }
        }
    }
    Ok(())
}

fn strip_image(mut v: Value) -> Value {
    if v.get("image_base64").is_some() {
        v["image_base64"] = json!("<omitted>");
    }
    v
}

/// Opens a `.sh3d` file or a standalone `Home.xml` (fixed commands).
fn open_file(path: &Path) -> Result<Sh3dDocument> {
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
