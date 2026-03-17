use std::net::TcpListener;
use tauri::Manager;

fn find_available_port(preferred: u16) -> u16 {
    if TcpListener::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("Failed to find available port");
    listener.local_addr().unwrap().port()
}

fn wait_for_server(port: u16, timeout_ms: u64) -> bool {
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_millis(timeout_ms);
    while start.elapsed() < timeout {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    false
}

fn fix_path() {
    let extra: Vec<&str> = if cfg!(target_os = "macos") {
        vec!["/usr/local/bin", "/opt/homebrew/bin", "/usr/local/sbin"]
    } else if cfg!(target_os = "linux") {
        vec!["/usr/local/bin"]
    } else {
        vec![]
    };

    if !extra.is_empty() {
        let current = std::env::var("PATH").unwrap_or_default();
        let sep = if cfg!(windows) { ";" } else { ":" };
        let new_path = format!("{}{}{}", current, sep, extra.join(sep));
        unsafe { std::env::set_var("PATH", new_path) };
    }
}

fn get_database_url(_app: &tauri::App) -> String {
    let db_dir = if cfg!(target_os = "macos") {
        dirs::home_dir()
            .expect("Failed to resolve home dir")
            .join("Library/Application Support/KlustrEye")
    } else {
        dirs::config_dir()
            .expect("Failed to resolve config dir")
            .join("KlustrEye")
    };
    std::fs::create_dir_all(&db_dir).ok();
    let db_path = db_dir.join("klustreye.db");
    format!("file:{}", db_path.to_string_lossy().replace('\\', "/"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    fix_path();

    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
                // In dev: frontend + backend already started by beforeDevCommand
                return Ok(());
            }

            let port = find_available_port(3000);
            let database_url = get_database_url(app);

            eprintln!("[tauri] Starting embedded Axum server on port {port}");
            eprintln!("[tauri] Database: {database_url}");

            // Start the embedded Rust/Axum server
            let db_url = database_url.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = backend::start_server(port, &db_url).await {
                    eprintln!("[tauri] Server error: {e}");
                }
            });

            let window = app
                .get_webview_window("main")
                .expect("Failed to get main window");

            let version = app.package_info().version.to_string();

            std::thread::spawn(move || {
                if wait_for_server(port, 15000) {
                    // Include version so WebKit fetches a fresh index.html after updates.
                    let url: tauri::Url = format!("http://localhost:{port}/?v={version}")
                        .parse()
                        .unwrap();
                    let _ = window.navigate(url);
                } else {
                    eprintln!("[tauri] Server did not start within 15 seconds");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
