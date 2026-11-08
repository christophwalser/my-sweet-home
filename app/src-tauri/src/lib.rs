mod autosave;
mod commands;
mod pipe;
mod resources;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Size, position and maximized state of the windows are remembered
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(AppState::default())
        .register_asynchronous_uri_scheme_protocol("msh", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                responder.respond(resources::handle(&app, &request));
            });
        })
        .on_window_event(|window, event| {
            use tauri::Manager;
            let app = window.app_handle();
            let state = app.state::<AppState>();
            let label = window.label();
            match event {
                // The CLI and the MCP server control the home of the window focused last
                tauri::WindowEvent::Focused(true) => state.set_focused(label),
                tauri::WindowEvent::Destroyed if !label.starts_with(state::VIEW3D_PREFIX) => {
                    // A closed home is gone: its recovery copy and its 3D window too
                    if let Some(key) = state.close_doc(label) {
                        autosave::remove_recovery(app, &key);
                    }
                    if let Some(w) =
                        app.get_webview_window(&format!("{}{label}", state::VIEW3D_PREFIX))
                    {
                        let _ = w.close();
                    }
                    // The app ends with its last home window
                    let homes_left = app
                        .webview_windows()
                        .keys()
                        .any(|l| l != label && !l.starts_with(state::VIEW3D_PREFIX));
                    if !homes_left {
                        app.exit(0);
                    } else if state.focused() == label
                        && let Some(next) = app
                            .webview_windows()
                            .keys()
                            .find(|l| *l != label && !l.starts_with(state::VIEW3D_PREFIX))
                    {
                        state.set_focused(next);
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            pipe::start(app.handle().clone());
            autosave::start(app.handle().clone());
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
            commands::read_file,
            commands::new_window,
            commands::recovery_list,
            commands::startup_recovery,
            commands::recovery_open,
            commands::recovery_discard,
            commands::set_autosave_interval,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Tauri application");
}
