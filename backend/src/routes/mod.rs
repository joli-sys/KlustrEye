pub mod clusters;
pub mod helm;
pub mod logs;
pub mod metrics;
pub mod organizations;
pub mod port_forward;
pub mod resources;
pub mod settings;

use axum::{
    extract::{Path, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::{delete, get, patch, post, put},
    Router,
};

use crate::{
    ws::{shell::handle_shell, terminal::handle_terminal},
    AppState,
};

pub fn build_router(state: AppState) -> Router {
    Router::new()
        // Clusters
        .route("/api/clusters", get(clusters::list_clusters))
        .route("/api/clusters/:ctx", get(clusters::get_cluster))
        .route("/api/clusters/:ctx/rename", put(clusters::rename_cluster))
        .route("/api/clusters/:ctx/settings/namespace", put(clusters::set_namespace))
        .route("/api/clusters/:ctx/settings/color", put(clusters::set_color))
        .route("/api/clusters/:ctx/settings/organization", put(clusters::set_organization))
        // Resources
        .route("/api/clusters/:ctx/resources/:kind", get(resources::list_resources).post(resources::create_resource))
        .route("/api/clusters/:ctx/resources/:kind/:name",
            get(resources::get_resource)
            .put(resources::update_resource)
            .delete(resources::delete_resource)
            .patch(resources::patch_resource)
        )
        // Custom resources
        .route("/api/clusters/:ctx/custom-resources/:group/:version/:plural",
            get(resources::list_custom_resources))
        .route("/api/clusters/:ctx/custom-resources/:group/:version/:plural/:name",
            get(resources::get_custom_resource)
            .put(resources::update_custom_resource)
            .delete(resources::delete_custom_resource)
        )
        // Logs & workload ops
        .route("/api/clusters/:ctx/pods/:name/logs", get(logs::get_pod_logs))
        .route("/api/clusters/:ctx/cronjobs/:name/trigger", post(logs::trigger_cronjob))
        // Namespaces, events, CRDs, search, endpoints
        .route("/api/clusters/:ctx/namespaces", get(metrics::list_namespaces))
        .route("/api/clusters/:ctx/events", get(metrics::get_events))
        .route("/api/clusters/:ctx/crds", get(metrics::list_crds))
        .route("/api/clusters/:ctx/search", get(metrics::search_resources))
        .route("/api/clusters/:ctx/services/:name/endpoints", get(metrics::get_service_endpoints))
        // Metrics
        .route("/api/clusters/:ctx/metrics/nodes", get(metrics::get_node_metrics))
        .route("/api/clusters/:ctx/metrics/pods", get(metrics::get_pod_metrics))
        // Helm
        .route("/api/clusters/:ctx/helm/releases",
            get(helm::list_releases).post(helm::install_release))
        .route("/api/clusters/:ctx/helm/releases/:name",
            get(helm::get_release)
            .put(helm::update_release)
            .delete(helm::delete_release)
        )
        // Port-forward
        .route("/api/clusters/:ctx/port-forward",
            get(port_forward::list_port_forwards).post(port_forward::start_port_forward))
        .route("/api/clusters/:ctx/port-forward/:id",
            delete(port_forward::stop_port_forward))
        // Organizations
        .route("/api/organizations",
            get(organizations::list_organizations).post(organizations::create_organization))
        .route("/api/organizations/:org_id",
            get(organizations::get_organization)
            .put(organizations::update_organization)
            .delete(organizations::delete_organization)
        )
        // Settings
        .route("/api/settings/kubeconfig",
            get(settings::get_kubeconfig).put(settings::set_kubeconfig))
        // WebSocket: terminal & shell
        .route("/ws/terminal/:ctx/:namespace/:pod/:container", get(ws_terminal_handler))
        .route("/ws/shell/:ctx", get(ws_shell_handler))
        .with_state(state)
}

async fn ws_terminal_handler(
    ws: WebSocketUpgrade,
    Path((ctx, namespace, pod, container)): Path<(String, String, String, String)>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let context_name = urlencoding::decode(&ctx).unwrap_or_default().to_string();
    let namespace = urlencoding::decode(&namespace).unwrap_or_default().to_string();
    let pod = urlencoding::decode(&pod).unwrap_or_default().to_string();
    let container = urlencoding::decode(&container).unwrap_or_default().to_string();

    ws.on_upgrade(move |socket| async move {
        match state.clients.get_client(&context_name).await {
            Ok(client) => {
                handle_terminal(socket, (*client).clone(), namespace, pod, container).await
            }
            Err(e) => {
                tracing::error!("Failed to get client for terminal: {e}");
            }
        }
    })
}

async fn ws_shell_handler(
    ws: WebSocketUpgrade,
    Path(ctx): Path<String>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let context_name = urlencoding::decode(&ctx).unwrap_or_default().to_string();

    ws.on_upgrade(move |socket| async move {
        handle_shell(socket, state.db.clone(), context_name).await
    })
}
