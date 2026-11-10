//! Helpers shared by the command tests (`mod common;` in a test file).
#![allow(dead_code)]

use std::path::PathBuf;

use msh_core::{Document, Registry};
use serde_json::{Value, json};

/// Runs a command and panics with its error if it fails.
pub fn run(r: &Registry, doc: &mut Document, name: &str, params: Value) -> Value {
    r.execute(doc, name, params)
        .unwrap_or_else(|e| panic!("{name} failed: {e}"))
}

/// Runs a command that must fail; checks that the home and the undo stack stay unchanged.
pub fn run_err(r: &Registry, doc: &mut Document, name: &str, params: Value) -> String {
    let before = serde_json::to_string(doc.home()).unwrap();
    let could_undo = doc.can_undo();
    let err = match r.execute(doc, name, params) {
        Ok(v) => panic!("{name} should fail, returned {v}"),
        Err(e) => e.to_string(),
    };
    assert_eq!(
        serde_json::to_string(doc.home()).unwrap(),
        before,
        "{name} changed the home although it failed"
    );
    assert_eq!(doc.can_undo(), could_undo, "{name} left an undo step");
    err
}

/// A new empty home.
pub fn new_doc(r: &Registry) -> Document {
    let mut doc = Document::default();
    run(r, &mut doc, "home_new", json!({ "name": "Test" }));
    doc
}

/// Serialized home, to compare states before and after undo.
pub fn snapshot(doc: &Document) -> String {
    serde_json::to_string(doc.home()).unwrap()
}

/// Undo restores `before`, redo restores `after`.
pub fn check_undo_redo(r: &Registry, doc: &mut Document, before: &str, after: &str) {
    run(r, doc, "edit_undo", json!({}));
    assert_eq!(snapshot(doc), before, "undo did not restore the home");
    run(r, doc, "edit_redo", json!({}));
    assert_eq!(snapshot(doc), after, "redo did not restore the home");
}

/// A fresh directory for files of one test.
pub fn out_dir(test: &str) -> PathBuf {
    let dir = std::env::temp_dir()
        .join("msh-tests")
        .join(format!("{test}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Saves the home with `home_save` and opens the file again.
pub fn save_and_reopen(r: &Registry, doc: &mut Document, test: &str) -> Document {
    let path = out_dir(test).join("home.sh3d");
    run(r, doc, "home_save", json!({ "path": path }));
    Document::open(&path).unwrap()
}

/// Ids from a result field holding an array of strings.
pub fn ids(v: &Value, field: &str) -> Vec<String> {
    serde_json::from_value(v[field].clone()).unwrap_or_else(|_| panic!("no {field} in {v}"))
}

pub fn close(a: f32, b: f32) -> bool {
    (a - b).abs() < 0.01
}

/// Runs the calling test again in a child process of the test binary whose user library
/// folders (APPDATA), catalog settings and program folders point at a fresh temporary folder,
/// so catalog and library tests neither read nor change the user's libraries. The default
/// catalog of a Microsoft Store installation of Sweet Home 3D is still found (read-only), so
/// give imported items distinctive names. Returns `None` in the parent (after the child
/// passed) and the temporary folder in the child:
///
/// `let Some(root) = common::isolated_catalog("test_fn_name") else { return };`
pub fn isolated_catalog(test: &str) -> Option<PathBuf> {
    const CHILD: &str = "MSH_TEST_ISOLATED_CHILD";
    if std::env::var_os(CHILD).is_some_and(|t| t == test) {
        let root = PathBuf::from(std::env::var_os("APPDATA").unwrap());
        // Tells the parent that the test really ran
        std::fs::write(root.join("child-ran"), "").unwrap();
        return Some(root);
    }
    let root = out_dir(&format!("isolated-{test}"));
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([test, "--exact", "--include-ignored", "--nocapture"])
        .env(CHILD, test)
        .env("APPDATA", &root)
        .env("MSH_CATALOG_SETTINGS", root.join("catalog.json"))
        .env("MSH_CATALOG_DIR", root.join("no-bundled-catalog"))
        .env("ProgramFiles", &root)
        .env("ProgramFiles(x86)", &root)
        .output()
        .unwrap();
    let ran = root.join("child-ran").exists();
    let _ = std::fs::remove_dir_all(&root);
    if !output.status.success() {
        println!("{}", String::from_utf8_lossy(&output.stdout));
        eprintln!("{}", String::from_utf8_lossy(&output.stderr));
    }
    assert!(
        output.status.success(),
        "{test} failed in its child process (see its output above)"
    );
    assert!(ran, "{test} did not run in its child process");
    None
}

/// A PNG of `width` x `height` pixels in one color.
pub fn png_bytes(width: u32, height: u32) -> Vec<u8> {
    let img = image::RgbImage::from_pixel(width, height, image::Rgb([200, 120, 40]));
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

/// Writes an OBJ box from (0, 0, 0) to `size` (x = width, y = height, z = depth in the
/// model's units) to `dir/name` and returns its path.
pub fn write_box_obj(dir: &std::path::Path, name: &str, size: [f32; 3]) -> PathBuf {
    let [x, y, z] = size;
    let mut obj = String::new();
    for (vx, vy, vz) in [
        (0.0, 0.0, 0.0),
        (x, 0.0, 0.0),
        (x, y, 0.0),
        (0.0, y, 0.0),
        (0.0, 0.0, z),
        (x, 0.0, z),
        (x, y, z),
        (0.0, y, z),
    ] {
        obj.push_str(&format!("v {vx} {vy} {vz}\n"));
    }
    obj.push_str("f 1 2 3 4\nf 5 6 7 8\nf 1 2 6 5\nf 4 3 7 8\nf 1 4 8 5\nf 2 3 7 6\n");
    let path = dir.join(name);
    std::fs::write(&path, obj).unwrap();
    path
}
