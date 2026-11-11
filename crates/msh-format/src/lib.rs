//! Reading and writing the file formats of Sweet Home 3D.
//!
//! - [`Sh3dDocument`] – `.sh3d` project file (ZIP with `Home.xml` and resources)
//! - [`read_home_xml`] / [`write_home_xml`]: the XML only
//!
//! Unknown attributes and elements are preserved, so that files from newer
//! versions are not damaged when saved.

mod home_xml;
pub mod limits;
mod sh3d;
pub mod xml;

pub use sh3d::{ContentEntry, Sh3dDocument, read_home_xml, write_home_xml};

/// Error while reading or writing.
#[derive(Debug, thiserror::Error)]
pub enum FormatError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("ZIP error: {0}")]
    Zip(String),
    #[error("XML error: {0}")]
    Xml(String),
    #[error("element <{element}>: {source}")]
    Attr {
        element: String,
        source: msh_model::AttrError,
    },
    #[error("invalid structure: {0}")]
    Structure(String),
    #[error(
        "the file only contains the legacy Java format (Sweet Home 3D before 5.3); \
         open it once in Sweet Home 3D and save it again"
    )]
    OnlySerializedHome,
}
