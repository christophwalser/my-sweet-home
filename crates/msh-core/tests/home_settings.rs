//! Home settings through the command registry.

use msh_core::{Document, Registry};
use serde_json::json;

#[test]
fn base_plan_lock_is_set_and_saved() {
    let r = Registry::standard();
    let mut doc = Document::default();
    r.execute(&mut doc, "home_new", json!({})).unwrap();
    r.execute(&mut doc, "home_set", json!({ "base_plan_locked": true }))
        .unwrap();
    assert_eq!(doc.home().attrs.base_plan_locked, Some(true));

    let dir = std::env::temp_dir().join(format!("msh-home-settings-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("locked.sh3d");
    r.execute(&mut doc, "home_save", json!({ "path": path }))
        .unwrap();
    r.execute(&mut doc, "home_open", json!({ "path": path }))
        .unwrap();
    assert_eq!(doc.home().attrs.base_plan_locked, Some(true));

    // Unlocking removes the attribute, as Sweet Home 3D writes it only when locked
    r.execute(&mut doc, "home_set", json!({ "base_plan_locked": false }))
        .unwrap();
    assert_eq!(doc.home().attrs.base_plan_locked, None);
    std::fs::remove_dir_all(&dir).ok();
}
