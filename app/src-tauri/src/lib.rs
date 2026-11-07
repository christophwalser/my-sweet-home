mod commands;
mod pipe;
mod resources;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .register_asynchronous_uri_scheme_protocol("msh", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                responder.respond(resources::handle(&app, &request));
            });
        })
        // Closing the main window ends the app, also when the 3D window is open
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                tauri::Manager::app_handle(window).exit(0);
            }
        })
        .setup(|app| {
            pipe::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::startup_file,
            commands::current_home,
            commands::open_home,
            commands::execute,
            commands::capture_result,
            commands::catalog_load,
            commands::model_stage,
            commands::write_obj_files,
            commands::export_obj,
            commands::capture_3d_image,
            commands::save_image,
            commands::save_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Tauri application");
}
