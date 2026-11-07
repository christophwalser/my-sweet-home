use msh_core::AppInfo;

/// Liefert Name und Version an das Frontend.
#[tauri::command]
fn app_info() -> AppInfo {
    msh_core::app_info()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_info])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der Tauri-Anwendung");
}
