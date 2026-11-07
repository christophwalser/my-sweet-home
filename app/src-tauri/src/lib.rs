use msh_core::AppInfo;

/// Returns the application name and version to the frontend.
#[tauri::command]
fn app_info() -> AppInfo {
    msh_core::app_info()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_info])
        .run(tauri::generate_context!())
        .expect("error while running the Tauri application");
}
