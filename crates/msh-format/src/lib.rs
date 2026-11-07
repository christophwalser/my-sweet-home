//! Lesen und Schreiben der Dateiformate von Sweet Home 3D.
//!
//! - [`Sh3dDocument`] – `.sh3d`-Projektdatei (ZIP mit `Home.xml` und Ressourcen)
//! - [`read_home_xml`] / [`write_home_xml`]: nur das XML
//!
//! Unbekannte Attribute und Elemente bleiben erhalten, damit Dateien aus
//! neueren Versionen beim Speichern nicht beschädigt werden.

mod home_xml;
mod sh3d;
pub mod xml;

pub use sh3d::{ContentEntry, Sh3dDocument, read_home_xml, write_home_xml};

/// Fehler beim Lesen oder Schreiben.
#[derive(Debug, thiserror::Error)]
pub enum FormatError {
    #[error("E/A-Fehler: {0}")]
    Io(#[from] std::io::Error),
    #[error("ZIP-Fehler: {0}")]
    Zip(String),
    #[error("XML-Fehler: {0}")]
    Xml(String),
    #[error("Element <{element}>: {source}")]
    Attr {
        element: String,
        source: msh_model::AttrError,
    },
    #[error("Ungültiger Aufbau: {0}")]
    Structure(String),
    #[error(
        "Die Datei enthält nur das alte Java-Format (Sweet Home 3D vor 5.3). \
         Bitte einmal mit Sweet Home 3D öffnen und neu speichern."
    )]
    OnlySerializedHome,
}
