use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

struct ServerState {
    child: Mutex<Option<Child>>,
}

impl Drop for ServerState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut c) = guard.take() {
                let _ = c.kill();
            }
        }
    }
}

fn find_available_port(preferred: u16) -> u16 {
    if TcpListener::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }
    let listener =
        TcpListener::bind(("127.0.0.1", 0)).expect("Failed to find available port");
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

/// Extract the server pack tarball to the app data directory if not already done
/// for this version.
fn ensure_server_extracted(resource_dir: &PathBuf, app_data: &PathBuf) -> PathBuf {
    let server_dir = app_data.join("server");
    let version_marker = server_dir.join(".version");
    let current_version = env!("CARGO_PKG_VERSION");

    // Check if already extracted for this version
    if version_marker.exists() {
        if let Ok(v) = fs::read_to_string(&version_marker) {
            if v.trim() == current_version {
                return server_dir;
            }
        }
    }

    // Clean and extract
    let _ = fs::remove_dir_all(&server_dir);
    fs::create_dir_all(&server_dir).expect("Failed to create server directory");

    let tarball = resource_dir.join("server-pack.tar.gz");
    let file = fs::File::open(&tarball).unwrap_or_else(|e| {
        panic!(
            "Failed to open server pack at {}: {}",
            tarball.display(),
            e
        )
    });

    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    archive
        .unpack(&server_dir)
        .expect("Failed to extract server pack");

    // Write version marker
    fs::write(&version_marker, current_version).ok();

    server_dir
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
                // In dev mode, beforeDevCommand starts the server — nothing to do.
                return Ok(());
            }

            let port = find_available_port(3000);

            let resource_dir = app
                .path()
                .resource_dir()
                .expect("Failed to resolve resource dir");

            let app_data = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data dir");
            fs::create_dir_all(&app_data).ok();

            // Extract server files
            let server_dir = ensure_server_extracted(&resource_dir, &app_data);

            // Use the same DB location as the Electron app for migration compatibility
            let db_dir = dirs::home_dir()
                .expect("Failed to resolve home dir")
                .join("Library/Application Support/KlustrEye");
            fs::create_dir_all(&db_dir).ok();
            let db_url = format!("file:{}/klustreye.db", db_dir.display());

            let server_bundle = server_dir.join("server.bundle.mjs");

            eprintln!("[tauri] Starting node server on port {}", port);
            eprintln!("[tauri] Server dir: {}", server_dir.display());
            eprintln!("[tauri] Server bundle: {}", server_bundle.display());
            eprintln!("[tauri] DB URL: {}", db_url);

            let child = Command::new("node")
                .arg(&server_bundle)
                .env("NODE_ENV", "production")
                .env("PORT", port.to_string())
                .env("DATABASE_URL", &db_url)
                .env("NEXT_TELEMETRY_DISABLED", "1")
                .current_dir(&server_dir)
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .spawn()
                .expect("Failed to start Node.js server — is Node.js installed?");

            app.manage(ServerState {
                child: Mutex::new(Some(child)),
            });

            // Wait for server then navigate the window
            let window = app
                .get_webview_window("main")
                .expect("Failed to get main window");

            std::thread::spawn(move || {
                if wait_for_server(port, 30000) {
                    let url: tauri::Url = format!("http://localhost:{}", port)
                        .parse()
                        .unwrap();
                    let _ = window.navigate(url);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
