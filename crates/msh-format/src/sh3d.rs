//! Reading and writing `.sh3d` files (ZIP).
//!
//! Layout of a file saved by Sweet Home 3D 7.x:
//! - `Home`: Java-serialized project (neither read nor written by us)
//! - `Home.xml`: the same project as XML (since version 5.3)
//! - `ContentDigests`: SHA-1 digests of the resources (manifest format)
//! - `0`, `1/model.obj`, …: models, icons and textures, referenced by these
//!   names in `Home.xml`
//!
//! We write `Home.xml` + resources, without the `Home` entry.

use crate::limits::SizeBudget;
use crate::{FormatError, home_xml, xml};
use msh_model::Home;
use std::io::{Read, Seek, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const HOME_ENTRY: &str = "Home";
const HOME_XML_ENTRY: &str = "Home.xml";
const DIGESTS_ENTRY: &str = "ContentDigests";

/// A resource (model, icon, texture) inside a `.sh3d` file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentEntry {
    /// Name of the ZIP entry, e.g. `3` or `1/puerta.obj`
    pub name: String,
    pub data: Vec<u8>,
}

/// An opened project including its resources.
#[derive(Debug, Clone, PartialEq)]
pub struct Sh3dDocument {
    pub home: Home,
    /// Resources in the order of the original file
    pub contents: Vec<ContentEntry>,
    /// Content of `ContentDigests`, kept unchanged
    pub content_digests: Option<Vec<u8>>,
    /// `true` if the source file had a Java-serialized `Home` entry
    pub source_had_serialized_home: bool,
}

impl Sh3dDocument {
    /// New document for a project without resources.
    pub fn new(home: Home) -> Self {
        Self {
            home,
            contents: Vec::new(),
            content_digests: None,
            source_had_serialized_home: false,
        }
    }

    pub fn content(&self, name: &str) -> Option<&ContentEntry> {
        self.contents.iter().find(|c| c.name == name)
    }

    /// Opens a `.sh3d` file.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, FormatError> {
        let file = std::fs::File::open(path.as_ref())?;
        Self::read(std::io::BufReader::new(file))
    }

    /// Reads a `.sh3d` file from any reader.
    pub fn read<R: Read + Seek>(reader: R) -> Result<Self, FormatError> {
        let mut zip = ZipArchive::new(reader).map_err(zip_err)?;
        let mut home_xml: Option<Vec<u8>> = None;
        let mut contents = Vec::new();
        let mut content_digests = None;
        let mut had_serialized = false;
        let mut budget = SizeBudget::default();

        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(zip_err)?;
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().map_err(zip_err)?.into_owned();
            if name == HOME_ENTRY {
                had_serialized = true;
                continue;
            }
            let declared = entry.size();
            let data = budget.read_entry(&mut entry, declared)?;
            match name.as_str() {
                HOME_XML_ENTRY => home_xml = Some(data),
                DIGESTS_ENTRY => content_digests = Some(data),
                _ => contents.push(ContentEntry { name, data }),
            }
        }

        let home_xml = home_xml.ok_or(if had_serialized {
            FormatError::OnlySerializedHome
        } else {
            FormatError::Structure("no Home.xml entry in the file".into())
        })?;

        Ok(Self {
            home: read_home_xml(&home_xml)?,
            contents,
            content_digests,
            source_had_serialized_home: had_serialized,
        })
    }

    /// Saves the document. It is written to a temporary file first, flushed to disk and
    /// then renamed, so the old file survives if writing fails.
    pub fn save(&self, path: impl AsRef<Path>) -> Result<(), FormatError> {
        let path = path.as_ref();
        let tmp = path.with_extension("sh3d.tmp");
        let written = std::fs::File::create(&tmp)
            .map_err(FormatError::from)
            .and_then(|file| self.write(std::io::BufWriter::new(file)))
            .and_then(|writer| writer.into_inner().map_err(|e| e.into_error().into()))
            .and_then(|file| file.sync_all().map_err(FormatError::from));
        written
            .and_then(|()| std::fs::rename(&tmp, path).map_err(FormatError::from))
            .inspect_err(|_| {
                let _ = std::fs::remove_file(&tmp);
            })
    }

    /// Writes the document as `.sh3d` to a writer.
    pub fn write<W: Write + Seek>(&self, writer: W) -> Result<W, FormatError> {
        let mut zip = ZipWriter::new(writer);
        let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

        zip.start_file(HOME_XML_ENTRY, deflate).map_err(zip_err)?;
        zip.write_all(write_home_xml(&self.home).as_bytes())?;

        if let Some(d) = &self.content_digests {
            zip.start_file(DIGESTS_ENTRY, deflate).map_err(zip_err)?;
            zip.write_all(d)?;
        }

        let mut dirs_written = std::collections::HashSet::new();
        for c in &self.contents {
            if let Some((dir, _)) = c.name.split_once('/')
                && dirs_written.insert(dir.to_owned())
            {
                zip.add_directory(format!("{dir}/"), stored)
                    .map_err(zip_err)?;
            }
            // Do not compress formats that are already compressed
            let opts = if is_compressed_format(&c.name, &c.data) {
                stored
            } else {
                deflate
            };
            zip.start_file(&c.name, opts).map_err(zip_err)?;
            zip.write_all(&c.data)?;
        }
        zip.finish().map_err(zip_err)
    }
}

fn is_compressed_format(name: &str, data: &[u8]) -> bool {
    let lower = name.to_ascii_lowercase();
    let by_ext = [
        ".jpg", ".jpeg", ".png", ".gif", ".zip", ".glb", ".ktx2", ".webp",
    ]
    .iter()
    .any(|e| lower.ends_with(e));
    // Detect resources without extension (e.g. "0") by their header: PNG, JPEG, GIF
    by_ext
        || data.starts_with(&[0x89, b'P', b'N', b'G'])
        || data.starts_with(&[0xFF, 0xD8, 0xFF])
        || data.starts_with(b"GIF8")
}

fn zip_err(e: zip::result::ZipError) -> FormatError {
    FormatError::Zip(e.to_string())
}

/// Reads a `Home.xml` document.
pub fn read_home_xml(bytes: &[u8]) -> Result<Home, FormatError> {
    home_xml::read_home(xml::parse(bytes)?)
}

/// Creates a `Home.xml` document.
pub fn write_home_xml(home: &Home) -> String {
    xml::write_document(&home_xml::write_home(home))
}
