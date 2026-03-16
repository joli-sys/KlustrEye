use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::Value;

use crate::{error::{AppError, Result}, AppState};

#[derive(Deserialize)]
pub struct MetricsQuery {
    pub namespace: Option<String>,
}

pub async fn get_node_metrics(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let req = http::Request::get("/apis/metrics.k8s.io/v1beta1/nodes")
        .body(vec![])
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let result: Value = client.request(req).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;

    Ok(Json(result))
}

pub async fn get_pod_metrics(
    Path(context_name): Path<String>,
    Query(q): Query<MetricsQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let url = if let Some(ns) = &q.namespace {
        format!("/apis/metrics.k8s.io/v1beta1/namespaces/{ns}/pods")
    } else {
        "/apis/metrics.k8s.io/v1beta1/pods".to_string()
    };

    let req = http::Request::get(&url)
        .body(vec![])
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let result: Value = client.request(req).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;

    Ok(Json(result))
}

pub async fn list_namespaces(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    use k8s_openapi::api::core::v1::Namespace;
    use kube::api::{Api, ListParams};

    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let ns_api: Api<Namespace> = Api::all((*client).clone());
    let list = ns_api.list(&ListParams::default()).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;

    let names: Vec<&str> = list
        .items
        .iter()
        .filter_map(|n| n.metadata.name.as_deref())
        .collect();

    Ok(Json(serde_json::json!({ "namespaces": names })))
}

pub async fn get_events(
    Path(context_name): Path<String>,
    Query(q): Query<MetricsQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    use k8s_openapi::api::core::v1::Event;
    use kube::api::{Api, ListParams};

    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let events: Api<Event> = if let Some(ns) = &q.namespace {
        Api::namespaced((*client).clone(), ns)
    } else {
        Api::all((*client).clone())
    };

    let list = events.list(&ListParams::default()).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;

    Ok(Json(serde_json::to_value(&list)?))
}

pub async fn list_crds(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    use k8s_openapi::apiextensions_apiserver::pkg::apis::apiextensions::v1::CustomResourceDefinition;
    use kube::api::{Api, ListParams};

    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let crds: Api<CustomResourceDefinition> = Api::all((*client).clone());
    let list = crds.list(&ListParams::default()).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;

    Ok(Json(serde_json::to_value(&list)?))
}

pub async fn get_service_endpoints(
    Path((context_name, service_name)): Path<(String, String)>,
    Query(q): Query<MetricsQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    use k8s_openapi::api::core::v1::Endpoints;
    use kube::api::Api;

    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let namespace = q.namespace.as_deref().unwrap_or("default");
    let ep_api: Api<Endpoints> = Api::namespaced((*client).clone(), namespace);
    let ep = ep_api.get(&service_name).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;

    Ok(Json(serde_json::to_value(&ep)?))
}

pub async fn search_resources(
    Path(context_name): Path<String>,
    Query(q): Query<SearchQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    use crate::k8s::resources::{list_resources, RESOURCE_REGISTRY};
    use kube::Client;

    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let query = q.q.as_deref().unwrap_or("").to_lowercase();
    if query.is_empty() {
        return Ok(Json(serde_json::json!({ "results": [] })));
    }

    let mut results = Vec::new();

    for info in RESOURCE_REGISTRY.iter().take(10) {
        let c: Client = (*client).clone();
        if let Ok(list) = list_resources(c, info.plural, None).await {
            for item in &list.items {
                let name = item.metadata.name.as_deref().unwrap_or("");
                if name.to_lowercase().contains(&query) {
                    results.push(serde_json::json!({
                        "kind": info.kind,
                        "name": name,
                        "namespace": item.metadata.namespace.as_deref(),
                    }));
                }
                if results.len() >= 50 {
                    break;
                }
            }
        }
        if results.len() >= 50 {
            break;
        }
    }

    Ok(Json(serde_json::json!({ "results": results })))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    pub namespace: Option<String>,
}
