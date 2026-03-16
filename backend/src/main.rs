use backend::start_server;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000u16);

    let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
        let db_dir = if cfg!(target_os = "macos") {
            dirs::home_dir()
                .unwrap_or_default()
                .join("Library/Application Support/KlustrEye")
        } else {
            dirs::config_dir()
                .unwrap_or_default()
                .join("KlustrEye")
        };
        std::fs::create_dir_all(&db_dir).ok();
        format!("file:{}", db_dir.join("klustreye.db").to_string_lossy().replace('\\', "/"))
    });

    start_server(port, &database_url).await
}
