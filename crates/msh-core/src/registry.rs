//! Command registry: the single source of all actions.
//!
//! The UI, the CLI and the MCP server never change a home directly; they look
//! up a command here by name and execute it with JSON parameters. The
//! parameter schema (JSON Schema, generated with `schemars`) is used to build
//! CLI arguments and MCP tool definitions.

use crate::document::Document;
use schemars::JsonSchema;
use serde::de::DeserializeOwned;
use serde_json::Value;

/// Error of a command, shown to the user or returned to the AI agent.
#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("unknown command '{0}'")]
    Unknown(String),
    #[error("invalid parameters for '{command}': {message}")]
    InvalidParams { command: String, message: String },
    #[error("{0}")]
    Failed(String),
}

impl CommandError {
    pub fn failed(msg: impl Into<String>) -> Self {
        Self::Failed(msg.into())
    }
}

pub type CommandResult = Result<Value, CommandError>;

type Handler = Box<dyn Fn(&mut Document, Value) -> CommandResult + Send + Sync>;

/// Description of a command.
pub struct CommandSpec {
    /// Name in the form `group_action`, e.g. `wall_add`
    pub name: &'static str,
    pub description: &'static str,
    /// `true` if the command changes the home (creates an undo step, unless `undo` is false)
    pub modifies: bool,
    /// `false` for changes of the view stored in the home (cameras) that are not undone
    pub undo: bool,
    /// JSON Schema of the parameters (always an object schema)
    pub params_schema: Value,
    handler: Handler,
}

impl CommandSpec {
    /// Group and action, e.g. `("wall", "add")`.
    pub fn group_action(&self) -> (&'static str, &'static str) {
        self.name.split_once('_').unwrap_or((self.name, ""))
    }
}

/// All available commands.
#[derive(Default)]
pub struct Registry {
    commands: Vec<CommandSpec>,
}

impl Registry {
    /// Registry with all standard commands.
    pub fn standard() -> Self {
        let mut r = Self::default();
        crate::commands::register_all(&mut r);
        r
    }

    /// Registers a command with typed parameters.
    pub fn add<P, F>(&mut self, name: &'static str, description: &'static str, modifies: bool, f: F)
    where
        P: DeserializeOwned + JsonSchema,
        F: Fn(&mut Document, P) -> CommandResult + Send + Sync + 'static,
    {
        self.add_spec(name, description, modifies, modifies, f);
    }

    /// Registers a command that changes only the view stored in the home (e.g. the
    /// cameras): the home is saved and the UI updated, but no undo step is created and
    /// the home is not marked as modified. The handler must validate before changing.
    pub fn add_view<P, F>(&mut self, name: &'static str, description: &'static str, f: F)
    where
        P: DeserializeOwned + JsonSchema,
        F: Fn(&mut Document, P) -> CommandResult + Send + Sync + 'static,
    {
        self.add_spec(name, description, true, false, f);
    }

    fn add_spec<P, F>(
        &mut self,
        name: &'static str,
        description: &'static str,
        modifies: bool,
        undo: bool,
        f: F,
    ) where
        P: DeserializeOwned + JsonSchema,
        F: Fn(&mut Document, P) -> CommandResult + Send + Sync + 'static,
    {
        let schema = serde_json::to_value(schemars::schema_for!(P)).unwrap_or_default();
        let handler: Handler = Box::new(move |doc, params| {
            let params = if params.is_null() {
                Value::Object(Default::default())
            } else {
                params
            };
            let p: P = serde_json::from_value(params).map_err(|e| CommandError::InvalidParams {
                command: name.to_owned(),
                message: e.to_string(),
            })?;
            f(doc, p)
        });
        self.commands.push(CommandSpec {
            name,
            description,
            modifies,
            undo,
            params_schema: schema,
            handler,
        });
    }

    pub fn list(&self) -> &[CommandSpec] {
        &self.commands
    }

    pub fn get(&self, name: &str) -> Option<&CommandSpec> {
        self.commands.iter().find(|c| c.name == name)
    }

    /// Executes a command. Modifying commands create an undo step; if they
    /// fail, the home is restored to its previous state.
    pub fn execute(&self, doc: &mut Document, name: &str, params: Value) -> CommandResult {
        let spec = self
            .get(name)
            .ok_or_else(|| CommandError::Unknown(name.to_owned()))?;
        if !spec.modifies || !spec.undo {
            return (spec.handler)(doc, params);
        }
        doc.checkpoint(name);
        match (spec.handler)(doc, params) {
            Ok(v) => {
                doc.commit_checkpoint();
                doc.modified = true;
                Ok(v)
            }
            Err(e) => {
                if let Some(previous) = doc.discard_checkpoint() {
                    *doc.home_mut() = previous;
                }
                Err(e)
            }
        }
    }
}
