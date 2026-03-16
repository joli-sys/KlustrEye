use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    error::{AppError, Result},
    k8s::resources,
    AppState,
};

#[derive(Deserialize)]
pub struct NsQuery {
    pub namespace: Option<String>,
}

pub async fn list_resources(
    Path((context_name, kind)): Path<(String, String)>,
    Query(q): Query<NsQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    if resources::lookup_resource(&kind).is_none() {
        return Err(AppError::BadRequest(format!("Unknown resource kind: {kind}")));
    }
    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let ns = q.namespace.as_deref();
    let list = resources::list_resources((*client).clone(), &kind, ns).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;
    Ok(Json(serde_json::to_value(&list)?))
}

pub async fn create_resource(
    Path((context_name, kind)): Path<(String, String)>,
    Query(q): Query<NsQuery>,
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    if resources::lookup_resource(&kind).is_none() {
        return Err(AppError::BadRequest(format!("Unknown resource kind: {kind}")));
    }
    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let ns = q.namespace.as_deref();
    let obj = resources::create_resource((*client).clone(), &kind, body, ns).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;
    Ok(Json(serde_json::to_value(&obj)?))
}

pub async fn get_resource(
    Path((context_name, kind, name)): Path<(String, String, String)>,
    Query(q): Query<NsQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let ns = q.namespace.as_deref();
    let obj = resources::get_resource((*client).clone(), &kind, &name, ns).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;
    Ok(Json(serde_json::to_value(&obj)?))
}

pub async fn update_resource(
    Path((context_name, kind, name)): Path<(String, String, String)>,
    Query(q): Query<NsQuery>,
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let ns = q.namespace.as_deref();
    let obj = resources::update_resource((*client).clone(), &kind, &name, body, ns).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;
    Ok(Json(serde_json::to_value(&obj)?))
}

pub async fn delete_resource(
    Path((context_name, kind, name)): Path<(String, String, String)>,
    Query(q): Query<NsQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let ns = q.namespace.as_deref();
    resources::delete_resource((*client).clone(), &kind, &name, ns).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn patch_resource(
    Path((context_name, kind, name)): Path<(String, String, String)>,
    Query(q): Query<NsQuery>,
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let ns = q.namespace.as_deref();
    let obj = resources::patch_resource((*client).clone(), &kind, &name, body, ns).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;
    Ok(Json(serde_json::to_value(&obj)?))
}

// --- Custom resources ---

pub async fn list_custom_resources(
    Path((context_name, group, version, plural)): Path<(String, String, String, String)>,
    Query(q): Query<NsQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let list = resources::list_custom_resources((*client).clone(), &group, &version, &plural, q.namespace.as_deref()).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;
    Ok(Json(serde_json::to_value(&list)?))
}

pub async fn get_custom_resource(
    Path((context_name, group, version, plural, name)): Path<(String, String, String, String, String)>,
    Query(q): Query<NsQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let obj = resources::get_custom_resource((*client).clone(), &group, &version, &plural, &name, q.namespace.as_deref()).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;
    Ok(Json(serde_json::to_value(&obj)?))
}

pub async fn update_custom_resource(
    Path((context_name, group, version, plural, name)): Path<(String, String, String, String, String)>,
    Query(q): Query<NsQuery>,
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>> {
    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let obj = resources::update_custom_resource((*client).clone(), &group, &version, &plural, &name, body, q.namespace.as_deref()).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;
    Ok(Json(serde_json::to_value(&obj)?))
}

pub async fn delete_custom_resource(
    Path((context_name, group, version, plural, name)): Path<(String, String, String, String, String)>,
    Query(q): Query<NsQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    resources::delete_custom_resource((*client).clone(), &group, &version, &plural, &name, q.namespace.as_deref()).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
