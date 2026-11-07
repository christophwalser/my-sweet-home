//! Lesen und Schreiben von `.sh3d`-Dateien (ZIP).
//!
//! Aufbau einer von Sweet Home 3D 7.x gespeicherten Datei:
//! - `Home`: Java-serialisiertes Projekt (wird von uns nicht gelesen/geschrieben)
//! - `Home.xml`: dasselbe Projekt als XML (seit Version 5.3)
//! - `ContentDigests`: SHA-1 der Ressourcen (Manifest-Format)
//! - `0`, `1/modell.obj`, …: Modelle, Icons und Texturen, in `Home.xml`
//!   über diese Namen referenziert
//!
//! Wir schreiben `Home.xml` + Ressourcen, ohne den `Home`-Eintrag.

use crate::{FormatError, home_xml, xml};
use msh_model::Home;
use std::io::{Read, Seek, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const HOME_ENTRY: &str = "Home";
const HOME_XML_ENTRY: &str = "Home.xml";
const DIGESTS_ENTRY: &str = "ContentDigests";

/// Eine Ressource (Modell, Icon, Textur) innerhalb einer `.sh3d`-Datei.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentEntry {
    /// Name des ZIP-Eintrags, z. B. `3` oder `1/puerta.obj`
    pub name: String,
    pub data: Vec<u8>,
}

/// Ein geöffnetes Projekt samt Ressourcen.
#[derive(Debug, Clone, PartialEq)]
pub struct Sh3dDocument {
    pub home: Home,
    /// Ressourcen in der Reihenfolge der Originaldatei
    pub contents: Vec<ContentEntry>,
    /// Inhalt von `ContentDigests`, unverändert übernommen
    pub content_digests: Option<Vec<u8>>,
    /// `true`, wenn die Quelldatei einen Java-serialisierten `Home`-Eintrag hatte
    pub source_had_serialized_home: bool,
}

impl Sh3dDocument {
    /// Neues, leeres Dokument für ein Projekt ohne Ressourcen.
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

    /// Öffnet eine `.sh3d`-Datei.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, FormatError> {
        let file = std::fs::File::open(path.as_ref())?;
        Self::read(std::io::BufReader::new(file))
    }

    /// Liest eine `.sh3d`-Datei aus einem beliebigen Reader.
    pub fn read<R: Read + Seek>(reader: R) -> Result<Self, FormatError> {
        let mut zip = ZipArchive::new(reader).map_err(zip_err)?;
        let mut home_xml: Option<Vec<u8>> = None;
        let mut contents = Vec::new();
        let mut content_digests = None;
        let mut had_serialized = false;

        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(zip_err)?;
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().to_owned();
            if name == HOME_ENTRY {
                had_serialized = true;
                continue;
            }
            let mut data = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut data)?;
            match name.as_str() {
                HOME_XML_ENTRY => home_xml = Some(data),
                DIGESTS_ENTRY => content_digests = Some(data),
                _ => contents.push(ContentEntry { name, data }),
            }
        }

        let home_xml = home_xml.ok_or(if had_serialized {
            FormatError::OnlySerializedHome
        } else {
            FormatError::Structure("keine Home.xml in der Datei".into())
        })?;

        Ok(Self {
            home: read_home_xml(&home_xml)?,
            contents,
            content_digests,
            source_had_serialized_home: had_serialized,
        })
    }

    /// Speichert das Dokument. Es wird zuerst in eine temporäre Datei
    /// geschrieben und dann umbenannt, damit bei einem Fehler die alte Datei
    /// erhalten bleibt.
    pub fn save(&self, path: impl AsRef<Path>) -> Result<(), FormatError> {
        let path = path.as_ref();
        let tmp = path.with_extension("sh3d.tmp");
        {
            let file = std::fs::File::create(&tmp)?;
            self.write(std::io::BufWriter::new(file))?;
        }
        std::fs::rename(&tmp, path).inspect_err(|_| {
            let _ = std::fs::remove_file(&tmp);
        })?;
        Ok(())
    }

    /// Schreibt das Dokument als `.sh3d` in einen Writer.
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
            // Bereits komprimierte Formate nicht nochmals komprimieren
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
    // Ressourcen ohne Endung (z. B. "0") am Dateikopf erkennen: PNG, JPEG, GIF
    by_ext
        || data.starts_with(&[0x89, b'P', b'N', b'G'])
        || data.starts_with(&[0xFF, 0xD8, 0xFF])
        || data.starts_with(b"GIF8")
}

fn zip_err(e: zip::result::ZipError) -> FormatError {
    FormatError::Zip(e.to_string())
}

/// Liest ein `Home.xml`-Dokument.
pub fn read_home_xml(bytes: &[u8]) -> Result<Home, FormatError> {
    home_xml::read_home(xml::parse(bytes)?)
}

/// Erzeugt ein `Home.xml`-Dokument.
pub fn write_home_xml(home: &Home) -> String {
    xml::write_document(&home_xml::write_home(home))
}
