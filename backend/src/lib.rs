pub mod db;
pub mod error;
pub mod k8s;
pub mod routes;
pub mod ws;

use k8s::client::KubeClientCache;
use k8s::port_forward::PortForwardProcesses;
use sqlx::SqlitePool;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub clients: Arc<KubeClientCache>,
    pub port_forwards: PortForwardProcesses,
}

pub async fn start_server(port: u16, database_url: &str) -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let db = db::init_pool(database_url).await?;

    // Load kubeconfig path preference from DB at startup
    let saved_path: Option<String> = sqlx::query_scalar(
        "SELECT value FROM user_preferences WHERE key = 'kubeconfigPath'",
    )
    .fetch_optional(&db)
    .await
    .ok()
    .flatten();

    let clients = Arc::new(KubeClientCache::new());
    if let Some(path) = saved_path {
        *clients.kubeconfig_path.write().await = Some(path);
    }

    let port_forwards = k8s::port_forward::new_processes();

    let state = AppState {
        db: db.clone(),
        clients,
        port_forwards: port_forwards.clone(),
    };

    let app = routes::build_router(state.clone()).layer(
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any),
    );

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("Server listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;

    // Graceful shutdown — cleanup port-forwards
    let db_clone = db.clone();
    let pf_clone = port_forwards.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("Shutting down — cleaning up port-forwards...");
        k8s::port_forward::cleanup_all(&db_clone, &pf_clone).await;
        std::process::exit(0);
    });

    axum::serve(listener, app).await?;
    Ok(())
}
