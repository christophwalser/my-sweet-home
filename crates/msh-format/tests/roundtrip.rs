//! Round-trip tests: read → write → read, then compare element by element.

use msh_format::{Sh3dDocument, read_home_xml, write_home_xml, xml};
use msh_model::{RawElement, RawNode};
use std::path::{Path, PathBuf};

fn corpus(sub: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/corpus")
        .join(sub)
}

fn files(sub: &str, ext: &str) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(corpus(sub)) else {
        return Vec::new();
    };
    let mut v: Vec<PathBuf> = rd
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext)))
        .collect();
    v.sort();
    v
}

/// Compares two XML trees semantically: same elements in the same order, same
/// attribute sets (order ignored, numbers compared numerically), same text.
/// Whitespace between elements is ignored.
fn assert_same_tree(a: &RawElement, b: &RawElement, path: &str) {
    let here = format!("{path}/{}", a.name);
    assert_eq!(a.name, b.name, "element name at {here}");

    let mut aa: Vec<_> = a.attrs.iter().collect();
    let mut ba: Vec<_> = b.attrs.iter().collect();
    aa.sort();
    ba.sort();
    let a_names: Vec<&str> = aa.iter().map(|(n, _)| *n).collect();
    let b_names: Vec<&str> = ba.iter().map(|(n, _)| *n).collect();
    assert_eq!(a_names, b_names, "attribute names at {here}");
    for ((n, va), (_, vb)) in aa.iter().zip(&ba) {
        assert!(
            same_value(va, vb),
            "attribute {here}@{n}: '{va}' vs. '{vb}'"
        );
    }

    let ae: Vec<&RawElement> = child_elements(a);
    let be: Vec<&RawElement> = child_elements(b);
    let an: Vec<&str> = ae.iter().map(|e| e.name.as_str()).collect();
    let bn: Vec<&str> = be.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(an, bn, "child elements at {here}");
    for (x, y) in ae.iter().zip(&be) {
        assert_same_tree(x, y, &here);
    }
    assert_eq!(text(a), text(b), "text at {here}");
}

fn child_elements(e: &RawElement) -> Vec<&RawElement> {
    e.children
        .iter()
        .filter_map(|c| match c {
            RawNode::Element(e) => Some(e),
            RawNode::Text(_) => None,
        })
        .collect()
}

fn text(e: &RawElement) -> String {
    if !child_elements(e).is_empty() {
        return String::new();
    }
    e.children
        .iter()
        .filter_map(|c| match c {
            RawNode::Text(t) => Some(t.as_str()),
            RawNode::Element(_) => None,
        })
        .collect()
}

fn same_value(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    match (a.parse::<f32>(), b.parse::<f32>()) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

fn check_xml_roundtrip(bytes: &[u8], label: &str) {
    let original = xml::parse(bytes).unwrap_or_else(|e| panic!("{label}: invalid XML: {e}"));
    let home = read_home_xml(bytes).unwrap_or_else(|e| panic!("{label}: not readable: {e}"));
    let written = write_home_xml(&home);
    let reparsed_tree = xml::parse(written.as_bytes()).expect("written XML is invalid");
    assert_same_tree(&original, &reparsed_tree, label);
    let home2 = read_home_xml(written.as_bytes()).expect("written XML is not readable");
    assert_eq!(home, home2, "{label}: model differs after round trip");
}

#[test]
fn example_projects_roundtrip() {
    let files = files("examples", "xml");
    assert!(
        files.len() >= 9,
        "example projects missing in tests/corpus/examples"
    );
    for f in files {
        let bytes = std::fs::read(&f).unwrap();
        check_xml_roundtrip(&bytes, &f.display().to_string());
    }
}

#[test]
fn example_projects_have_content() {
    let bytes = std::fs::read(corpus("examples").join("4BedroomHouse.xml")).unwrap();
    let home = read_home_xml(&bytes).unwrap();
    assert!(!home.walls.is_empty());
    assert!(!home.rooms.is_empty());
    assert!(home.piece_count() > 10);
    assert!(home.rooms.iter().any(|r| r.area() > 0.0));
}

/// Every attribute and element of the corpus must end up in a typed field.
/// Otherwise a typo in the model would silently disappear into `extra_*`.
#[test]
fn corpus_has_no_unknown_attributes_or_elements() {
    let mut homes = Vec::new();
    for f in files("examples", "xml") {
        homes.push((
            f.display().to_string(),
            read_home_xml(&std::fs::read(&f).unwrap()).unwrap(),
        ));
    }
    for f in files("private", "sh3d") {
        homes.push((
            f.display().to_string(),
            Sh3dDocument::open(&f).unwrap().home,
        ));
    }
    for (label, home) in homes {
        let json = serde_json::to_value(&home).unwrap();
        let mut found = Vec::new();
        find_extras(&json, "home", &mut found);
        assert!(found.is_empty(), "{label}: unknown data: {found:#?}");
    }
}

fn find_extras(v: &serde_json::Value, path: &str, found: &mut Vec<String>) {
    match v {
        serde_json::Value::Object(m) => {
            for (k, child) in m {
                let p = format!("{path}.{k}");
                if k.starts_with("extra_") && !child.as_array().is_some_and(|a| a.is_empty()) {
                    found.push(format!("{p} = {child}"));
                } else {
                    find_extras(child, &p, found);
                }
            }
        }
        serde_json::Value::Array(a) => {
            for (i, child) in a.iter().enumerate() {
                find_extras(child, &format!("{path}[{i}]"), found);
            }
        }
        _ => {}
    }
}

/// Personal `.sh3d` files from `tests/corpus/private` (not in the repository).
#[test]
fn private_sh3d_roundtrip() {
    for f in files("private", "sh3d") {
        let label = f.display().to_string();
        let doc = Sh3dDocument::open(&f).unwrap_or_else(|e| panic!("{label}: {e}"));

        // XML level
        let raw_xml = {
            let file = std::fs::File::open(&f).unwrap();
            let mut zip = zip_reader(file);
            read_entry(&mut zip, "Home.xml")
        };
        check_xml_roundtrip(&raw_xml, &label);

        // ZIP level: write, read again, everything must be equal
        let buf = doc
            .write(std::io::Cursor::new(Vec::new()))
            .unwrap()
            .into_inner();
        let doc2 = Sh3dDocument::read(std::io::Cursor::new(buf)).unwrap();
        assert_eq!(doc.home, doc2.home, "{label}: model");
        assert_eq!(doc.contents, doc2.contents, "{label}: resources");
        assert_eq!(
            doc.content_digests, doc2.content_digests,
            "{label}: ContentDigests"
        );
        assert!(!doc2.source_had_serialized_home);
    }
}

fn zip_reader(file: std::fs::File) -> zip::ZipArchive<std::fs::File> {
    zip::ZipArchive::new(file).unwrap()
}

fn read_entry(zip: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Vec<u8> {
    use std::io::Read;
    let mut e = zip.by_name(name).unwrap();
    let mut v = Vec::new();
    e.read_to_end(&mut v).unwrap();
    v
}
