//! Autosave and recovery, like Sweet Home 3D's "auto recovery".
//!
//! Every few minutes a copy of each home changed since its last save is written to the
//! recovery folder (`%APPDATA%\ch.mysweethome.app\recovery`): `<key>.sh3d` with
//! `<key>.json` (name and path of the home). Saving or closing a home removes its copy.
//! Copies left after a crash are offered for recovery when the app starts again.

use crate::state::AppState;
use msh_core::Document;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

/// Time between two autosaves.
const INTERVAL: Duration = Duration::from_secs(5 * 60);

/// A recovered copy of an unsaved home.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryInfo {
    pub key: String,
    /// Name of the home
    pub name: Option<String>,
    /// File the home was opened from or saved to, if any
    pub path: Option<PathBuf>,
    /// Time of the copy (seconds since 1970)
    pub saved_at: u64,
}

fn recovery_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("recovery"))
}

/// Writes copies of the homes changed since their last save or autosave.
pub fn start<R: Runtime>(app: AppHandle<R>) {
    // MSH_AUTOSAVE_SECONDS shortens the interval (for tests)
    let interval = std::env::var("MSH_AUTOSAVE_SECONDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .map_or(INTERVAL, Duration::from_secs);
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(interval);
            save_all(&app);
        }
    });
}

/// Writes a recovery copy of every changed home now.
pub fn save_all<R: Runtime>(app: &AppHandle<R>) {
    let Some(dir) = recovery_dir(app) else {
        return;
    };
    let state = app.state::<AppState>();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    // Copies are taken under the lock and written outside it
    let jobs = state
        .with_docs(|docs| {
            docs.values_mut()
                .filter(|d| d.doc.modified && d.revision != d.autosaved)
                .map(|d| {
                    d.autosaved = d.revision;
                    let info = RecoveryInfo {
                        key: d.recovery_key.clone(),
                        name: d.doc.home().attrs.name.clone(),
                        path: d.doc.path.clone(),
                        saved_at: now,
                    };
                    (info, d.doc.recovery_copy())
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if jobs.is_empty() || std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    for (info, file) in jobs {
        let home = dir.join(format!("{}.sh3d", info.key));
        if let Err(e) = file.save(&home) {
            eprintln!("autosave of {} failed: {e}", home.display());
            continue;
        }
        if let Ok(json) = serde_json::to_vec_pretty(&info) {
            let _ = std::fs::write(dir.join(format!("{}.json", info.key)), json);
        }
    }
}

/// Removes the recovery copy of a home (saved or closed).
pub fn remove_recovery<R: Runtime>(app: &AppHandle<R>, key: &str) {
    if let Some(dir) = recovery_dir(app) {
        let _ = std::fs::remove_file(dir.join(format!("{key}.sh3d")));
        let _ = std::fs::remove_file(dir.join(format!("{key}.json")));
    }
}

/// Recovery copies left by an earlier session (not the ones of homes open now).
pub fn list<R: Runtime>(app: &AppHandle<R>) -> Vec<RecoveryInfo> {
    let Some(dir) = recovery_dir(app) else {
        return Vec::new();
    };
    let open: Vec<String> = app
        .state::<AppState>()
        .with_docs(|docs| docs.values().map(|d| d.recovery_key.clone()).collect())
        .unwrap_or_default();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut found: Vec<RecoveryInfo> = entries
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_slice::<RecoveryInfo>(&std::fs::read(e.path()).ok()?).ok())
        .filter(|i| !open.contains(&i.key) && dir.join(format!("{}.sh3d", i.key)).is_file())
        .collect();
    found.sort_by_key(|a| std::cmp::Reverse(a.saved_at));
    found
}

/// Opens a recovery copy: the home keeps its original path and is marked as changed.
pub fn open<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<Document, String> {
    let dir = recovery_dir(app).ok_or("no recovery folder")?;
    let info: RecoveryInfo = serde_json::from_slice(
        &std::fs::read(dir.join(format!("{key}.json"))).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let mut doc = Document::open(&dir.join(format!("{key}.sh3d"))).map_err(|e| e.to_string())?;
    doc.path = info.path;
    doc.modified = true;
    Ok(doc)
}
