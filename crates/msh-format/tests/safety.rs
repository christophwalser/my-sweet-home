//! Saving writes complete files; crafted archives cannot exhaust memory.

use msh_format::{ContentEntry, Sh3dDocument, limits};
use msh_model::Home;
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;

fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("msh-format-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn save_writes_the_complete_archive() {
    let mut doc = Sh3dDocument::new(Home::default());
    doc.contents.push(ContentEntry {
        name: "0".into(),
        data: (0..200_000u32).flat_map(|i| i.to_le_bytes()).collect(),
    });
    let expected = doc.write(Cursor::new(Vec::new())).unwrap().into_inner();

    let dir = temp_dir("save");
    let path = dir.join("home.sh3d");
    doc.save(&path).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), expected);
    assert!(!path.with_extension("sh3d.tmp").exists());
    assert_eq!(Sh3dDocument::open(&path).unwrap().contents, doc.contents);
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn failed_save_keeps_the_old_file() {
    let dir = temp_dir("keep");
    let path = dir.join("home.sh3d");
    std::fs::write(&path, b"old").unwrap();
    // A folder in place of the temporary file makes writing fail
    std::fs::create_dir_all(path.with_extension("sh3d.tmp")).unwrap();
    assert!(Sh3dDocument::new(Home::default()).save(&path).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"old");
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn entries_beyond_the_size_limit_are_rejected() {
    // Highly compressible data: a small file that unpacks to more than the entry limit
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let deflate = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);
    zip.start_file("Home.xml", deflate).unwrap();
    zip.write_all(b"<home/>").unwrap();
    zip.start_file("0", deflate).unwrap();
    let chunk = vec![0u8; 1024 * 1024];
    for _ in 0..=(limits::MAX_ENTRY_SIZE / chunk.len() as u64) {
        zip.write_all(&chunk).unwrap();
    }
    let bytes = zip.finish().unwrap().into_inner();
    assert!(bytes.len() < 4 * 1024 * 1024);

    let err = Sh3dDocument::read(Cursor::new(bytes)).unwrap_err();
    assert!(err.to_string().contains("more data than allowed"), "{err}");
}
